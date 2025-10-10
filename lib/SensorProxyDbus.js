import Gio from "gi://Gio";

/**
 * Low-level D-Bus interface for sensor proxy communication
 * Handles only D-Bus communication with IIO Sensor Proxy service
 * Pure I/O layer - no business logic
 */
export class SensorProxyDbus {
  constructor() {
    this._proxy = null;
  }

  /**
   * Connect to the D-Bus sensor proxy service
   * @returns {Promise<void>}
   */
  async connect() {
    this._proxy = await new Promise((resolve, reject) => {
      Gio.DBusProxy.new(
        Gio.bus_get_sync(Gio.BusType.SYSTEM, null),
        Gio.DBusProxyFlags.NONE,
        null,
        "net.hadess.SensorProxy",
        "/net/hadess/SensorProxy",
        "net.hadess.SensorProxy",
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
   * Claim the light sensor
   * @returns {Promise<void>}
   */
  async claimLight() {
    if (!this._proxy) {
      throw new Error("D-Bus proxy not connected");
    }

    await new Promise((resolve, reject) => {
      this._proxy.call(
        "ClaimLight",
        null,
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
  }

  /**
   * Release the light sensor
   */
  releaseLight() {
    if (!this._proxy) {
      return;
    }

    this._proxy.call(
      "ReleaseLight",
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (source, result) => {
        try {
          source.call_finish(result);
        } catch (error) {
          console.error("Failed to release light sensor:", error);
        }
      }
    );
  }

  /**
   * Get current light level from D-Bus
   * @returns {number|null} Current light level in lux or null if unavailable
   */
  get lightLevel() {
    if (!this._proxy) {
      return null;
    }

    try {
      const lightLevel = this._proxy.get_cached_property("LightLevel");
      return lightLevel ? lightLevel.get_double() : null;
    } catch (error) {
      console.error("Failed to get light level:", error);
      return null;
    }
  }

  /**
   * Get sensor availability status from D-Bus
   * @returns {boolean|null} Sensor availability or null if unavailable
   */
  get hasAmbientLight() {
    if (!this._proxy) {
      return null;
    }

    try {
      const hasAmbientLight =
        this._proxy.get_cached_property("HasAmbientLight");
      return hasAmbientLight ? hasAmbientLight.get_boolean() : null;
    } catch (error) {
      console.error("Failed to get ambient light sensor status:", error);
      return null;
    }
  }

  /**
   * Subscribe to property changes from D-Bus
   * @param {Function} callback - Called with (proxy, changed, invalidated) when properties change
   * @returns {number} Signal ID for disconnection
   */
  onPropertiesChanged(callback) {
    if (!this._proxy) {
      throw new Error("D-Bus proxy not connected");
    }

    return this._proxy.connect("g-properties-changed", callback);
  }

  /**
   * Disconnect property change listener
   * @param {number} signalId - Signal ID returned from onPropertiesChanged
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
