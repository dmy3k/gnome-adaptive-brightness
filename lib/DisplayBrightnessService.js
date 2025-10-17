import GLib from "gi://GLib";
import { BrightnessAnimator } from "./BrightnessAnimator.js";
import { BrightnessDbus } from "./BrightnessDbus.js";
import { PowerSettings } from "./PowerSettings.js";
import { CallbackManager } from "./CallbackManager.js";

/**
 * Manages display brightness and power state tracking
 */
export class DisplayBrightnessService {
  constructor() {
    // D-Bus brightness control
    this.dbus = new BrightnessDbus();
    this._brightnessSignalId = null;

    // GNOME power settings
    this.settings = new PowerSettings();
    this._ambientEnabledSignalId = null;

    // Brightness animation
    this._animator = new BrightnessAnimator();
    this._settingBrightness = false;
    this._animationTimeout = null;

    // Display states
    this.displayIsDimmed = false;
    this.displayIsOff = false;
    this.displayIsActive = true;

    // Public callback managers
    this.onManualBrightnessChange = new CallbackManager();
    this.onDisplayIsActiveChanged = new CallbackManager();
  }

  async start() {
    this.settings.connect();

    this._ambientEnabledSignalId = this.settings.onAmbientEnabledChanged(
      this._updateDisplayActiveState.bind(this)
    );

    await this.dbus.connect();

    this._brightnessSignalId = this.dbus.onChanged(
      this._onBrightnessChanged.bind(this)
    );
  }

  _onBrightnessChanged(brightness) {
    const idleBrightness = this.settings.idleBrightness;

    this.displayIsOff = brightness < 0;
    this.displayIsDimmed = !this.displayIsOff && brightness === idleBrightness;

    if (!this.displayIsActive && brightness > idleBrightness) {
      GLib.timeout_add(GLib.PRIORITY_LOW, 250, () => {
        this._updateDisplayActiveState();
        return GLib.SOURCE_REMOVE;
      });
    } else {
      this._updateDisplayActiveState();
    }

    if (!this._settingBrightness && this.displayIsActive) {
      this.onManualBrightnessChange.invoke(brightness);
    }
  }

  _updateDisplayActiveState() {
    const newActive =
      !this.displayIsOff &&
      !this.displayIsDimmed &&
      !this.settings.ambientEnabled;

    if (this.displayIsActive !== newActive) {
      this.displayIsActive = newActive;
      this.onDisplayIsActiveChanged.invoke(this.displayIsActive);
    }
  }

  async animateBrightness(target) {
    this.haltAnimatingBrightness();
    this._settingBrightness = true;

    for (const value of this._animator.animate(this.dbus.brightness, target)) {
      if (!this.displayIsActive || !this._settingBrightness) {
        break;
      }

      if (value === this.settings.idleBrightness) {
        continue;
      }

      this.dbus.brightness = value;

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

  destroy() {
    this.haltAnimatingBrightness();

    // Disconnect brightness signal
    if (this._brightnessSignalId) {
      this.dbus.disconnect(this._brightnessSignalId);
      this._brightnessSignalId = null;
    }

    // Disconnect power settings signals
    if (this._ambientEnabledSignalId) {
      this.settings.disconnect(this._ambientEnabledSignalId);
    }

    // Clean up services
    if (this.dbus) {
      this.dbus.destroy();
    }
    if (this.settings) {
      this.settings.destroy();
    }

    // Clear callback managers
    this.onManualBrightnessChange.clear();
    this.onDisplayIsActiveChanged.clear();

    this._settingBrightness = false;
  }
}
