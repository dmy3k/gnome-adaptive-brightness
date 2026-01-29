import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {
  ExtensionPreferences,
  gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { SensorProxyDbus } from './lib/SensorProxyDbus.js';
import { BucketMapper } from './lib/BucketMapper.js';
import { BrightnessGraphWidget } from './preferences/BrightnessGraphWidget.js';
import { ConfigurationManager } from './preferences/ConfigurationManager.js';
import { KeyboardBacklightTab } from './preferences/KeyboardBacklightTab.js';
import { BucketOperations } from './preferences/BucketOperations.js';

function loadInterfaceXML(iface) {
  let uri = `resource:///org/gnome/shell/dbus-interfaces/${iface}.xml`;
  let f = Gio.File.new_for_uri(uri);

  try {
    let [ok_, bytes] = f.load_contents(null);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    log(`Failed to load D-Bus interface ${iface}`);
  }

  return null;
}

export default class AdaptiveBrightnessPreferences extends ExtensionPreferences {
  constructor(metadata) {
    super(metadata);

    this.initTranslations('adaptive-brightness@dmy3k.github.io');
  }

  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    this.settings = settings;
    this.sensorProxy = new SensorProxyDbus();
    this._initSensorProxy();

    this.bucketOps = new BucketOperations(settings);
    this.configManager = new ConfigurationManager(settings, () => this._refreshBuckets(), _);
    this.keyboardTab = new KeyboardBacklightTab(
      settings,
      (min, max, brightness) => this.bucketOps.generateBucketName(min, max, brightness),
      _
    );

    this.bucketMapper = null;
    this.activeBucketIndex = -1;
    this.currentLux = null;

    window.connect('close-request', () => {
      this._cleanupSensorProxy();
      this._cleanupKeyboardBacklight();
      if (this._keyboardBucketsListenerId) {
        settings.disconnect(this._keyboardBucketsListenerId);
        this._keyboardBucketsListenerId = null;
      }
      // Clean up all properties
      this.settings = null;
      this.bucketOps = null;
      this.configManager = null;
      this.keyboardTab = null;
      this.graphWidget = null;
      this.bucketMapper = null;
      this.activeBucketIndex = -1;
      this.currentLux = null;
      return false;
    });

    const buckets = this.bucketOps.loadBucketsFromSettings();
    this.bucketMapper = new BucketMapper(buckets);

    settings.connect('changed::brightness-buckets', () => {
      if (this.graphWidget?.getSkipNextSettingsUpdate()) {
        this.graphWidget.clearSkipNextSettingsUpdate();
        return;
      }

      if (this.graphWidget?.isDragging()) {
        return;
      }

      const updatedBuckets = this.bucketOps.loadBucketsFromSettings();
      this.bucketMapper = new BucketMapper(updatedBuckets);
      this.graphWidget?.setBucketMapper(this.bucketMapper);
    });

    this._createInspectorPage(window, settings, buckets);

    const KeyboardBrightnessInterface = loadInterfaceXML('org.gnome.SettingsDaemon.Power.Keyboard');
    const KeyboardBrightnessProxy = Gio.DBusProxy.makeProxyWrapper(KeyboardBrightnessInterface);
    new KeyboardBrightnessProxy(
      Gio.DBus.session,
      'org.gnome.SettingsDaemon.Power',
      '/org/gnome/SettingsDaemon/Power',
      (proxy, error) => {
        if (!error) {
          this.keyboardTab.setKeyboardBrightnessProxy(proxy);
        }
        this.keyboardTab.createPage(window, buckets);

        this._keyboardBucketsListenerId = settings.connect('changed::brightness-buckets', () => {
          this.keyboardTab.updateKeyboardTab();
        });
      }
    );
  }

  _createInspectorPage(window, settings, buckets) {
    const page = new Adw.PreferencesPage({
      title: _('Brightness'),
      icon_name: 'display-brightness-symbolic',
    });
    window.add(page);

    const graphGroup = new Adw.PreferencesGroup({
      title: _('Brightness Curve'),
      description: _('Current sensor value and brightness mapping'),
    });
    page.add(graphGroup);

    this.graphWidget = new BrightnessGraphWidget(
      (min, max, brightness) => this.bucketOps.generateBucketName(min, max, brightness),
      (buckets) => this.bucketOps.saveBucketsToSettings(buckets)
    );
    this.graphWidget.setBucketMapper(this.bucketMapper);

    graphGroup.add(this.graphWidget.getWidget());

    const configGroup = new Adw.PreferencesGroup({});
    page.add(configGroup);

    const configRow = new Adw.ActionRow({
      title: _('Configuration'),
      subtitle: _('Import or export brightness settings'),
    });

    const buttonBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 6,
      valign: Gtk.Align.CENTER,
    });

    const exportButton = new Gtk.Button({
      icon_name: 'document-save-symbolic',
      tooltip_text: _('Export configuration'),
      valign: Gtk.Align.CENTER,
    });
    exportButton.connect('clicked', () => {
      this.configManager.exportConfiguration(window);
    });
    buttonBox.append(exportButton);

    const importButton = new Gtk.Button({
      icon_name: 'document-open-symbolic',
      tooltip_text: _('Import configuration'),
      valign: Gtk.Align.CENTER,
    });
    importButton.connect('clicked', () => {
      this.configManager.importConfiguration(window);
    });
    buttonBox.append(importButton);

    configRow.add_suffix(buttonBox);
    configGroup.add(configRow);

    const resetRow = new Adw.ActionRow({
      title: _('Reset to Defaults'),
      subtitle: _('Restore the default brightness configuration'),
      activatable: true,
    });
    const resetIcon = new Gtk.Image({
      icon_name: 'view-refresh-symbolic',
      valign: Gtk.Align.CENTER,
    });
    resetRow.add_suffix(resetIcon);
    resetRow.connect('activated', () => {
      this._resetBuckets();
    });
    configGroup.add(resetRow);
  }

  async _initSensorProxy() {
    try {
      await this.sensorProxy.connect();

      if (!this.sensorProxy.hasAmbientLight) {
        return;
      }

      await this.sensorProxy.claimLight();

      this._updateSensorDisplay();

      this._sensorSignalId = this.sensorProxy.onPropertiesChanged(() => {
        this._updateSensorDisplay();
      });
    } catch (error) {
      log('Failed to initialize sensor proxy:', error);
    }
  }

  _updateSensorDisplay() {
    const currentLux = this.sensorProxy.lightLevel;

    if (currentLux === null || !this.bucketMapper) {
      this.activeBucketIndex = -1;
      this.graphWidget?.setCurrentLux(null, -1);
      return;
    }

    this.bucketMapper.mapLuxToBrightness(currentLux, true);
    this.activeBucketIndex = this.bucketMapper.currentBucketIndex;

    this.currentLux = currentLux;
    this.graphWidget?.setCurrentLux(currentLux, this.activeBucketIndex);
  }

  _cleanupSensorProxy() {
    if (this._sensorSignalId) {
      this.sensorProxy.disconnectListener(this._sensorSignalId);
      this._sensorSignalId = null;
    }

    if (this.sensorProxy) {
      this.sensorProxy.releaseLight();
      this.sensorProxy.destroy();
      this.sensorProxy = null;
    }
  }

  _cleanupKeyboardBacklight() {
    this.kbdBrightnessProxy = null;
  }

  _resetBuckets() {
    this.bucketOps.resetBuckets((bucketMapper) => {
      this.bucketMapper = bucketMapper;
      this.graphWidget?.setBucketMapper(bucketMapper);
      this.keyboardTab?.updateKeyboardTab();
    });
  }

  _refreshBuckets() {
    const buckets = this.bucketOps.loadBucketsFromSettings(this.settings);
    this.bucketMapper = new BucketMapper(buckets);
    this.graphWidget?.setBucketMapper(this.bucketMapper);

    // Update current state if we have lux data
    if (this.currentLux !== null && this.bucketMapper) {
      this.bucketMapper.mapLuxToBrightness(this.currentLux, true);
      this.activeBucketIndex = this.bucketMapper.currentBucketIndex;
      this.graphWidget?.setCurrentLux(this.currentLux, this.activeBucketIndex);
    } else {
      this.graphWidget?.redraw();
    }

    // Update keyboard tab with new buckets
    this.keyboardTab?.updateKeyboardTab();
  }
}
