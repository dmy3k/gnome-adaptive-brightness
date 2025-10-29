import Gio from 'gi://Gio';
import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';
import { CallbackManager } from './CallbackManager.js';

const BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Brightness management wrapper for GNOME 46-48
export class BrightnessDbus {
  constructor(powerSettings) {
    this._dimmingTarget = powerSettings?.get_int('idle-brightness') || 0;
    this._proxy = null;
    this._onChangeSignalId = null;
    this._requestedValue = null;
    this._requestedTime = null;
    this._graceTimeoutMs = 250;
    this.onBrightnessChange = new CallbackManager();
    this.onUserPreferenceChange = new CallbackManager();
  }

  async connect() {
    const BrightnessInterface = FileUtils.loadInterfaceXML('org.gnome.SettingsDaemon.Power.Screen');
    const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(BrightnessInterface);

    this._proxy = await new Promise((resolve, reject) => {
      new BrightnessProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH, (proxy, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(proxy);
        }
      });
    });

    this._onChangeSignalId = this._proxy.connect('g-properties-changed', (proxy, changed) => {
      const brightnessVariant = changed.lookup_value('Brightness', null);

      if (brightnessVariant) {
        const brightness = brightnessVariant.get_int32();
        const normalizedValue = roundTo(brightness / 100, 2);

        if (
          this._requestedValue &&
          brightness !== this._requestedValue &&
          Date.now() - this._requestedTime > this._graceTimeoutMs &&
          brightness > 0 &&
          !this.isDimming
        ) {
          this.onUserPreferenceChange.invoke(normalizedValue);
        } else {
          this.onBrightnessChange.invoke(normalizedValue);
        }
      }
    });
  }

  get brightness() {
    try {
      const brightness = this._proxy.Brightness;
      return typeof brightness === 'number' && brightness >= 0
        ? roundTo(brightness / 100, 2)
        : null;
    } catch (error) {
      console.error('[BrightnessDbus] Failed to get brightness:', error);
      return null;
    }
  }

  set brightness(value) {
    if (this._proxy) {
      const clampedValue = Math.max(0, Math.min(1, value));
      const percentValue = Math.round(clampedValue * 100);

      if (Math.abs(percentValue - this._dimmingTarget) < 1) {
        return;
      }
      this._requestedValue = percentValue;
      this._proxy.Brightness = percentValue;
      this._requestedTime = Date.now();
    }
  }

  get isDimming() {
    return this._proxy?.Brightness === this._dimmingTarget;
  }

  destroy() {
    this.onBrightnessChange.clear();

    if (this._onChangeSignalId) {
      this._proxy?.disconnect(this._onChangeSignalId);
      this._onChangeSignalId = null;
    }
    this._proxy = null;
    this._dimmingTarget = null;
    this._requestedValue = null;
    this._requestedTime = null;
  }
}
