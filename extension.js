import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import GLib from "gi://GLib";
import * as LoginManager from "resource:///org/gnome/shell/misc/loginManager.js";
import { NotificationService } from "./lib/NotificationService.js";
import { DisplayBrightnessService } from "./lib/DisplayBrightnessService.js";
import { SensorProxyService } from "./lib/SensorProxyService.js";
import { UserPreferenceLearning } from "./lib/UserPreferenceLearning.js";
import { BucketMapper } from "./lib/BucketMapper.js";

const BRIGHTNESS_BUCKETS = [
  { min: 0, max: 10, brightness: 10 }, // Night
  { min: 5, max: 200, brightness: 25 }, // Very dark to dim indoor
  { min: 50, max: 650, brightness: 50 }, // Dim to normal indoor
  { min: 350, max: 2000, brightness: 75 }, // Normal to bright indoor
  { min: 1000, max: 10000, brightness: 100 }, // Bright indoor to outdoor
];

export default class AdaptiveBrightnessExtension extends Extension {
  constructor(metadata) {
    super(metadata);

    this.ambientSignalId = null;
    this.brightnessSignalId = null;
    this.sleepResumeSignalId = null;
  }

  initializeServices() {
    this.notifications = new NotificationService();
    this.displayBrightness = new DisplayBrightnessService();
    this.sensorProxy = new SensorProxyService();
    this.loginManager = null;
    this.userLearning = new UserPreferenceLearning();
    this.bucketMapper = new BucketMapper(BRIGHTNESS_BUCKETS);
  }

  async enable() {
    this.initializeServices();

    try {
      await this.displayBrightness.start();
    } catch (error) {
      console.error(
        "[AdaptiveBrightness] Failed to start Display Brightness Service:",
        error
      );
      this.notifications.showNotification(
        "Adaptive Brightness Extension Error",
        `Failed to start Display Brightness Service: ${error.message || error}`,
        { transient: false }
      );
      return;
    }

    try {
      await this.sensorProxy.start();
    } catch (error) {
      console.error(
        "[AdaptiveBrightness] Failed to start Sensor Proxy Service:",
        error
      );
      this.notifications.showNotification(
        "Adaptive Brightness Extension Error",
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
  }

  handleGnomeAmbientConflict() {
    const notify = (enabled) => {
      if (enabled) {
        this.notifications.showNotification(
          "Adaptive Brightness Extension",
          "GNOME's automatic brightness feature is enabled. Press to disable it in Settings → Power, allowing the extension to work properly.",
          {
            transient: true,
            onActivate: () => {
              GLib.spawn_command_line_async("gnome-control-center power");
            },
          }
        );
      }
    };

    this.ambientSignalId =
      this.displayBrightness.settings.onAmbientEnabledChanged(notify);

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
    this.displayBrightness.onManualBrightnessChange.add(
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

    const automaticBucket = this.bucketMapper.mapLuxToBrightness(
      currentLux,
      false
    );

    if (automaticBucket) {
      const updatedRatio = this.userLearning.updateBiasFromManualAdjustment(
        manualBrightness,
        automaticBucket.brightness
      );

      if (updatedRatio) {
        const v = updatedRatio.toFixed(2);
        this.notifications.showNotification(
          "Adaptive Brightness Extension",
          `Brightness preference set to ${v}x (${manualBrightness}% manual vs ${automaticBucket.brightness}% auto)`,
          {
            transient: true,
            action: {
              label: "Reset",
              callback: () => {
                this.userLearning.reset();
                this.adjustBrightnessForLightLevel(
                  this.sensorProxy.dbus.lightLevel
                );
              },
            },
          }
        );
      }
    }
  }

  handleLightLevelChanges() {
    this.sensorProxy.onLightLevelChanged.add(
      this.adjustBrightnessForLightLevel.bind(this)
    );

    this.sensorProxy.onSensorAvailableChanged.add((val) => {
      if (val === false) {
        this.notifications.showNotification(
          "Adaptive Brightness Extension",
          `Ambient Light Sensor is not available. Extension will not function`,
          { transient: false }
        );
      }
    });
  }

  handleSleepResumeEvents() {
    if (!this.loginManager) {
      console.warn("[AdaptiveBrightness] LoginManager not available");
      return;
    }

    this.sleepResumeSignalId = this.loginManager.connect(
      "prepare-for-sleep",
      (lm, aboutToSuspend) => {
        if (!aboutToSuspend) {
          const luxValue = this.sensorProxy.dbus.lightLevel;
          if (luxValue !== null) {
            this.adjustBrightnessForLightLevel(luxValue);
          }
        }
      }
    );
  }

  adjustBrightnessForLightLevel(luxValue) {
    if (!this.displayBrightness.displayIsActive || luxValue === null) {
      return;
    }

    const targetBucket = this.bucketMapper.mapLuxToBrightness(luxValue);

    if (targetBucket) {
      const biasedBrightness = this.userLearning.applyBiasTo(
        targetBucket.brightness
      );
      this.setAutomaticBrightness(biasedBrightness);
    }
  }

  setAutomaticBrightness(brightness) {
    const currentBrightness = this.displayBrightness.dbus.brightness;

    if (this.displayBrightness._settingBrightness) {
      return;
    }

    if (
      currentBrightness !== null &&
      Math.abs(currentBrightness - brightness) <= 1
    ) {
      return;
    }

    this.displayBrightness
      .animateBrightness(brightness)
      .catch((e) =>
        console.error("[AdaptiveBrightness] Error animating brightness:", e)
      );
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

    this.sensorProxy.destroy();
    this.displayBrightness.destroy();
    this.notifications.destroy();

    this.userLearning.reset();
  }
}
