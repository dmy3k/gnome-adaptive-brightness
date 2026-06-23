import GLib from 'gi://GLib';
import { SensorProxyDbus } from './SensorProxyDbus.js';
import { CallbackManager } from './CallbackManager.js';

/**
 * Service for managing IIO sensor proxy communication
 * Handles business logic, throttling
 */
export class SensorProxyService {
  constructor(filterFn = null) {
    // D-Bus sensor proxy control
    this.dbus = new SensorProxyDbus();
    this._signalId = null;
    this._nameOwnerSignalId = null;
    this._currentNameOwner = null;

    // Filtering function: (previousLux, currentLux) => boolean
    this._filterFn = filterFn;
    this._lastLuxValue = null;

    // Throttling
    this._pendingTimeout = null;
    this._throttleTimeoutMs = 1000;
    this._lastUpdateTime = 0;

    // Lifecycle management
    this._destroyed = false;

    // Public callback managers
    this.onLightLevelChanged = new CallbackManager();
    this.onSensorAvailableChanged = new CallbackManager();
  }

  async start() {
    await this.dbus.connect();
    this._signalId = this.dbus.onPropertiesChanged(this._onPropertiesChanged.bind(this));
    this._nameOwnerSignalId = this.dbus.onNameOwnerChanged(this._onNameOwnerChanged.bind(this));
    this._currentNameOwner = this.dbus.nameOwner;
    await this.dbus.claimLight();
    this._enterSettlingMode();
  }

  /**
   * Handle iio-sensor-proxy daemon owner changes. The existing ClaimLight()
   * dies with the old daemon, so when a new owner appears we must re-claim
   * to keep receiving LightLevel updates.
   */
  _onNameOwnerChanged() {
    const previousOwner = this._currentNameOwner;
    const newOwner = this.dbus.nameOwner;
    this._currentNameOwner = newOwner;

    if (newOwner === null) {
      return;
    }

    if (newOwner === previousOwner) {
      return;
    }

    this._lastLuxValue = null;
    this._enterSettlingMode();
    this.dbus.claimLight().catch((e) => {
      console.error('Failed to re-claim light sensor after daemon restart:', e);
    });
  }

  /**
   * Last lux value committed after the settle/throttle window.
   * Returns null if no reading has been processed since the last connect or
   * daemon restart (i.e. the sensor is still settling).
   */
  get lastLuxValue() {
    return this._lastLuxValue;
  }

  /**
   * Handle D-Bus properties changed signals
   * @param {Object} proxy - D-Bus proxy object
   * @param {Object} changed - Changed properties
   * @param {Object} invalidated - Invalidated properties
   */
  _onPropertiesChanged(proxy, changed, invalidated) {
    // Check if LightLevel property changed
    const lightLevel = changed.lookup_value('LightLevel', null);
    if (lightLevel) {
      const level = lightLevel.get_double();
      this._handleLightLevelChange(level);
    }

    // Also check HasAmbientLight property
    const hasAmbientLight = changed.lookup_value('HasAmbientLight', null);
    if (hasAmbientLight) {
      const newValue = hasAmbientLight.get_boolean();
      this.onSensorAvailableChanged.invoke(newValue);
    }
  }

  /**
   * Begin a settling window after sensor connect or daemon restart.
   *
   * Cancels any pending timeout and resets the throttle timer so that
   * rapid initial readings are suppressed. After the throttle interval,
   * if no lux update has been committed yet (_lastLuxValue is still null),
   * the current D-Bus LightLevel value is read directly and committed,
   * ensuring at least one valid reading is processed after the sensor settles.
   */
  _enterSettlingMode() {
    if (this._pendingTimeout) {
      GLib.source_remove(this._pendingTimeout);
      this._pendingTimeout = null;
    }
    this._lastUpdateTime = Date.now();

    this._pendingTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, this._throttleTimeoutMs, () => {
      this._pendingTimeout = null;
      if (!this._destroyed && this._lastLuxValue === null) {
        const level = this.dbus.lightLevel;
        if (level !== null) this._processLightLevelUpdate(level);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * Handle light level changes with debouncing and threshold filtering
   * @param {number} level - New light level in lux
   * @param {boolean} forceUpdate - If true, bypass threshold filtering
   */
  _handleLightLevelChange(level, forceUpdate = false) {
    // Check if this change should be filtered
    if (!forceUpdate && this._filterFn && !this._filterFn(this._lastLuxValue, level)) {
      // Update our tracking but don't invoke callbacks
      this._lastLuxValue = level;
      return;
    }

    // If we updated recently, schedule a delayed update
    if (Date.now() - this._lastUpdateTime < this._throttleTimeoutMs) {
      if (this._pendingTimeout) {
        GLib.source_remove(this._pendingTimeout);
      }

      this._pendingTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, this._throttleTimeoutMs, () => {
        this._pendingTimeout = null;
        // Check if service was destroyed while timeout was pending
        if (this._destroyed) {
          return GLib.SOURCE_REMOVE;
        }
        this._processLightLevelUpdate(level);
        return GLib.SOURCE_REMOVE;
      });
      return;
    }

    // Process immediately if enough time has passed
    this._processLightLevelUpdate(level);
  }

  /**
   * Process light level update
   * @param {number} level - Light level in lux
   */
  _processLightLevelUpdate(level) {
    this._lastUpdateTime = Date.now();
    this._lastLuxValue = level;
    this.onLightLevelChanged.invoke(level);
  }

  destroy() {
    this._destroyed = true;

    // Clear pending timeout
    if (this._pendingTimeout) {
      GLib.source_remove(this._pendingTimeout);
      this._pendingTimeout = null;
    }

    // Cleanup D-Bus connections
    if (this.dbus && this._signalId) {
      this.dbus.disconnectListener(this._signalId);
      this._signalId = null;
    }

    if (this.dbus && this._nameOwnerSignalId) {
      this.dbus.disconnectListener(this._nameOwnerSignalId);
      this._nameOwnerSignalId = null;
    }

    // Release the light sensor
    if (this.dbus) {
      this.dbus.releaseLight();
      this.dbus.destroy();
    }

    // Clear callback managers
    this.onLightLevelChanged.clear();
    this.onSensorAvailableChanged.clear();
  }
}
