import Gio from 'gi://Gio';
import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';

const BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';

export class KeyboardBacklightDbus {
  constructor() {
    this._proxy = null;
  }

  async connect() {
    const BrightnessInterface = FileUtils.loadInterfaceXML(
      'org.gnome.SettingsDaemon.Power.Keyboard'
    );
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
  }

  get Steps() {
    return this._proxy?.Steps || 1;
  }

  set BrightnessLevel(level) {
    if (this.Steps < 2) {
      console.warn('Keyboard backlight not available');
      return;
    }

    // first step is "off" state, thus excluded from scale value calculation
    const value = Math.round(100 / (this.Steps - 1) * level);
    this._proxy.Brightness = Math.max(0, Math.min(100, value));
  }

  destroy() {
    this._proxy = null;
  }
}
