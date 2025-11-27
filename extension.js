import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import GLib from 'gi://GLib';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import { NotificationService } from './lib/NotificationService.js';
import { DisplayBrightnessService } from './lib/DisplayBrightnessService.js';
import { SensorProxyService } from './lib/SensorProxyService.js';
import { BucketMapper } from './lib/BucketMapper.js';
import { KeyboardBacklightService } from './lib/KeyboardBacklightService.js';

export default class AdaptiveBrightnessExtension extends Extension {
  enable() {
    this.settings = this.getSettings();

    const buckets = this._loadBucketsFromSettings();
    this.bucketMapper = new BucketMapper(buckets);

    this.notifications = new NotificationService();
    this.displayBrightness = new DisplayBrightnessService();
    this.keyboardBacklight = new KeyboardBacklightService(this.settings);

    // Pass bucket boundary filter to sensor service for efficient event filtering
    this.sensorProxy = new SensorProxyService(
      this.bucketMapper.crossesBucketBoundary.bind(this.bucketMapper)
    );

    // Set up sleep/resume handling using GNOME Shell's LoginManager
    // When resuming from sleep, check light level immediately
    // This handles scenarios where we wake up in different lighting conditions
    // and might not receive ALS events (e.g., waking in darkness)
    this.loginManager = LoginManager.getLoginManager();

    Promise.allSettled([
      this.displayBrightness.start(),
      this.keyboardBacklight.start(),
      this.sensorProxy.start(),
    ]).then((results) => {
      if (results.some((r) => r.status === 'rejected')) {
        console.log('Some required services failed to start', results);
        return;
      }
      this.setupHandlers();

      // Set initial brightness based on current light level
      this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel, true);
    });
  }

  _loadBucketsFromSettings() {
    const bucketsVariant = this.settings.get_value('brightness-buckets');
    const buckets = [];

    for (let i = 0; i < bucketsVariant.n_children(); i++) {
      const tuple = bucketsVariant.get_child_value(i);
      buckets.push({
        min: tuple.get_child_value(0).get_uint32(),
        max: tuple.get_child_value(1).get_uint32(),
        brightness: tuple.get_child_value(2).get_double(),
      });
    }

    return buckets;
  }

  setupHandlers() {
    this.sleepResumeSignalId = this.loginManager?.connect(
      'prepare-for-sleep',
      (lm, aboutToSuspend) => {
        // Pause processing brightness during transitions from/to suspend
        // Force an update on resume to handle lighting changes during sleep
        // https://github.com/dmy3k/gnome-adaptive-brightness/issues/9
        if (aboutToSuspend) {
          this.sensorProxy.dbus.releaseLight();
        } else {
          this.sensorProxy.dbus.claimLight().catch(e => console.error(e));
        }
        this.displayBrightness.paused = aboutToSuspend;
      }
    );

    this.displayBrightness.onDisplayIsActiveChanged.add(() => {
      this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel, true);
    });
    this.displayBrightness.backend.onUserPreferenceChange.add(
      this.handleManualAdjustment.bind(this)
    );
    this.displayBrightness.onAmbientEnabledChanged.add(
      this.handleGSDAmbientEnableChanged.bind(this)
    );
    this.handleGSDAmbientEnableChanged(this.displayBrightness.isGSDambientEnabled);

    this.sensorProxy.onLightLevelChanged.add((x) => this.adjustBrightnessForLightLevel(x));
    this.sensorProxy.onSensorAvailableChanged.add(this.handleSensorAvailableChanged.bind(this));

    this.bucketSettingsChangedId = this.settings.connect('changed::brightness-buckets', () => {
      const buckets = this._loadBucketsFromSettings();
      this.bucketMapper = new BucketMapper(buckets);
      this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel, true);
    });
  }

  handleSensorAvailableChanged(val) {
    if (val === false) {
      this.notifications.showNotification(
        'Adaptive Brightness Extension',
        `Ambient Light Sensor is not available. Extension will not function`,
        { transient: false }
      );
    }
  }

  handleGSDAmbientEnableChanged(val) {
    if (val) {
      this.notifications.showNotification(
        'Adaptive Brightness Extension',
        "GNOME's automatic brightness feature is enabled. Press to disable it in Settings → Power, allowing the extension to work properly.",
        {
          transient: true,
          onActivate: () => {
            GLib.spawn_command_line_async('gnome-control-center power');
          },
        }
      );
    }
  }

  handleManualAdjustment(manualBrightness) {
    if (
      !this.displayBrightness.displayIsActive ||
      this.displayBrightness._settingBrightness ||
      manualBrightness === null ||
      this.sensorProxy.dbus.lightLevel === null ||
      this.displayBrightness.paused
    ) {
      return;
    }

    // Pause automatic brightness management
    this.displayBrightness.paused = true;

    // Show notification with resume on dismiss
    this.notifications.showNotification(
      'Adaptive Brightness',
      'Automatic brightness management is paused. Dismiss this notification to resume.',
      {
        transient: false,
        onDestroy: () => {
          this.displayBrightness.paused = false;
        },
        action: {
          label: 'Settings',
          callback: () => this.openPreferences(),
        },
      }
    );
  }

  adjustBrightnessForLightLevel(luxValue, immediate = false) {
    if (!this.displayBrightness.displayIsActive || luxValue === null) {
      this.keyboardBacklight.handleDisplayInactive().catch((e) => console.error(e));
      return;
    }

    const targetBucket = this.bucketMapper.mapLuxToBrightness(luxValue);

    if (targetBucket) {
      const targetBrightness = targetBucket.brightness;

      if (immediate) {
        this.displayBrightness.backend.brightness = targetBrightness;
      } else {
        this.displayBrightness.animateBrightness(targetBrightness).catch((e) => console.error(e));
      }

      this.keyboardBacklight
        .updateForBrightnessBucket(this.bucketMapper.currentBucketIndex)
        .catch((e) => console.error(e));
    }
  }

  disable() {
    // "unlock-dialog" session mode is used to be able to listen for 'prepare-for-sleep' signal from LoginManager
    // in order to check light level immediately after resuming from suspend (with lock screen being shown).
    // This handles scenarios where resuming in dark environment does not trigger ALS event
    // and user might be exposed to very high brighness level causing discomfort for eyes.
    if (this.sleepResumeSignalId) {
      this.loginManager?.disconnect(this.sleepResumeSignalId);
      this.sleepResumeSignalId = null;
    }
    this.loginManager = null;

    if (this.bucketSettingsChangedId) {
      this.settings?.disconnect(this.bucketSettingsChangedId);
      this.bucketSettingsChangedId = null;
    }

    if (this.sensorProxy) {
      this.sensorProxy.destroy();
      this.sensorProxy = null;
    }

    if (this.displayBrightness) {
      this.displayBrightness.destroy();
      this.displayBrightness = null;
    }

    if (this.keyboardBacklight) {
      this.keyboardBacklight.destroy();
      this.keyboardBacklight = null;
    }

    if (this.notifications) {
      this.notifications.destroy();
      this.notifications = null;
    }

    this.bucketMapper = null;
    this.settings = null;
  }
}
