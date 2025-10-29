import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { CallbackManager } from './CallbackManager.js';

// GNOME49 introduces new interface to manage brightness
// https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/gnome-49/js/misc/brightnessManager.js?ref_type=heads
export class BrightnessManager {
  constructor() {
    this._manager = Main.brightnessManager;
    this._changedSignalId = null;
    this._globalScaleSignalId = null;
    this._currentGlobalScale = null; // Keep reference for cleanup
    this._monitorScaleSignalIds = [];
    this.onBrightnessChange = new CallbackManager();
    this.onUserPreferenceChange = new CallbackManager();
  }

  connect() {
    // Listen to the 'changed' signal for major state changes (monitors added/removed)
    this._changedSignalId = this._manager.connect('changed', () => this._onMonitorChange());
    this._onMonitorChange();
  }

  _onMonitorChange() {
    // Disconnect old monitor scale listeners
    // Important: Keep references to the old scale objects because this._manager.scales
    // returns a new array with potentially new objects when monitors change
    for (const { scale, signalId } of this._monitorScaleSignalIds) {
      scale?.disconnect(signalId);
    }
    this._monitorScaleSignalIds = [];

    // Disconnect old globalScale listener if it exists
    if (this._globalScaleSignalId !== null && this._currentGlobalScale) {
      this._currentGlobalScale.disconnect(this._globalScaleSignalId);
      this._globalScaleSignalId = null;
      this._currentGlobalScale = null;
    }

    if (this._manager?.globalScale) {
      // Listen to globalScale changes to capture user preference (e.g., hotkeys)
      // This fires even during dimming when user tries to adjust brightness
      this._currentGlobalScale = this._manager.globalScale;
      this._globalScaleSignalId = this._currentGlobalScale.connect('notify::value', () => {
        this.onUserPreferenceChange.invoke(this.userPreference);
      });

      // Listen to monitor backlight changes to detect actual brightness changes
      // This includes: manual changes, dimming, and system-initiated changes
      // Store references to the scale objects for proper cleanup
      const scales = this._manager.scales || [];
      for (const scale of scales) {
        const signalId = scale.connect('backlights-changed', () => {
          this.onBrightnessChange.invoke(this.brightness);
        });
        // Store both the scale object reference AND the signal ID
        this._monitorScaleSignalIds.push({ scale, signalId });
      }
    }

    this.onBrightnessChange.invoke(this.brightness);
  }

  get brightness() {
    if (!this._manager?.globalScale) {
      return null;
    }

    return this._manager.autoBrightnessTarget;
  }

  get userPreference() {
    // User's brightness preference from globalScale
    // This value doesn't change during dimming - it represents what the user wants
    return this._manager?.globalScale?.value ?? null;
  }

  set userPreference(val) {
    if (this._manager?.globalScale) {
      this._manager.globalScale.value = val;
    }
  }

  set brightness(value) {
    // This tells the BrightnessManager that we want to control brightness
    if (this._manager) {
      const clampedValue = Math.max(0.0, Math.min(1.0, value));
      this._manager.autoBrightnessTarget = clampedValue;
    }
  }

  get isDimming() {
    return this._manager?.dimming;
  }

  destroy() {
    this.onBrightnessChange.clear();
    this.onUserPreferenceChange.clear();

    // Release brightness control
    if (this._manager) {
      this._manager.autoBrightnessTarget = -1.0;
    }

    if (this._changedSignalId !== null) {
      this._manager?.disconnect(this._changedSignalId);
      this._changedSignalId = null;
    }

    if (this._globalScaleSignalId !== null && this._currentGlobalScale) {
      this._currentGlobalScale.disconnect(this._globalScaleSignalId);
      this._globalScaleSignalId = null;
      this._currentGlobalScale = null;
    }

    // Disconnect monitor scale listeners
    for (const { scale, signalId } of this._monitorScaleSignalIds) {
      scale?.disconnect(signalId);
    }
    this._monitorScaleSignalIds = [];

    this._manager = null;
  }
}
