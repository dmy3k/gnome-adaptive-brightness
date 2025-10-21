import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * D-Bus interface for GNOME Mutter's IdleMonitor
 * Monitors user idle/active state changes
 *
 * The IdleMonitor emits signals when the user becomes idle or active again.
 * This is useful for power management features like dimming displays or
 * disabling keyboard backlight when the user is away.
 */
export class IdleMonitorDbus {
  constructor() {
    this._proxy = null;
    this._watchId = null;
    this._activeWatchId = null;
    this._destroyed = false;
  }

  /**
   * Connect to the D-Bus idle monitor service
   * @returns {Promise<void>}
   */
  async connect() {
    this._proxy = await new Promise((resolve, reject) => {
      Gio.DBusProxy.new(
        Gio.bus_get_sync(Gio.BusType.SESSION, null),
        Gio.DBusProxyFlags.NONE,
        null,
        'org.gnome.Mutter.IdleMonitor',
        '/org/gnome/Mutter/IdleMonitor/Core',
        'org.gnome.Mutter.IdleMonitor',
        null,
        (source, result) => {
          try {
            const proxy = Gio.DBusProxy.new_finish(result);
            resolve(proxy);
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }

  /**
   * Add an idle watch with the specified timeout
   * @param {number} timeoutMs - Idle timeout in milliseconds
   * @param {Function} callback - Called when idle state changes (isIdle: boolean)
   * @returns {Promise<void>}
   */
  async addIdleWatch(timeoutMs, callback) {
    if (!this._proxy) {
      throw new Error('D-Bus proxy not connected');
    }

    this._timeoutMs = timeoutMs;
    this._callback = callback;
    this._processingTransition = false;

    // Set up the signal handler to catch all WatchFired events
    this._signalId = this._proxy.connect(
      'g-signal',
      (proxy, senderName, signalName, parameters) => {
        if (signalName === 'WatchFired') {
          const [watchId] = parameters.deep_unpack();

          // Ignore signals if we're destroyed or already processing a transition
          if (this._destroyed || this._processingTransition) {
            return;
          }

          // Ignore signals from watches that aren't ours
          if (watchId !== this._watchId && watchId !== this._activeWatchId) {
            return;
          }

          // Handle idle transition (idle watch fired, no active watch exists)
          if (watchId === this._watchId && !this._activeWatchId) {
            this._processingTransition = true;
            this._handleIdleTransition()
              .catch((e) => console.error('[IdleMonitor] Error in idle transition:', e))
              .finally(() => {
                this._processingTransition = false;
              });
          }
          // Handle active transition (active watch fired)
          else if (watchId === this._activeWatchId && this._activeWatchId > 0) {
            this._processingTransition = true;
            this._handleActiveTransition()
              .catch((e) => console.error('[IdleMonitor] Error in active transition:', e))
              .finally(() => {
                this._processingTransition = false;
              });
          }
        }
      }
    );

    // Start with idle watch
    await this._addIdleWatchOnly();
  }

  /**
   * Handle transition to idle state
   * @private
   */
  async _handleIdleTransition() {
    if (this._destroyed) return;

    try {
      // Call user callback
      this._callback(true);

      // Add active watch to detect when user becomes active again
      await this._addActiveWatch();
    } catch (error) {
      console.error('[IdleMonitor] Error handling idle transition:', error);
      throw error;
    }
  }

  /**
   * Handle transition to active state
   * @private
   */
  async _handleActiveTransition() {
    if (this._destroyed) return;

    try {
      // Clear active watch ID before calling callback
      const oldActiveId = this._activeWatchId;
      this._activeWatchId = null;

      // Call user callback
      this._callback(false);

      // Remove the old active watch
      if (oldActiveId && oldActiveId > 0) {
        this._removeWatchById(oldActiveId);
      }

      // Re-add idle watch for next cycle
      await this._addIdleWatchOnly();
    } catch (error) {
      console.error('[IdleMonitor] Error handling active transition:', error);
      throw error;
    }
  }
  /**
   * Internal method to add just the idle watch
   * @private
   */
  async _addIdleWatchOnly() {
    if (this._destroyed) return;

    try {
      // Remove old idle watch before adding new one (skip temporary markers)
      if (this._watchId !== null && this._watchId > 0) {
        await this._removeWatchById(this._watchId);
      }

      const watchIdResult = await new Promise((resolve, reject) => {
        this._proxy.call(
          'AddIdleWatch',
          new GLib.Variant('(t)', [this._timeoutMs]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (source, result) => {
            try {
              const watchResult = source.call_finish(result);
              resolve(watchResult.deep_unpack()[0]);
            } catch (error) {
              reject(error);
            }
          }
        );
      });

      this._watchId = watchIdResult;
    } catch (error) {
      console.error('Failed to add idle watch:', error);
      throw error;
    }
  }

  /**
   * Internal method to add active watch
   * @private
   */
  async _addActiveWatch() {
    if (this._destroyed) return;

    try {
      // Remove old active watch before adding new one (skip temporary markers)
      if (this._activeWatchId !== null && this._activeWatchId > 0) {
        await this._removeWatchById(this._activeWatchId);
      }

      const activeWatchResult = await new Promise((resolve, reject) => {
        this._proxy.call(
          'AddUserActiveWatch',
          null,
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (source, result) => {
            try {
              const watchResult = source.call_finish(result);
              resolve(watchResult.deep_unpack()[0]);
            } catch (error) {
              reject(error);
            }
          }
        );
      });

      this._activeWatchId = activeWatchResult;
    } catch (error) {
      console.error('Failed to add active watch:', error);
      throw error;
    }
  }

  /**
   * Internal helper to remove a watch by ID
   * @private
   */
  async _removeWatchById(watchId) {
    if (!this._proxy || !watchId) {
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        this._proxy.call(
          'RemoveWatch',
          new GLib.Variant('(u)', [watchId]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (source, result) => {
            try {
              source.call_finish(result);
              resolve();
            } catch (error) {
              reject(error);
            }
          }
        );
      });
    } catch (error) {
      console.error(`[IdleMonitorDbus] Failed to remove watch ${watchId}:`, error);
    }
  }

  /**
   * Remove the current idle watch
   * Disconnects signal handler first to prevent race conditions
   * @returns {Promise<void>}
   */
  async removeWatch() {
    if (!this._proxy) {
      return;
    }

    // Disconnect signal handler FIRST to prevent signals during watch removal
    if (this._signalId && this._proxy) {
      this._proxy.disconnect(this._signalId);
      this._signalId = null;
    }

    try {
      // Remove idle watch if exists (skip temporary markers)
      if (this._watchId !== null && this._watchId > 0) {
        await this._removeWatchById(this._watchId);
      }

      // Remove active watch if exists (skip temporary markers)
      if (this._activeWatchId !== null && this._activeWatchId > 0) {
        await this._removeWatchById(this._activeWatchId);
      }
    } catch (error) {
      console.error('[IdleMonitorDbus] Failed to remove watches:', error);
    }

    this._watchId = null;
    this._activeWatchId = null;
  }

  /**
   * Clean up resources
   * Note: destroy() is synchronous but we fire off async watch removal
   * and catch any errors to prevent unhandled rejections.
   */
  destroy() {
    this._destroyed = true;

    // Disconnect signal handler first to prevent new signals during cleanup
    if (this._signalId && this._proxy) {
      this._proxy.disconnect(this._signalId);
      this._signalId = null;
    }

    // Fire off async watch removal (don't await - destroy must be synchronous)
    // Use .catch() to handle any errors and prevent unhandled promise rejections
    if (this._proxy) {
      if (this._watchId !== null && this._watchId > 0) {
        this._removeWatchById(this._watchId).catch((error) => {
          console.warn(`[IdleMonitorDbus] Failed to remove idle watch during destroy:`, error);
        });
      }
      if (this._activeWatchId !== null && this._activeWatchId > 0) {
        this._removeWatchById(this._activeWatchId).catch((error) => {
          console.warn(`[IdleMonitorDbus] Failed to remove active watch during destroy:`, error);
        });
      }
    }

    this._watchId = null;
    this._activeWatchId = null;
    this._proxy = null;
    this._callback = null;
  }
}
