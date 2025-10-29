import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import GLib from 'gi://GLib';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import { NotificationService } from './lib/NotificationService.js';
import { DisplayBrightnessService } from './lib/DisplayBrightnessService.js';
import { SensorProxyService } from './lib/SensorProxyService.js';
import { UserPreferenceLearning } from './lib/UserPreferenceLearning.js';
import { BucketMapper } from './lib/BucketMapper.js';
import { KeyboardBacklightService } from './lib/KeyboardBacklightService.js';

const BRIGHTNESS_BUCKETS = [
  { min: 0, max: 20, brightness: 0.15 }, // Night
  { min: 5, max: 200, brightness: 0.25 }, // Very dark to dim indoor
  { min: 50, max: 650, brightness: 0.5 }, // Dim to normal indoor
  { min: 350, max: 2000, brightness: 0.75 }, // Normal to bright indoor
  { min: 1000, max: 7000, brightness: 1.0 }, // Bright indoor to outdoor
  { min: 5000, max: 10000, brightness: 1.5 }, // Direct sunlight
];

export default class AdaptiveBrightnessExtension extends Extension {
  async enable() {
    this._osdBaselineBucketIdx = -1;
    this.settings = this.getSettings();

    this.notifications = new NotificationService();
    this.displayBrightness = new DisplayBrightnessService();
    this.keyboardBacklight = new KeyboardBacklightService(this.settings);
    this.bucketMapper = new BucketMapper(BRIGHTNESS_BUCKETS);

    // Pass bucket boundary filter to sensor service for efficient event filtering
    this.sensorProxy = new SensorProxyService(
      this.bucketMapper.crossesBucketBoundary.bind(this.bucketMapper)
    );

    this.userLearning = new UserPreferenceLearning();

    // Set up sleep/resume handling using GNOME Shell's LoginManager
    // When resuming from sleep, check light level immediately
    // This handles scenarios where we wake up in different lighting conditions
    // and might not receive ALS events (e.g., waking in darkness)
    this.loginManager = LoginManager.getLoginManager();

    await Promise.all([
      this.displayBrightness.start(),
      this.keyboardBacklight.start(),
      this.sensorProxy.start(),
    ]);

    this.handleSleepResumeEvents();
    this.handleGnomeAmbientConflict();
    this.handleDisplayStateUpdates();
    this.handleLightLevelChanges();
    this.handleBrightnessChanges();

    // Force initial brightness adjustment based on current light level
    // This ensures brightness is set correctly on extension startup
    this._resetUserPreference();
  }

  handleGnomeAmbientConflict() {
    const notify = (enabled) => {
      if (enabled) {
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
    };

    this.displayBrightness.onAmbientEnabledChanged.add(notify);

    // Check initial state
    notify(this.displayBrightness.isGSDambientEnabled);
  }

  handleDisplayStateUpdates() {
    this.displayBrightness.onDisplayIsActiveChanged.add(() => {
      this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel);
    });
  }

  handleBrightnessChanges() {
    this.displayBrightness.backend.onUserPreferenceChange.add(
      this.handleManualAdjustment.bind(this)
    );
  }

  handleManualAdjustment(manualBrightness) {
    const currentLux = this.sensorProxy.dbus.lightLevel;

    if (
      !this.displayBrightness.displayIsActive ||
      this.displayBrightness._settingBrightness ||
      manualBrightness === null ||
      currentLux === null
    ) {
      return;
    }

    const automaticBucket = this.bucketMapper.mapLuxToBrightness(currentLux, false);

    if (automaticBucket) {
      if (
        this.displayBrightness.backend.userPreference &&
        this._osdBaselineBucketIdx !== this.bucketMapper.currentBucketIndex
      ) {
        // GNOME49 quirks: OSD needs update
        // as brightness bucket has changed since last userPreference update
        this._osdBaselineBucketIdx = this.bucketMapper.currentBucketIndex;
        this.displayBrightness.backend.userPreference = automaticBucket.brightness;
        return;
      }
      const updatedRatio = this.userLearning.updateBiasFromManualAdjustment(
        manualBrightness,
        automaticBucket.brightness
      );

      if (!updatedRatio) {
        return;
      }
      if (Math.abs(1 - updatedRatio) < 0.01) {
        this.notifications.clearNotification();
      } else {
        this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel, true);
        this.notifications.showNotification(
          'Adaptive Brightness Extension',
          `Brightness preference was set to ${updatedRatio.toFixed(2)}x`,
          {
            transient: true,
            action: { label: 'Reset', callback: this._resetUserPreference.bind(this) },
          }
        );
      }
    }
  }

  _resetUserPreference() {
    this.userLearning.reset();
    this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel, true);

    const bucket = this.bucketMapper.buckets[this.bucketMapper.currentBucketIndex];
    if (bucket) {
      this.displayBrightness.backend.userPreference = bucket?.brightness;
    }
  }

  handleLightLevelChanges() {
    this.sensorProxy.onLightLevelChanged.add((x) => this.adjustBrightnessForLightLevel(x));

    this.sensorProxy.onSensorAvailableChanged.add((val) => {
      if (val === false) {
        this.notifications.showNotification(
          'Adaptive Brightness Extension',
          `Ambient Light Sensor is not available. Extension will not function`,
          { transient: false }
        );
      }
    });
  }

  handleSleepResumeEvents() {
    this.sleepResumeSignalId = this.loginManager?.connect(
      'prepare-for-sleep',
      (lm, aboutToSuspend) => {
        if (!aboutToSuspend) {
          // Force an update on resume to handle lighting changes during sleep
          this.sensorProxy.forceUpdate();
        }
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
      const biasedBrightness = this.userLearning.applyBiasTo(targetBucket.brightness);

      if (immediate) {
        this.displayBrightness.backend.brightness = biasedBrightness;
      } else {
        this.displayBrightness.animateBrightness(biasedBrightness).catch((e) => console.error(e));
      }

      // Update keyboard backlight based on current light level
      const isInLowestBucket = this.bucketMapper.currentBucketIndex === 0;
      this.keyboardBacklight.updateForLightLevel(isInLowestBucket).catch((e) => console.error(e));
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

    if (this.biasRatioSignalId) {
      this.settings?.disconnect(this.biasRatioSignalId);
      this.biasRatioSignalId = null;
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

    this.settings = null;
    this._osdBaselineBucketIdx = -1;
  }
}
