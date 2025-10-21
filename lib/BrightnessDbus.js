import Gio from 'gi://Gio';
import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';

/**
 * Low-level D-Bus interface for brightness control
 * Pure I/O layer - no business logic
 */

const BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';

const BrightnessInterface = FileUtils.loadInterfaceXML('org.gnome.SettingsDaemon.Power.Screen');
const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(BrightnessInterface);

export class BrightnessDbus {
  constructor() {
    this._proxy = null;
  }

  /**
   * Connect to the D-Bus brightness service
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this._proxy = new BrightnessProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH, (proxy, error) => {
        if (error) {
          console.error('[BrightnessDbus] Failed to connect:', error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get current brightness from D-Bus
   * @returns {number|null} Current brightness (0-100) or null if unavailable
   */
  get brightness() {
    try {
      const brightness = this._proxy.Brightness;
      return typeof brightness === 'number' ? brightness : null;
    } catch (error) {
      console.error('[BrightnessDbus] Failed to get brightness:', error);
      return null;
    }
  }

  /**
   * Set brightness via D-Bus
   * @param {number} value - Brightness value (0-100)
   */
  set brightness(value) {
    try {
      this._proxy.Brightness = Math.max(0, Math.min(100, Math.round(value)));
    } catch (error) {
      console.error('[BrightnessDbus] Failed to set brightness:', error);
    }
  }

  /**
   * Subscribe to brightness changes from D-Bus
   * @param {Function} callback - Called with (newBrightness) when brightness changes
   * @returns {number} Signal ID for disconnection
   */
  onChanged(callback) {
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
   * @param {number} signalId - Signal ID returned from onBrightnessChanged
   */
  disconnect(signalId) {
    if (this._proxy && signalId) {
      this._proxy.disconnect(signalId);
    }
  }

  destroy() {
    this._proxy = null;
  }
}
