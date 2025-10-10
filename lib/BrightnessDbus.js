import Gio from "gi://Gio";
import GLib from "gi://GLib";

/**
 * Low-level D-Bus interface for brightness control
 * Handles only D-Bus communication with GNOME Settings Daemon Power service
 * Pure I/O layer - no business logic
 */
export class BrightnessDbus {
  constructor() {
    this._proxy = null;
  }

  /**
   * Connect to the D-Bus brightness service
   * @returns {Promise<void>}
   */
  async connect() {
    this._proxy = await new Promise((resolve, reject) => {
      Gio.DBusProxy.new(
        Gio.bus_get_sync(Gio.BusType.SESSION, null),
        Gio.DBusProxyFlags.NONE,
        null,
        "org.gnome.SettingsDaemon.Power",
        "/org/gnome/SettingsDaemon/Power",
        "org.gnome.SettingsDaemon.Power.Screen",
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
  }

  /**
   * Get current brightness from D-Bus
   * @returns {number|null} Current brightness (0-100) or null if unavailable
   */
  get brightness() {
    if (!this._proxy) {
      return null;
    }

    try {
      const brightness = this._proxy.get_cached_property("Brightness");
      return brightness ? brightness.get_int32() : null;
    } catch (error) {
      console.error("Failed to get brightness:", error);
      return null;
    }
  }

  /**
   * Set brightness via D-Bus
   * @param {number} value - Brightness value (0-100)
   */
  set brightness(value) {
    if (!this._proxy) {
      throw new Error("D-Bus proxy not connected");
    }

    const clampedValue = Math.max(0, Math.min(100, Math.round(value)));

    this._proxy.call(
      "org.freedesktop.DBus.Properties.Set",
      new GLib.Variant("(ssv)", [
        "org.gnome.SettingsDaemon.Power.Screen",
        "Brightness",
        new GLib.Variant("i", clampedValue),
      ]),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (source, result) => {
        try {
          source.call_finish(result);
        } catch (error) {
          console.error("Failed to set brightness:", error);
        }
      }
    );
  }

  /**
   * Subscribe to brightness changes from D-Bus
   * @param {Function} callback - Called with (newBrightness) when brightness changes
   * @returns {number} Signal ID for disconnection
   */
  onChanged(callback) {
    if (!this._proxy) {
      throw new Error("D-Bus proxy not connected");
    }

    return this._proxy.connect("g-properties-changed", (proxy, changed) => {
      const brightnessVariant = changed.lookup_value("Brightness", null);

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
