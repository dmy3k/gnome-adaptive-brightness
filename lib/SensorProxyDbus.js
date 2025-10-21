import Gio from 'gi://Gio';

/**
 * Low-level D-Bus interface for sensor proxy communication
 * Handles only D-Bus communication with IIO Sensor Proxy service
 * Pure I/O layer - no business logic
 */

const SensorProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
<interface name="net.hadess.SensorProxy">
    <method name="ClaimLight"/>
    <method name="ReleaseLight"/>
    <property name="HasAmbientLight" type="b" access="read"/>
    <property name="LightLevel" type="d" access="read"/>
    <property name="LightLevelUnit" type="s" access="read"/>
</interface>
</node>`);

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
      new SensorProxy(
        Gio.DBus.system,
        'net.hadess.SensorProxy',
        '/net/hadess/SensorProxy',
        (proxy, error) => {
          if (error) {
            reject(error);
          } else {
            resolve(proxy);
          }
        }
      );
    });
  }

  async claimLight() {
    if (!this._proxy) {
      throw new Error('D-Bus proxy not connected');
    }

    await new Promise((resolve, reject) => {
      this._proxy.ClaimLightAsync((result, error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  releaseLight() {
    if (!this._proxy) {
      return;
    }

    this._proxy.ReleaseLightAsync((result, error) => {
      if (error) {
        console.error('Failed to release light sensor:', error);
      }
    });
  }

  /**
   * Get current light level from D-Bus
   * @returns {number|null} Current light level in lux or null if unavailable
   */
  get lightLevel() {
    try {
      return this._proxy.LightLevel ?? null;
    } catch (error) {
      console.error('Failed to get light level:', error);
      return null;
    }
  }

  /**
   * Get sensor availability status from D-Bus
   * @returns {boolean|null} Sensor availability or null if unavailable
   */
  get hasAmbientLight() {
    try {
      return this._proxy.HasAmbientLight ?? null;
    } catch (error) {
      console.error('Failed to get ambient light sensor status:', error);
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
      throw new Error('D-Bus proxy not connected');
    }

    return this._proxy.connect('g-properties-changed', callback);
  }

  /**
   * Disconnect property change listener
   * @param {number} signalId - Signal ID returned from onPropertiesChanged
   */
  disconnectListener(signalId) {
    if (this._proxy && signalId) {
      this._proxy.disconnect(signalId);
    }
  }

  destroy() {
    this._proxy = null;
  }
}
