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

    // Set up the signal handler to catch all WatchFired events
    this._signalId = this._proxy.connect(
      'g-signal',
      (proxy, senderName, signalName, parameters) => {
        if (signalName === 'WatchFired') {
          const [watchId] = parameters.deep_unpack();
          if (watchId === this._watchId) {
            // User became idle
            this._callback(true);
            // Add active watch to detect when user becomes active again
            this._addActiveWatch().catch((e) =>
              console.error('[IdleMonitor] Error adding active watch:', e)
            );
          } else if (watchId === this._activeWatchId) {
            // User became active
            this._callback(false);
            // Re-add idle watch for next cycle
            this._addIdleWatchOnly().catch((e) =>
              console.error('[IdleMonitor] Error re-adding idle watch:', e)
            );
          }
        }
      }
    );

    // Start with idle watch
    await this._addIdleWatchOnly();
  }

  /**
   * Internal method to add just the idle watch
   * @private
   */
  async _addIdleWatchOnly() {
    try {
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
    try {
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
   * Remove the current idle watch
   * @returns {Promise<void>}
   */
  async removeWatch() {
    if (!this._proxy || !this._watchId) {
      return;
    }

    try {
      // Remove idle watch
      await new Promise((resolve, reject) => {
        this._proxy.call(
          'RemoveWatch',
          new GLib.Variant('(u)', [this._watchId]),
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

      // Remove active watch
      if (this._activeWatchId) {
        await new Promise((resolve, reject) => {
          this._proxy.call(
            'RemoveWatch',
            new GLib.Variant('(u)', [this._activeWatchId]),
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
      }
    } catch (error) {
      console.error('Failed to remove idle watch:', error);
    }

    this._watchId = null;
    this._activeWatchId = null;
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this._signalId && this._proxy) {
      this._proxy.disconnect(this._signalId);
      this._signalId = null;
    }

    // Note: We don't call removeWatch() here as it's async and destroy() should be sync
    // The watch will be cleaned up when the extension is disabled
    this._watchId = null;
    this._activeWatchId = null;
    this._proxy = null;
  }
}
