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
    this._idleWatchActive = false;
    this._isInLowLight = false;
    this._idleTimeoutMs = 10000;
    this._settingsSignalId = null;
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

      // Listen for settings changes to clean up when feature is disabled
      this._settingsSignalId = this._settings.connect(
        'changed::auto-keyboard-backlight',
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
   * Check if keyboard backlight hardware is available
   * @returns {boolean}
   */
  get isAvailable() {
    return this._dbus.isAvailable;
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
      // Enable backlight in low light
      await this._enableBacklight();
    } else {
      // Disable backlight in bright light
      await this._disableBacklight();
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

      // Only add idle watch if backlight is now actually on
      if (this._dbus.isEnabled && !this._idleWatchActive) {
        await this._addIdleWatch();
      }
    } catch (error) {
      console.error('[KeyboardBacklightService] Error enabling backlight:', error);
    }
  }

  /**
   * Disable keyboard backlight and remove any active watches
   * @private
   */
  async _disableBacklight() {
    try {
      await this._dbus.setBrightness(0);
      await this._removeAllWatches();
    } catch (error) {
      console.error('[KeyboardBacklightService] Error disabling backlight:', error);
    }
  }

  /**
   * Add idle watch to detect when user goes idle
   * The callback will be called with isIdle=true when user goes idle,
   * and isIdle=false when user becomes active again (IdleMonitorDbus handles cycling)
   * @private
   */
  async _addIdleWatch() {
    if (this._idleWatchActive) {
      return;
    }

    try {
      await this._idleMonitor.addIdleWatch(this._idleTimeoutMs, async (isIdle) => {
        try {
          if (isIdle) {
            await this._handleIdle();
          } else {
            await this._handleActive();
          }
        } catch (error) {
          console.error('[KeyboardBacklightService] Error in idle/active handler:', error);
          // Reset to clean state on error to prevent stuck watches
          this._idleWatchActive = false;
          this._idleMonitor.removeWatch().catch(() => {});
        }
      });
      this._idleWatchActive = true;
    } catch (error) {
      console.error('[KeyboardBacklightService] Error adding idle watch:', error);
    }
  }

  /**
   * Handle user becoming idle - turn off backlight
   * Note: IdleMonitorDbus will automatically add active watch
   * @private
   */
  async _handleIdle() {
    // Only disable if backlight is currently enabled
    if (!this._dbus.isEnabled) {
      return;
    }

    try {
      // Turn off backlight
      await this._dbus.setBrightness(0);

      // Note: IdleMonitorDbus automatically transitions to active watch
      // We just need to wait for the callback with isIdle=false
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
    try {
      // Re-enable backlight if still in low light conditions
      if (this._isInLowLight) {
        await this._dbus.setBrightness(1);
        // IdleMonitorDbus automatically re-adds idle watch in its internal cycling
        // Keep our flag in sync - watch IS still active (no action needed)
      } else {
        // User came back but it's no longer dark, so clean up watch state
        // Order matters: remove watch THEN reset flag to maintain consistency
        await this._idleMonitor.removeWatch();
        this._idleWatchActive = false;
      }
    } catch (error) {
      console.error('[KeyboardBacklightService] Error handling active state:', error);
      // On error, assume watches are in unknown state - reset to clean state
      this._idleWatchActive = false;
      // Attempt cleanup but don't fail if it errors
      this._idleMonitor.removeWatch().catch(() => {});
    }
  }

  /**
   * Remove all active watches
   * @private
   */
  async _removeAllWatches() {
    if (this._idleWatchActive) {
      try {
        await this._idleMonitor.removeWatch();
      } catch (error) {
        console.error('[KeyboardBacklightService] Error removing watches:', error);
      }
      this._idleWatchActive = false;
    }
  }

  /**
   * Handle settings changes for auto-keyboard-backlight
   * @private
   */
  async _onSettingsChanged() {
    const enabled = this._settings.get_boolean('auto-keyboard-backlight');
    if (!enabled) {
      // Feature disabled, clean up watches and turn off backlight
      await this._disableBacklight();
    }
  }

  /**
   * Clean up resources
   */
  async destroy() {
    // Disconnect settings listener
    if (this._settingsSignalId) {
      this._settings.disconnect(this._settingsSignalId);
      this._settingsSignalId = null;
    }

    await this._removeAllWatches();
    this._idleMonitor.destroy();
    this._dbus.destroy();
  }
}
