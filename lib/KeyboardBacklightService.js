import { KeyboardBacklightDbus } from './KeyboardBacklightDbus.js';
import { IdleMonitorDbus } from './IdleMonitorDbus.js';

/**
 * Service layer for managing keyboard backlight with idle detection
 * Handles the coordination between keyboard backlight hardware and idle monitoring
 *
 * Business Logic:
 * - Enable backlight in low light conditions
 * - Monitor for user idle state when backlight is on
 * - Disable backlight when user goes idle (only if auto-enabled)
 * - Re-enable backlight when user becomes active in low light
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
  }

  /**
   * Get the idle timeout in milliseconds from settings
   * @private
   */
  get _idleTimeoutMs() {
    return this._settings.get_uint('keyboard-idle-timeout') * 1000;
  }

  /**
   * Check if keyboard backlight hardware is available
   * @returns {boolean} True if hardware is available
   */
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
   * @param {boolean} isInLowestBucket - True if in the lowest brightness bucket (darkest)
   * @returns {Promise<void>}
   */
  async updateForLightLevel(isInLowestBucket) {
    if (!this._dbus.isAvailable || !this._settings.get_boolean('auto-keyboard-backlight')) {
      return;
    }

    this._isInLowLight = isInLowestBucket;

    if (isInLowestBucket) {
      // Enable backlight in low light ONLY if user is not idle
      if (!this._userIsIdle) {
        await this._enableBacklight();
      }
    } else {
      // Disable backlight in bright light
      if (!this._userIsIdle) {
        await this._disableBacklight();
      } else {
        // User is idle and light increased - turn off backlight AND stop monitoring
        try {
          await this._dbus.setBrightness(0);
          await this._stopIdleMonitoring();
          // Reset idle flag since we're no longer monitoring
          this._userIsIdle = false;
        } catch (error) {
          console.error('[KeyboardBacklightService] Error disabling backlight:', error);
        }
      }
    }
  }

  /**
   * Handle display state changes (active/inactive)
   * Turns off keyboard backlight when display is dimmed or off
   * @returns {Promise<void>}
   */
  async handleDisplayInactive() {
    if (!this._dbus.isAvailable || !this._settings.get_boolean('auto-keyboard-backlight')) {
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
    } catch (error) {
      console.error('[KeyboardBacklightService] Error disabling backlight:', error);
    }
  }

  /**
   * Start monitoring for user idle state
   * @private
   */
  async _startIdleMonitoring() {
    if (this._idleMonitor.isMonitoring) {
      return;
    }

    // Increment session ID to invalidate any pending callbacks from previous sessions
    const sessionId = ++this._monitoringSessionId;

    try {
      await this._idleMonitor.startMonitoring(this._idleTimeoutMs, async (isIdle) => {
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
          this._stopIdleMonitoring().catch(() => {});
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
      if (this._isInLowLight) {
        await this._dbus.setBrightness(1);
        // IdleMonitorDbus automatically re-adds idle watch in its internal cycling
        // Monitoring continues automatically
      } else {
        // User came back but it's no longer dark, so stop monitoring
        await this._stopIdleMonitoring();
      }
    } catch (error) {
      console.error('[KeyboardBacklightService] Error handling active state:', error);
      // On error, attempt cleanup
      this._stopIdleMonitoring().catch(() => {});
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
    if (key === 'auto-keyboard-backlight') {
      const enabled = this._settings.get_boolean('auto-keyboard-backlight');
      if (!enabled) {
        // Feature disabled, clean up watches and turn off backlight
        await this._disableBacklight();
      }
    } else if (key === 'keyboard-idle-timeout') {
      if (this._idleMonitor.isMonitoring) {
        // Stop current monitoring
        await this._stopIdleMonitoring();
        // Restart with new timeout if backlight is still enabled
        if (this._isInLowLight) {
          await this._startIdleMonitoring();
        }
      }
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
  }
}
