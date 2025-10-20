import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Low-level D-Bus interface for keyboard backlight control
 * Handles only D-Bus communication with UPower KbdBacklight service
 * Pure I/O layer - no business logic
 *
 * Typical keyboard backlights support discrete brightness levels:
 * - 0: Off
 * - 1: Low
 * - 2: High (if supported)
 * etc.
 */
export class KeyboardBacklightDbus {
  constructor() {
    this._proxy = null;
    this._maxBrightness = null;
    this._currentBrightness = null;
    this._signalId = null;
  }

  /**
   * Connect to the D-Bus keyboard backlight service
   * @returns {Promise<void>}
   */
  async connect() {
    this._proxy = await new Promise((resolve, reject) => {
      Gio.DBusProxy.new(
        Gio.bus_get_sync(Gio.BusType.SYSTEM, null),
        Gio.DBusProxyFlags.NONE,
        null,
        'org.freedesktop.UPower',
        '/org/freedesktop/UPower/KbdBacklight',
        'org.freedesktop.UPower.KbdBacklight',
        null,
        (source, result) => {
          try {
            const proxy = Gio.DBusProxy.new_finish(result);
            resolve(proxy);
          } catch (error) {
            reject(error);
          }
        }
      );
    });

    // Get max brightness level after connection
    await this._fetchMaxBrightness();

    // Get initial brightness level
    this._currentBrightness = await this.getBrightness();

    // Subscribe to brightness changes to track external changes
    this._signalId = this._proxy.connect('g-properties-changed', (proxy, changed) => {
      const brightnessVariant = changed.lookup_value('Brightness', null);
      if (brightnessVariant) {
        this._currentBrightness = brightnessVariant.get_int32();
      }
    });
  }

  /**
   * Fetch maximum brightness level from the device
   * @returns {Promise<void>}
   * @private
   */
  async _fetchMaxBrightness() {
    if (!this._proxy) {
      throw new Error('D-Bus proxy not connected');
    }

    try {
      const result = await new Promise((resolve, reject) => {
        this._proxy.call(
          'GetMaxBrightness',
          null,
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (source, result) => {
            try {
              const maxResult = source.call_finish(result);
              resolve(maxResult.deep_unpack());
            } catch (error) {
              reject(error);
            }
          }
        );
      });

      this._maxBrightness = result;
    } catch (error) {
      console.error('Failed to get max keyboard brightness:', error);
      this._maxBrightness = 0;
    }
  }

  /**
   * Get maximum brightness level supported by the keyboard backlight
   * Available brightness steps are 0 to maxBrightness (inclusive)
   * @returns {number|null} Maximum brightness level or null if unavailable
   */
  get maxBrightness() {
    return this._maxBrightness;
  }

  /**
   * Get current keyboard brightness from D-Bus
   * @returns {Promise<number|null>} Current brightness level or null if unavailable
   */
  async getBrightness() {
    if (!this._proxy) {
      return null;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        this._proxy.call(
          'GetBrightness',
          null,
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (source, result) => {
            try {
              const brightnessResult = source.call_finish(result);
              resolve(brightnessResult.deep_unpack());
            } catch (error) {
              reject(error);
            }
          }
        );
      });

      return result;
    } catch (error) {
      console.error('Failed to get keyboard brightness:', error);
      return null;
    }
  }

  /**
   * Set keyboard brightness via D-Bus
   * Only makes D-Bus call if the value is different from current brightness
   * @param {number} value - Brightness step (0 to maxBrightness)
   *                         0 = Off, 1+ = On at various levels
   * @returns {Promise<void>}
   */
  async setBrightness(value) {
    if (!this._proxy) {
      throw new Error('D-Bus proxy not connected');
    }

    if (this._maxBrightness === null || this._maxBrightness === 0) {
      console.warn('Keyboard backlight not available');
      return;
    }

    const clampedValue = Math.max(0, Math.min(this._maxBrightness, Math.round(value)));

    // Skip D-Bus call if brightness hasn't changed
    if (this._currentBrightness === clampedValue) {
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        this._proxy.call(
          'SetBrightness',
          new GLib.Variant('(i)', [clampedValue]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (source, result) => {
            try {
              source.call_finish(result);
              resolve();
            } catch (error) {
              reject(error);
            }
          }
        );
      });
    } catch (error) {
      console.error('Failed to set keyboard brightness:', error);
      throw error;
    }
  }

  /**
   * Subscribe to brightness changes from D-Bus
   * Note: Internal signal handler already tracks brightness changes in _currentBrightness
   * @param {Function} callback - Called with (newBrightness) when brightness changes
   * @returns {number} Signal ID for disconnection
   */
  onChanged(callback) {
    if (!this._proxy) {
      throw new Error('D-Bus proxy not connected');
    }

    return this._proxy.connect('g-properties-changed', (proxy, changed) => {
      const brightnessVariant = changed.lookup_value('Brightness', null);

      if (brightnessVariant) {
        const newBrightness = brightnessVariant.get_int32();
        callback(newBrightness);
      }
    });
  }

  /**
   * Disconnect brightness change listener
   * @param {number} signalId - Signal ID returned from onChanged
   */
  disconnect(signalId) {
    if (this._proxy && signalId) {
      this._proxy.disconnect(signalId);
    }
  }

  /**
   * Check if keyboard backlight is available
   * @returns {boolean}
   */
  get isAvailable() {
    return this._maxBrightness !== null && this._maxBrightness > 0;
  }

  destroy() {
    // Disconnect internal signal handler
    if (this._signalId && this._proxy) {
      this._proxy.disconnect(this._signalId);
      this._signalId = null;
    }

    this._proxy = null;
    this._maxBrightness = null;
    this._currentBrightness = null;
  }
}
