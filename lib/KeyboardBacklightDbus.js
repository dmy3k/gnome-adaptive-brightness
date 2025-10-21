import Gio from 'gi://Gio';

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

const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
<interface name="org.freedesktop.UPower.KbdBacklight">
    <method name="SetBrightness">
        <arg name="value" type="i" direction="in"/>
    </method>
    <method name="GetBrightness">
        <arg name="value" type="i" direction="out"/>
    </method>
    <method name="GetMaxBrightness">
        <arg name="value" type="i" direction="out"/>
    </method>
    <signal name="BrightnessChanged">
        <arg type="i"/>
    </signal>
</interface>
</node>`);

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
      new BrightnessProxy(
        Gio.DBus.system,
        'org.freedesktop.UPower',
        '/org/freedesktop/UPower/KbdBacklight',
        (proxy, error) => {
          if (error) {
            reject(error);
          } else {
            resolve(proxy);
          }
        }
      );
    });

    // Get max and initial brightness level after connection
    this._maxBrightness = await new Promise((resolve, reject) => {
      this._proxy.GetMaxBrightnessAsync((result, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });

    this._currentBrightness = await new Promise((resolve, reject) => {
      this._proxy.GetBrightnessAsync((result, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });

    // Subscribe to brightness changes to track external changes
    this._signalId = this._proxy.connectSignal('BrightnessChanged', (proxy, sender, [value]) => {
      this._currentBrightness = value;
    });
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
    if (!this._maxBrightness) {
      console.warn('Keyboard backlight not available');
      return;
    }

    const clampedValue = Math.max(0, Math.min(this._maxBrightness, Math.round(value)));

    // Skip D-Bus call if brightness hasn't changed
    if (this._currentBrightness === clampedValue) {
      return;
    }

    await new Promise((resolve, reject) => {
      this._proxy.SetBrightnessAsync(clampedValue, (result, error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // Optimistically update current brightness after successful D-Bus call
    // The signal handler will also update this, but we need immediate state
    this._currentBrightness = clampedValue;
  }

  get isAvailable() {
    return this._maxBrightness !== null && this._maxBrightness > 0;
  }

  get isEnabled() {
    return this._currentBrightness !== null && this._currentBrightness > 0;
  }

  destroy() {
    if (this._signalId !== null && this._proxy) {
      this._proxy.disconnectSignal(this._signalId);
      this._signalId = null;
    }

    this._proxy = null;
    this._maxBrightness = null;
    this._currentBrightness = null;
  }
}
