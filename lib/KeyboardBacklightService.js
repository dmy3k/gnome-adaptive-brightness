import { KeyboardBacklightDbus } from './KeyboardBacklightDbus.js';
import { IdleMonitorDbus } from './IdleMonitorDbus.js';

/**
 * Service layer for managing keyboard backlight with idle detection
 * Handles the coordination between keyboard backlight hardware and idle monitoring
 *
 * Business Logic:
 * - Enable backlight for user-configured brightness buckets
 * - Monitor for user idle state when backlight is on
 * - Disable backlight when user goes idle (only if auto-enabled)
 * - Re-enable backlight when user becomes active in enabled buckets
 */
export class KeyboardBacklightService {
  constructor(settings) {
    this._settings = settings;
    this._dbus = new KeyboardBacklightDbus();
    this._idleMonitor = new IdleMonitorDbus();
    this._isInLowLight = false;
    this._userIsIdle = false; // Track whether user is currently idle
    this._settingsSignalId = null;
    this._monitoringSessionId = 0; // Track monitoring sessions to ignore stale callbacks
    this._enabledBuckets = null;
  }

  _getEnabledKeyboardBuckets() {
    const bucketsVariant = this._settings.get_value('keyboard-backlight-buckets');
    const enabledBuckets = new Set();

    for (let i = 0; i < bucketsVariant.n_children(); i++) {
      enabledBuckets.add(bucketsVariant.get_child_value(i).get_uint32());
    }

    return enabledBuckets;
  }

  get isAvailable() {
    return this._dbus.isAvailable;
  }

  /**
   * Initialize the service
   * @returns {Promise<boolean>} True if keyboard backlight is available
   */
  async start() {
    try {
      await this._dbus.connect();
      if (!this._dbus.isAvailable) {
        return false;
      }

      await this._idleMonitor.connect();

      // Listen for settings changes
      this._settingsSignalId = this._settings.connect(
        'changed',
        this._onSettingsChanged.bind(this)
      );

      this._enabledBuckets = this._getEnabledKeyboardBuckets();

      return true;
    } catch (error) {
      console.error('[KeyboardBacklightService] Failed to start:', error);
      // Clean up partial state on error
      this._dbus.destroy();
      this._idleMonitor.destroy();
      if (this._settingsSignalId) {
        this._settings.disconnect(this._settingsSignalId);
        this._settingsSignalId = null;
      }
      return false;
    }
  }

  /**
   * Update keyboard backlight based on current ambient light conditions
   * @param {number} currentBucketIndex - Current bucket index
   * @returns {Promise<void>}
   */
  async updateForBrightnessBucket(currentBucketIndex) {
    if (!this._dbus.isAvailable) {
      return;
    }

    this._currentBucket = currentBucketIndex;
    this._isInLowLight = this._enabledBuckets?.has(currentBucketIndex);

    if (this._isInLowLight) {
      // Enable backlight ONLY if user is not idle
      if (!this._userIsIdle) {
        await this._enableBacklight();
      }
    } else {
      // Disable backlight - always disable regardless of idle state
      await this._disableBacklight();
    }
  }

  /**
   * Handle display state changes (active/inactive)
   * Turns off keyboard backlight when display is dimmed or off
   * @returns {Promise<void>}
   */
  async handleDisplayInactive() {
    if (!this._dbus.isAvailable) {
      return;
    }

    await this._disableBacklight();
  }

  /**
   * Enable keyboard backlight and start monitoring for idle state
   * @private
   */
  async _enableBacklight() {
    try {
      await this._dbus.setBrightness(1);
      await this._startIdleMonitoring();
    } catch (error) {
      console.error('[KeyboardBacklightService] Error enabling backlight:', error);
    }
  }

  /**
   * Disable keyboard backlight and stop idle monitoring
   * @private
   */
  async _disableBacklight() {
    try {
      await this._dbus.setBrightness(0);
      await this._stopIdleMonitoring();
      // Reset idle state when disabling - ensures clean state
      this._userIsIdle = false;
    } catch (error) {
      console.error('[KeyboardBacklightService] Error disabling backlight:', error);
    }
  }

  /**
   * Start monitoring for user idle state
   * @private
   */
  async _startIdleMonitoring() {
    // Increment session ID FIRST to invalidate any pending callbacks from previous sessions
    const sessionId = ++this._monitoringSessionId;

    if (this._idleMonitor.isMonitoring) {
      return;
    }

    try {
      const idleTimeout = this._settings.get_uint('keyboard-idle-timeout') * 1000;

      await this._idleMonitor.startMonitoring(idleTimeout, async (isIdle) => {
        // Ignore callbacks from old monitoring sessions
        if (sessionId !== this._monitoringSessionId) {
          return;
        }

        try {
          if (isIdle) {
            await this._handleIdle();
          } else {
            await this._handleActive();
          }
        } catch (error) {
          console.error('[KeyboardBacklightService] Error in idle/active handler:', error);
          // Reset to clean state on error to prevent stuck watches
          this._stopIdleMonitoring().catch(() => { });
        }
      });
    } catch (error) {
      console.error('[KeyboardBacklightService] Error starting idle monitoring:', error);
    }
  }

  /**
   * Handle user becoming idle - turn off backlight
   * Note: IdleMonitorDbus will automatically add active watch
   * @private
   */
  async _handleIdle() {
    this._userIsIdle = true;

    try {
      if (this._dbus.isEnabled) {
        await this._dbus.setBrightness(0);
      }
    } catch (error) {
      console.error('[KeyboardBacklightService] Error handling idle state:', error);
    }
  }

  /**
   * Handle user becoming active after being idle
   * Called by IdleMonitorDbus when user activity is detected
   * @private
   */
  async _handleActive() {
    this._userIsIdle = false;

    try {
      // Re-enable backlight if still in low light conditions
      if (this._isInLowLight && this._idleMonitor.isMonitoring) {
        await this._dbus.setBrightness(1);
        // IdleMonitorDbus automatically re-adds idle watch in its internal cycling
        // Monitoring continues automatically
      } else {
        // User came back but it's no longer dark, or monitoring was stopped externally
        // Stop monitoring to clean up any remaining watches
        await this._stopIdleMonitoring();
      }
    } catch (error) {
      console.error('[KeyboardBacklightService] Error handling active state:', error);
      // On error, attempt cleanup
      this._stopIdleMonitoring().catch(() => { });
    }
  }

  /**
   * Stop idle monitoring
   * @private
   */
  async _stopIdleMonitoring() {
    try {
      await this._idleMonitor.stopMonitoring();
    } catch (error) {
      console.error('[KeyboardBacklightService] Error stopping idle monitoring:', error);
    }
  }

  /**
   * Handle settings changes
   * @param {Gio.Settings} settings - Settings object
   * @param {string} key - The key that changed
   * @private
   */
  async _onSettingsChanged(settings, key) {
    if (key === 'keyboard-idle-timeout') {
      if (this._idleMonitor.isMonitoring) {
        // Stop current monitoring
        await this._stopIdleMonitoring();
        // Restart with new timeout if backlight is still enabled
        if (this._isInLowLight) {
          await this._startIdleMonitoring();
        }
      }
    } else if (key === 'keyboard-backlight-buckets') {
      this._enabledBuckets = this._getEnabledKeyboardBuckets();
      this.updateForBrightnessBucket(this._currentBucket);
    }
  }

  async destroy() {
    if (this._settingsSignalId) {
      this._settings.disconnect(this._settingsSignalId);
      this._settingsSignalId = null;
    }

    await this._stopIdleMonitoring();
    this._idleMonitor.destroy();
    this._dbus.destroy();

    this._enabledBuckets = null;
    this._currentBucket = null;
  }
}
