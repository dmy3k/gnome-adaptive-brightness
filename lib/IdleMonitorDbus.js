import Gio from 'gi://Gio';

/**
 * D-Bus interface for GNOME Mutter's IdleMonitor
 * Monitors user idle/active state changes
 *
 * The IdleMonitor emits signals when the user becomes idle or active again.
 * This is useful for power management features like dimming displays or
 * disabling keyboard backlight when the user is away.
 */

const INTERFACE_XML = `<node>
<interface name="org.gnome.Mutter.IdleMonitor">
    <method name="AddIdleWatch">
        <arg name="interval" type="t" direction="in"/>
        <arg name="id" type="u" direction="out"/>
    </method>
    <method name="AddUserActiveWatch">
        <arg name="id" type="u" direction="out"/>
    </method>
    <method name="RemoveWatch">
        <arg name="id" type="u" direction="in"/>
    </method>
    <signal name="WatchFired">
        <arg name="id" type="u"/>
    </signal>
</interface>
</node>`;

export class IdleMonitorDbus {
  constructor() {
    this._proxy = null;
    this._watchId = null;
    this._activeWatchId = null;
    this._signalId = null;
    this._destroyed = false;
  }

  /**
   * Connect to the D-Bus idle monitor service
   * @returns {Promise<void>}
   */
  async connect() {
    const IdleMonitorProxy = Gio.DBusProxy.makeProxyWrapper(INTERFACE_XML);
    this._proxy = await new Promise((resolve, reject) => {
      new IdleMonitorProxy(
        Gio.DBus.session,
        'org.gnome.Mutter.IdleMonitor',
        '/org/gnome/Mutter/IdleMonitor/Core',
        (proxy, error) => {
          if (error) {
            reject(error);
          } else {
            resolve(proxy);
          }
        }
      );
    });

    // Set up the signal handler once during connection
    this._signalId = this._proxy.connectSignal('WatchFired', (proxy, sender, [watchIdRaw]) => {
      // Convert watchId to number in case it's a GVariant
      const watchId = typeof watchIdRaw === 'number' ? watchIdRaw : Number(watchIdRaw);

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
    });
  }

  /**
   * Start monitoring for idle state with the specified timeout
   * Can only be called once. To change timeout, call stopMonitoring() first.
   * @param {number} timeoutMs - Idle timeout in milliseconds
   * @param {Function} callback - Called when idle state changes (isIdle: boolean)
   * @returns {Promise<void>}
   */
  async startMonitoring(timeoutMs, callback) {
    if (!this._proxy) {
      throw new Error('D-Bus proxy not connected');
    }
    if (this.isMonitoring) {
      throw new Error('Idle monitoring already active. Call stopMonitoring() first.');
    }

    this._timeoutMs = timeoutMs;
    this._callback = callback;
    this._processingTransition = false;

    await this._addIdleWatchOnly();
  }

  /**
   * Check if idle monitoring is currently active
   * @returns {boolean}
   */
  get isMonitoring() {
    return this._watchId !== null || this._activeWatchId !== null;
  }

  /**
   * Handle transition to idle state
   * @private
   */
  async _handleIdleTransition() {
    if (this._destroyed) {
      return;
    }

    this._callback(true);
    await this._addActiveWatch();
  }

  /**
   * Handle transition to active state
   * @private
   */
  async _handleActiveTransition() {
    if (this._destroyed) {
      return;
    }

    // Clear active watch ID before calling callback
    const oldActiveId = this._activeWatchId;
    this._activeWatchId = null;

    // Call user callback
    this._callback(false);

    // Remove the old active watch (MUST await to ensure it's removed before re-adding idle watch)
    if (oldActiveId && oldActiveId > 0) {
      await this._removeWatchById(oldActiveId);
    }

    // Re-add idle watch for next cycle
    await this._addIdleWatchOnly();
  }

  /**
   * Internal method to add just the idle watch
   * @private
   */
  async _addIdleWatchOnly() {
    if (this._destroyed) {
      return;
    }

    // Remove old idle watch before adding new one (skip temporary markers)
    if (this._watchId !== null && this._watchId > 0) {
      await this._removeWatchById(this._watchId);
    }

    this._watchId = await new Promise((resolve, reject) => {
      this._proxy.AddIdleWatchAsync(this._timeoutMs, (result, error) => {
        if (error) {
          reject(error);
        } else {
          // The result might be a GVariant, convert to number
          const watchId = typeof result === 'number' ? result : Number(result);
          resolve(watchId);
        }
      });
    });
  }

  /**
   * Internal method to add active watch
   * @private
   */
  async _addActiveWatch() {
    if (this._destroyed) {
      return;
    }

    // Remove old active watch before adding new one (skip temporary markers)
    if (this._activeWatchId !== null && this._activeWatchId > 0) {
      await this._removeWatchById(this._activeWatchId);
    }

    this._activeWatchId = await new Promise((resolve, reject) => {
      this._proxy.AddUserActiveWatchAsync((result, error) => {
        if (error) {
          reject(error);
        } else {
          // The result might be a GVariant, convert to number
          const watchId = typeof result === 'number' ? result : Number(result);
          resolve(watchId);
        }
      });
    });
  }

  /**
   * Internal helper to remove a watch by ID
   * @private
   */
  async _removeWatchById(watchId) {
    if (!this._proxy || !watchId) {
      return;
    }

    await new Promise((resolve, reject) => {
      this._proxy.RemoveWatchAsync(watchId, (result, error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Stop monitoring for idle state and remove all watches
   * @returns {Promise<void>}
   */
  async stopMonitoring() {
    if (!this._proxy) {
      return;
    }

    // Remove idle watch if exists (skip temporary markers)
    if (this._watchId !== null && this._watchId > 0) {
      await this._removeWatchById(this._watchId);
    }

    // Remove active watch if exists (skip temporary markers)
    if (this._activeWatchId !== null && this._activeWatchId > 0) {
      await this._removeWatchById(this._activeWatchId);
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
    if (this._signalId !== null && this._proxy) {
      this._proxy.disconnectSignal(this._signalId);
      this._signalId = null;
    }

    // Fire off async watch removal (don't await - destroy must be synchronous)
    this.stopMonitoring().catch((e) => {
      console.warn(`[IdleMonitorDbus] Failed to remove watches during destroy:`, e);
    });

    this._proxy = null;
    this._callback = null;
  }
}
