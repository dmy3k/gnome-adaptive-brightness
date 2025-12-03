import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { BrightnessAnimator } from './BrightnessAnimator.js';
import { BrightnessManager } from './BrightnessManager.js';
import { BrightnessDbus } from './BrightnessDbus.js';
import { CallbackManager } from './CallbackManager.js';

export class DisplayBrightnessService {
  constructor() {
    this._powerSettings = new Gio.Settings({
      schema: 'org.gnome.settings-daemon.plugins.power',
    });

    this.backend = Main.brightnessManager
      ? new BrightnessManager(Main.brightnessManager)
      : new BrightnessDbus(this._powerSettings);

    // Brightness animation
    this._animator = new BrightnessAnimator();
    this._settingBrightness = false;
    this._animationTimeout = null;

    // Display state tracking
    this.displayIsDimmed = false;
    this.displayIsOff = false;
    this.displayIsActive = true;
    this._displayStateTimeout = null;

    this._ambientEnabledSignalId = null;
    this._isPaused = false;

    // Public callback managers
    this.onDisplayIsActiveChanged = new CallbackManager();
    this.onAmbientEnabledChanged = new CallbackManager();
  }

  /**
   * gnome-settings-daemon has it's own automatic brightness feature.
   * This extension should pause brightness management when GSD controls brightness
   */
  get isGSDambientEnabled() {
    return this._powerSettings?.get_boolean('ambient-enabled');
  }

  async start() {
    await this.backend.connect();
    this.backend.onBrightnessChange.add(this._processDisplayActiveState.bind(this));

    this._ambientEnabledSignalId = this._powerSettings?.connect('changed::ambient-enabled', () => {
      this.onAmbientEnabledChanged.invoke(this.isGSDambientEnabled);
      this._processDisplayActiveState(this.backend.brightness);
    });

    // Initialize display active state immediately based on current brightness
    // This prevents race conditions where brightness adjustment is attempted
    // before the first _onBrightnessChanged event fires
    this._isPaused = false;
    this._processDisplayActiveState(this.backend.brightness);
  }

  _processDisplayActiveState(brightness) {
    this.displayIsOff = brightness === null;
    this.displayIsDimmed = !this.displayIsOff && this.backend.isDimming;

    const newActive =
      !this.displayIsOff && !this.displayIsDimmed && !this.isGSDambientEnabled && !this._isPaused;

    if (this.displayIsActive !== newActive) {
      this.displayIsActive = newActive;
      this.onDisplayIsActiveChanged.invoke(newActive);
    }
  }

  async animateBrightness(target) {
    this.haltAnimatingBrightness();
    this._settingBrightness = true;

    for (const value of this._animator.animate(this.backend.brightness, target)) {
      if (!this.displayIsActive || !this._settingBrightness) {
        break;
      }

      this.backend.brightness = value;

      await new Promise((resolve) => {
        this._animationTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, 25, () => {
          this._animationTimeout = null;
          resolve();
          return GLib.SOURCE_REMOVE;
        });
      });
    }

    this._settingBrightness = false;
  }

  haltAnimatingBrightness() {
    this._settingBrightness = false;

    if (this._animationTimeout) {
      GLib.source_remove(this._animationTimeout);
      this._animationTimeout = null;
    }
  }

  /**
   * Inhibit brightness processing temporarily when entering paused state.
   * On resume trigger displayIsActive callbacks to re-process brightness immediately.
   */
  set paused(val) {
    if (this._isPaused !== !!val) {
      this._isPaused = !!val;
      this._processDisplayActiveState(this.backend.brightness);

      // GNOME49: Release brightness control to allow manual adjustment
      if (this._isPaused && this.backend.releaseControl) {
        this.backend.releaseControl();
      }
    }
  }

  get paused() {
    return this._isPaused;
  }

  destroy() {
    this.haltAnimatingBrightness();

    if (this._displayStateTimeout) {
      GLib.source_remove(this._displayStateTimeout);
      this._displayStateTimeout = null;
    }

    if (this.backend) {
      this.backend.destroy();
    }

    // Clear callback managers
    this.onDisplayIsActiveChanged.clear();
    this.onAmbientEnabledChanged.clear();

    if (this._ambientEnabledSignalId) {
      this._powerSettings?.disconnect(this._ambientEnabledSignalId);
      this._ambientEnabledSignalId = null;
    }

    this._settingBrightness = false;
    this._powerSettings = null;
  }
}
