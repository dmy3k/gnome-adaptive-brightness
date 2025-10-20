import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import GLib from 'gi://GLib';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import { NotificationService } from './lib/NotificationService.js';
import { DisplayBrightnessService } from './lib/DisplayBrightnessService.js';
import { SensorProxyService } from './lib/SensorProxyService.js';
import { UserPreferenceLearning } from './lib/UserPreferenceLearning.js';
import { BucketMapper } from './lib/BucketMapper.js';
import { KeyboardBacklightDbus } from './lib/KeyboardBacklightDbus.js';

const BRIGHTNESS_BUCKETS = [
  { min: 0, max: 20, brightness: 15 }, // Night
  { min: 5, max: 200, brightness: 25 }, // Very dark to dim indoor
  { min: 50, max: 650, brightness: 50 }, // Dim to normal indoor
  { min: 350, max: 2000, brightness: 75 }, // Normal to bright indoor
  { min: 1000, max: 7000, brightness: 100 }, // Bright indoor to outdoor
  { min: 5000, max: 10000, brightness: 150 }, // Direct sunlight
];

export default class AdaptiveBrightnessExtension extends Extension {
  constructor(metadata) {
    super(metadata);

    this.ambientSignalId = null;
    this.brightnessSignalId = null;
    this.sleepResumeSignalId = null;
    this.biasRatioSignalId = null;
  }

  initializeServices() {
    // Get extension settings first
    this.settings = this.getSettings();

    this.notifications = new NotificationService();
    this.displayBrightness = new DisplayBrightnessService();
    this.keyboardBacklight = new KeyboardBacklightDbus();
    this.bucketMapper = new BucketMapper(BRIGHTNESS_BUCKETS);

    // Pass bucket boundary filter to sensor service for efficient event filtering
    this.sensorProxy = new SensorProxyService(
      this.bucketMapper.crossesBucketBoundary.bind(this.bucketMapper)
    );

    this.loginManager = null;
    this.userLearning = new UserPreferenceLearning(
      this.settings.get_double('brightness-bias-ratio')
    );
  }

  async enable() {
    this.initializeServices();

    try {
      await this.displayBrightness.start();
    } catch (error) {
      console.error('[AdaptiveBrightness] Failed to start Display Brightness Service:', error);
      this.notifications.showNotification(
        'Adaptive Brightness Extension Error',
        `Failed to start Display Brightness Service: ${error.message || error}`,
        { transient: false }
      );
      return;
    }

    // Start keyboard backlight (non-fatal if it fails)
    try {
      await this.keyboardBacklight.connect();
      if (this.keyboardBacklight.isAvailable) {
        console.log(
          `[AdaptiveBrightness] Keyboard backlight available (max: ${this.keyboardBacklight.maxBrightness})`
        );
      }
    } catch (error) {
      console.log('[AdaptiveBrightness] Keyboard backlight not available:', error);
    }

    try {
      await this.sensorProxy.start();
    } catch (error) {
      console.error('[AdaptiveBrightness] Failed to start Sensor Proxy Service:', error);
      this.notifications.showNotification(
        'Adaptive Brightness Extension Error',
        `Failed to start Sensor Proxy Service: ${error.message || error}`,
        { transient: false }
      );
      return;
    }

    // Set up sleep/resume handling using GNOME Shell's LoginManager
    // When resuming from sleep, check light level immediately
    // This handles scenarios where we wake up in different lighting conditions
    // and might not receive ALS events (e.g., waking in darkness)
    this.loginManager = LoginManager.getLoginManager();

    this.handleSleepResumeEvents();
    this.handleGnomeAmbientConflict();
    this.handleDisplayStateUpdates();
    this.handleBrightnessChanges();
    this.handleLightLevelChanges();
    this.handleBiasRatioChanges();

    // Force initial brightness adjustment based on current light level
    // This ensures brightness is set correctly on extension startup
    this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel);
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

    this.ambientSignalId = this.displayBrightness.settings.onAmbientEnabledChanged(notify);

    // Check initial state
    if (this.displayBrightness.settings.ambientEnabled) {
      notify(true);
    }
  }

  handleDisplayStateUpdates() {
    this.displayBrightness.onDisplayIsActiveChanged.add(() => {
      this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel);
    });
  }

  handleBrightnessChanges() {
    this.displayBrightness.onManualBrightnessChange.add(this.handleManualAdjustment.bind(this));
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
      const updatedRatio = this.userLearning.updateBiasFromManualAdjustment(
        manualBrightness,
        automaticBucket.brightness
      );

      if (updatedRatio) {
        const v = updatedRatio.toFixed(2);
        this.notifications.showNotification(
          'Adaptive Brightness Extension',
          `Brightness preference set to ${v}x (${manualBrightness}% manual vs ${automaticBucket.brightness}% auto)`,
          {
            transient: true,
            action: {
              label: 'Reset',
              callback: () => {
                this.userLearning.reset();
                this.settings.set_double('brightness-bias-ratio', 1.0);
                this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel);
              },
            },
          }
        );
        // Persist the learned bias ratio
        this.settings.set_double('brightness-bias-ratio', updatedRatio);
      }
    }
  }

  handleLightLevelChanges() {
    this.sensorProxy.onLightLevelChanged.add(this.adjustBrightnessForLightLevel.bind(this));

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
    if (!this.loginManager) {
      console.warn('[AdaptiveBrightness] LoginManager not available');
      return;
    }

    this.sleepResumeSignalId = this.loginManager.connect(
      'prepare-for-sleep',
      (lm, aboutToSuspend) => {
        if (!aboutToSuspend) {
          // Force an update on resume to handle lighting changes during sleep
          this.sensorProxy.forceUpdate();
        }
      }
    );
  }

  handleBiasRatioChanges() {
    this.biasRatioSignalId = this.settings.connect('changed::brightness-bias-ratio', () => {
      const newBiasRatio = this.settings.get_double('brightness-bias-ratio');

      // Only react if the value actually changed (avoid re-entry from our own updates)
      if (Math.abs(newBiasRatio - this.userLearning.biasRatio) < 0.01) {
        return;
      }

      this.userLearning.setBiasRatio(newBiasRatio);

      // Re-apply brightness with the new bias ratio
      this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel);
    });
  }

  adjustBrightnessForLightLevel(luxValue) {
    if (
      !this.displayBrightness.displayIsActive &&
      this.keyboardBacklight.isAvailable &&
      this.settings.get_boolean('auto-keyboard-backlight')
    ) {
      // When display becomes inactive (dimmed/off), turn off keyboard backlight
      this.keyboardBacklight
        .setBrightness(0)
        .catch((e) =>
          console.error('[AdaptiveBrightness] Error disabling keyboard brightness:', e)
        );
    }

    if (!this.displayBrightness.displayIsActive || luxValue === null) {
      return;
    }

    const targetBucket = this.bucketMapper.mapLuxToBrightness(luxValue);

    if (targetBucket) {
      const biasedBrightness = this.userLearning.applyBiasTo(targetBucket.brightness);
      this.displayBrightness
        .animateBrightness(biasedBrightness)
        .catch((e) => console.error('[AdaptiveBrightness] Error animating brightness:', e));

      // Control keyboard backlight based on brightness bucket index
      // DBus module tracks state and only makes call if brightness changed
      // Only control if auto-keyboard-backlight setting is enabled AND display is active
      if (
        this.keyboardBacklight.isAvailable &&
        this.settings.get_boolean('auto-keyboard-backlight') &&
        this.displayBrightness.displayIsActive
      ) {
        const isInLowestBucket = this.bucketMapper.currentBucketIndex === 0;
        const keyboardLevel = isInLowestBucket ? 1 : 0;

        this.keyboardBacklight
          .setBrightness(keyboardLevel)
          .catch((e) =>
            console.error('[AdaptiveBrightness] Error setting keyboard brightness:', e)
          );
      }
    }
  }

  disable() {
    if (this.ambientSignalId) {
      this.displayBrightness.settings.disconnect(this.ambientSignalId);
      this.ambientSignalId = null;
    }

    if (this.brightnessSignalId) {
      this.displayBrightness.dbus.disconnect(this.brightnessSignalId);
      this.brightnessSignalId = null;
    }

    if (this.sleepResumeSignalId) {
      this.loginManager?.disconnect(this.sleepResumeSignalId);
      this.sleepResumeSignalId = null;
    }
    this.loginManager = null;

    if (this.biasRatioSignalId) {
      this.settings?.disconnect(this.biasRatioSignalId);
      this.biasRatioSignalId = null;
    }

    this.sensorProxy.destroy();
    this.displayBrightness.destroy();
    this.keyboardBacklight.destroy();
    this.notifications.destroy();

    this.settings = null;
  }
}
