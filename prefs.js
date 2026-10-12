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
import { FullscreenVideoGroup } from './preferences/FullscreenVideoGroup.js';
import { BucketOperations } from './preferences/BucketOperations.js';

function loadInterfaceXML(iface) {
  let uri = `resource:///org/gnome/shell/dbus-interfaces/${iface}.xml`;
  let f = Gio.File.new_for_uri(uri);

  try {
    let [ok_, bytes] = f.load_contents(null);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.warn(`Failed to load D-Bus interface ${iface}`);
  }

  return null;
}

export default class AdaptiveBrightnessPreferences extends ExtensionPreferences {
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
      this.keyboardTab?.destroy();
      this.fullscreenGroup?.destroy();
      this._cleanupSensorProxy();
      this._cleanupKeyboardBacklight();
      if (this._graphBucketsListenerId) {
        settings.disconnect(this._graphBucketsListenerId);
        this._graphBucketsListenerId = null;
      }
      if (this._keyboardBucketsListenerId) {
        settings.disconnect(this._keyboardBucketsListenerId);
        this._keyboardBucketsListenerId = null;
      }
      if (this._fullscreenBucketsListenerId) {
        settings.disconnect(this._fullscreenBucketsListenerId);
        this._fullscreenBucketsListenerId = null;
      }
      // Clean up all properties
      this.settings = null;
      this.bucketOps = null;
      this.configManager = null;
      this.keyboardTab = null;
      this.fullscreenGroup = null;
      this.graphWidget = null;
      this.bucketMapper = null;
      this.activeBucketIndex = -1;
      this.currentLux = null;
      return false;
    });

    const buckets = this.bucketOps.loadBucketsFromSettings();
    this.bucketMapper = new BucketMapper(buckets);

    this._graphBucketsListenerId = settings.connect('changed::brightness-buckets', () => {
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
          this.kbdBrightnessProxy = proxy;
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
      (buckets) => this.bucketOps.saveBucketsToSettings(buckets),
      _
    );
    this.graphWidget.setBucketMapper(this.bucketMapper);

    graphGroup.add(this.graphWidget.getWidget());

    this.fullscreenGroup = new FullscreenVideoGroup(
      settings,
      (min, max, brightness) => this.bucketOps.generateBucketName(min, max, brightness),
      _
    );
    page.add(this.fullscreenGroup.createGroup());
    this._fullscreenBucketsListenerId = settings.connect('changed::brightness-buckets', () => {
      this.fullscreenGroup?.rebuild();
    });

    const configGroup = new Adw.PreferencesGroup({});
    page.add(configGroup);

    const configRow = new Adw.ActionRow({
      title: _('Configuration'),
      subtitle: _('Import, export or reset brightness settings'),
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

    const resetButton = new Gtk.Button({
      icon_name: 'edit-undo-symbolic',
      tooltip_text: _('Restore the default brightness configuration'),
      valign: Gtk.Align.CENTER,
    });
    resetButton.connect('clicked', () => this._confirmReset(window));
    buttonBox.append(resetButton);

    configRow.add_suffix(buttonBox);
    configGroup.add(configRow);
  }

  _confirmReset(window) {
    const dialog = new Adw.AlertDialog({
      heading: _('Reset to Defaults'),
      body: _(
        'Brightness buckets and keyboard backlight levels will be replaced with the defaults.'
      ),
    });
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('reset', _('Reset'));
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, response) => {
      if (response === 'reset') {
        this._resetBuckets();
      }
    });
    dialog.present(window);
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
      console.error('Failed to initialize sensor proxy:', error);
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
    this.keyboardTab?.setKeyboardBrightnessProxy(null);
  }

  _resetBuckets() {
    this.bucketOps.resetBuckets((bucketMapper) => {
      this.bucketMapper = bucketMapper;
      this.graphWidget?.setBucketMapper(bucketMapper);
      this.keyboardTab?.updateKeyboardTab();
    });
  }

  _refreshBuckets() {
    const buckets = this.bucketOps.loadBucketsFromSettings();
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
