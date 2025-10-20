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
    this._activeWatchActive = false;
    this._isInLowLight = false;
    this._idleTimeoutMs = 20000; // 20 seconds
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
      return true;
    } catch (error) {
      console.error('[KeyboardBacklightService] Failed to start:', error);
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
   * @private
   */
  async _addIdleWatch() {
    if (this._idleWatchActive) {
      return;
    }

    try {
      await this._idleMonitor.addIdleWatch(this._idleTimeoutMs, async (isIdle) => {
        if (isIdle) {
          await this._handleIdle();
        }
      });
      this._idleWatchActive = true;
    } catch (error) {
      console.error('[KeyboardBacklightService] Error adding idle watch:', error);
    }
  }

  /**
   * Handle user becoming idle - turn off backlight and watch for return
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

      // Remove idle watch and add active watch
      await this._idleMonitor.removeWatch();
      this._idleWatchActive = false;

      // Add watch for user becoming active again
      await this._addActiveWatch();
    } catch (error) {
      console.error('[KeyboardBacklightService] Error handling idle state:', error);
    }
  }

  /**
   * Add active watch to detect when user returns from idle
   * @private
   */
  async _addActiveWatch() {
    if (this._activeWatchActive) {
      return;
    }

    try {
      // Use a very short timeout (0ms) to detect any user activity
      await this._idleMonitor.addIdleWatch(0, async (isIdle) => {
        if (!isIdle) {
          await this._handleActive();
        }
      });
      this._activeWatchActive = true;
    } catch (error) {
      console.error('[KeyboardBacklightService] Error adding active watch:', error);
    }
  }

  /**
   * Handle user becoming active after being idle
   * @private
   */
  async _handleActive() {
    try {
      // Remove active watch
      await this._idleMonitor.removeWatch();
      this._activeWatchActive = false;

      // Re-enable backlight if still in low light conditions
      if (this._isInLowLight) {
        await this._enableBacklight();
      }
    } catch (error) {
      console.error('[KeyboardBacklightService] Error handling active state:', error);
    }
  }

  /**
   * Remove all active watches
   * @private
   */
  async _removeAllWatches() {
    if (this._idleWatchActive || this._activeWatchActive) {
      try {
        await this._idleMonitor.removeWatch();
      } catch (error) {
        console.error('[KeyboardBacklightService] Error removing watches:', error);
      }
      this._idleWatchActive = false;
      this._activeWatchActive = false;
    }
  }

  /**
   * Clean up resources
   */
  async destroy() {
    await this._removeAllWatches();
    this._idleMonitor.destroy();
    this._dbus.destroy();
  }
}
