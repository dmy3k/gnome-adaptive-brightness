import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import GLib from 'gi://GLib';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import { NotificationService } from './lib/NotificationService.js';
import { DisplayBrightnessService } from './lib/DisplayBrightnessService.js';
import { SensorProxyService } from './lib/SensorProxyService.js';
import { BucketMapper } from './lib/BucketMapper.js';
import { KeyboardBacklightService } from './lib/KeyboardBacklightService.js';

// Backoff schedule (seconds) for retrying service startup after a transient
// failure (e.g. iio-sensor-proxy or gnome-settings-daemon not yet up on the
// bus at login/resume). The last value repeats for subsequent attempts.
const START_RETRY_DELAYS_SEC = [2, 5, 10, 30, 60];

// Safety net: if a manual-adjustment pause is never explicitly dismissed
// (the pause notification is non-transient, so it can sit unnoticed in the
// notification list), auto-resume after this long so the extension can't
// stay silently inert indefinitely.
const MANUAL_PAUSE_AUTO_RESUME_SEC = 15 * 60;

export default class AdaptiveBrightnessExtension extends Extension {
  enable() {
    this.settings = this.getSettings();
    this.notifications = new NotificationService(_);

    // Set up sleep/resume handling using GNOME Shell's LoginManager
    // When resuming from sleep, check light level immediately
    // This handles scenarios where we wake up in different lighting conditions
    // and might not receive ALS events (e.g., waking in darkness)
    this.loginManager = LoginManager.getLoginManager();

    this._enabled = true;
    this._startAttempt = 0;
    this._startRetryTimeout = null;

    this._startServices();
  }

  /**
   * (Re)create the service instances and attempt to start them.
   * On failure (e.g. a required D-Bus service isn't up yet), tears down
   * whatever partially started and retries with backoff instead of leaving
   * the extension permanently inert until the user manually toggles it.
   */
  _startServices() {
    const buckets = this._loadBucketsFromSettings();
    this.bucketMapper = new BucketMapper(buckets);
    this.displayBrightness = new DisplayBrightnessService();
    this.keyboardBacklight = new KeyboardBacklightService(this.settings);

    // Pass bucket boundary filter to sensor service for efficient event filtering
    this.sensorProxy = new SensorProxyService(
      this.bucketMapper.crossesBucketBoundary.bind(this.bucketMapper)
    );

    Promise.allSettled([
      this.displayBrightness.start(),
      this.keyboardBacklight.start(),
      this.sensorProxy.start(),
    ]).then((results) => {
      // Extension may have been disabled while these promises were pending
      if (!this._enabled) return;

      if (results.some((r) => r.status === 'rejected')) {
        console.error('Some required services failed to start, will retry:', results);

        this.sensorProxy?.destroy();
        this.displayBrightness?.destroy();
        this.keyboardBacklight?.destroy().catch((e) => console.error(e));

        this._scheduleStartRetry();
        return;
      }

      this._startAttempt = 0;
      this.setupHandlers();

      // Set initial brightness based on current light level
      this.adjustBrightnessForLightLevel(this.sensorProxy.dbus.lightLevel, true);
    });
  }

  _scheduleStartRetry() {
    const delaySec =
      START_RETRY_DELAYS_SEC[Math.min(this._startAttempt, START_RETRY_DELAYS_SEC.length - 1)];
    this._startAttempt++;

    if (this._startAttempt === 3) {
      this.notifications.showNotification(
        _('Adaptive Brightness Extension'),
        _('Required system services are not responding. Will keep retrying in the background.'),
        { transient: true }
      );
    }

    this._startRetryTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delaySec, () => {
      this._startRetryTimeout = null;
      if (this._enabled) this._startServices();
      return GLib.SOURCE_REMOVE;
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
        this.displayBrightness.paused = aboutToSuspend;
        if (aboutToSuspend) {
          this.sensorProxy.dbus.releaseLight();
        } else {
          this.sensorProxy.dbus.claimLight();
        }
      }
    );

    this.displayBrightness.onDisplayIsActiveChanged.add(() => {
      this.adjustBrightnessForLightLevel(this.sensorProxy.lastLuxValue, true);
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
        _('Adaptive Brightness Extension'),
        _('Ambient Light Sensor is not available. Extension will not function'),
        { transient: false }
      );
    }
  }

  handleGSDAmbientEnableChanged(val) {
    if (val) {
      this.notifications.showNotification(
        _('Adaptive Brightness Extension'),
        _(
          "GNOME's automatic brightness feature is enabled. Press to disable it in Settings → Power, allowing the extension to work properly."
        ),
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

    if (this._manualPauseTimeout) {
      GLib.source_remove(this._manualPauseTimeout);
    }
    this._manualPauseTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_LOW,
      MANUAL_PAUSE_AUTO_RESUME_SEC,
      () => {
        this._manualPauseTimeout = null;
        if (this.displayBrightness) this.displayBrightness.paused = false;
        return GLib.SOURCE_REMOVE;
      }
    );

    // Show notification with resume on dismiss
    this.notifications.showNotification(
      _('Adaptive Brightness'),
      _('Automatic brightness management is paused. Dismiss this notification to resume.'),
      {
        transient: false,
        onDestroy: () => {
          if (this._manualPauseTimeout) {
            GLib.source_remove(this._manualPauseTimeout);
            this._manualPauseTimeout = null;
          }
          if (this.displayBrightness) this.displayBrightness.paused = false;
        },
        action: {
          label: _('Settings'),
          callback: () => this.openPreferences(),
        },
      }
    );
  }

  adjustBrightnessForLightLevel(luxValue, immediate = false) {
    if (!this.displayBrightness || !this.keyboardBacklight) return;
    if (!this.displayBrightness.displayIsActive) {
      this.keyboardBacklight.handleDisplayInactive().catch((e) => console.error(e));
      return;
    }
    if (luxValue === null) {
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
    this._enabled = false;
    this._startAttempt = 0;

    if (this._startRetryTimeout) {
      GLib.source_remove(this._startRetryTimeout);
      this._startRetryTimeout = null;
    }

    if (this._manualPauseTimeout) {
      GLib.source_remove(this._manualPauseTimeout);
      this._manualPauseTimeout = null;
    }

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
      const kb = this.keyboardBacklight;
      this.keyboardBacklight = null;
      kb.destroy().catch((e) => console.error(e));
    }

    if (this.notifications) {
      this.notifications.destroy();
      this.notifications = null;
    }

    this.bucketMapper = null;
    this.settings = null;
  }
}
