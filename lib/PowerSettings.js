import Gio from "gi://Gio";

/**
 * Low-level GSettings interface for GNOME power settings
 * Handles only GSettings communication
 * Pure I/O layer - no business logic
 */
export class PowerSettings {
  constructor() {
    this._settings = null;
  }

  connect() {
    this._settings = new Gio.Settings({
      schema: "org.gnome.settings-daemon.plugins.power",
    });
  }

  /**
   * Get idle brightness setting
   * @returns {number|null} Idle brightness value (0-100), or null if not connected
   */
  get idleBrightness() {
    if (!this._settings) {
      return null;
    }
    return this._settings.get_int("idle-brightness");
  }

  /**
   * Get ambient-enabled setting
   * @returns {boolean|null} Whether ambient light adjustment is enabled, or null if not connected
   */
  get ambientEnabled() {
    if (!this._settings) {
      return null;
    }
    return this._settings.get_boolean("ambient-enabled");
  }

  /**
   * Subscribe to idle brightness changes
   * @param {Function} callback - Called with (newValue) when idle brightness changes
   * @returns {number} Signal ID for disconnection
   */
  onIdleBrightnessChanged(callback) {
    if (!this._settings) {
      throw new Error("GSettings not connected");
    }

    return this._settings.connect("changed::idle-brightness", () => {
      callback(this.idleBrightness);
    });
  }

  /**
   * Subscribe to ambient-enabled changes
   * @param {Function} callback - Called with (newValue) when ambient-enabled changes
   * @returns {number} Signal ID for disconnection
   */
  onAmbientEnabledChanged(callback) {
    if (!this._settings) {
      throw new Error("GSettings not connected");
    }

    return this._settings.connect("changed::ambient-enabled", () => {
      callback(this.ambientEnabled);
    });
  }

  /**
   * Disconnect settings change listener
   * @param {number} signalId - Signal ID returned from callback registration
   */
  disconnect(signalId) {
    if (this._settings && signalId !== undefined) {
      this._settings.disconnect(signalId);
    }
  }

  /**
   * Clean up - releases GSettings reference
   * In actual GSettings, this allows garbage collection and automatic signal cleanup
   */
  destroy() {
    this._settings = null;
  }
}
