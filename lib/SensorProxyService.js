import GLib from "gi://GLib";
import { SensorProxyDbus } from "./SensorProxyDbus.js";
import { CallbackManager } from "./CallbackManager.js";

/**
 * Service for managing IIO sensor proxy communication
 * Handles business logic, throttling, and polling
 */
export class SensorProxyService {
  constructor() {
    // D-Bus sensor proxy control
    this.dbus = new SensorProxyDbus();
    this._signalId = null;

    // Throttling
    this._pendingTimeout = null;
    this._throttleTimeoutMs = 2000;
    this._lastUpdateTime = 0;
    this._lastUpdateValue = null;

    // Polling to pickup any light changes not signalled by sensor
    this._pollTimeout = null;
    this._pollIntervalMs = 120000;

    // Public callback managers
    this.onLightLevelChanged = new CallbackManager();
    this.onSensorAvailableChanged = new CallbackManager();
  }

  async start() {
    await this.dbus.connect();

    this._signalId = this.dbus.onPropertiesChanged(
      this._onPropertiesChanged.bind(this)
    );

    await this.dbus.claimLight();

    this._startPolling();
  }

  /**
   * Handle D-Bus properties changed signals
   * @param {Object} proxy - D-Bus proxy object
   * @param {Object} changed - Changed properties
   * @param {Object} invalidated - Invalidated properties
   */
  _onPropertiesChanged(proxy, changed, invalidated) {
    // Check if LightLevel property changed
    const lightLevel = changed.lookup_value("LightLevel", null);
    if (lightLevel) {
      const level = lightLevel.get_double();
      this._handleLightLevelChange(level);
    }

    // Also check HasAmbientLight property
    const hasAmbientLight = changed.lookup_value("HasAmbientLight", null);
    if (hasAmbientLight) {
      const newValue = hasAmbientLight.get_boolean();
      this.onSensorAvailableChanged.invoke(newValue);
    }
  }

  /**
   * Handle light level changes with debouncing
   * @param {number} level - New light level in lux
   */
  _handleLightLevelChange(level) {
    const now = Date.now();

    // If we updated recently, schedule a delayed update
    if (now - this._lastUpdateTime < this._throttleTimeoutMs) {
      if (this._pendingTimeout) {
        GLib.source_remove(this._pendingTimeout);
      }

      this._pendingTimeout = GLib.timeout_add(
        GLib.PRIORITY_LOW,
        this._throttleTimeoutMs,
        () => {
          this._pendingTimeout = null;
          this._processLightLevelUpdate(level);
          return GLib.SOURCE_REMOVE;
        }
      );
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
    this._lastUpdateValue = level;
    this.onLightLevelChanged.invoke(level);
  }

  _startPolling() {
    this._stopPolling();

    // fresh light level reading on service start
    this._poll();

    this._pollTimeout = GLib.timeout_add(
      GLib.PRIORITY_LOW,
      this._pollIntervalMs,
      () => {
        this._poll();
        return GLib.SOURCE_CONTINUE;
      }
    );
  }

  _poll() {
    try {
      const lvl = this.dbus?.lightLevel;
      const isDue = Date.now() - this._lastUpdateTime > this._pollIntervalMs;
      const shouldUpdate = isDue && Math.abs(lvl - this._lastUpdateValue) > 1;

      if (shouldUpdate) {
        this._processLightLevelUpdate(lvl);
      }
    } catch (error) {
      console.error("SensorProxyService: Polling error:", error);
    }
  }

  _stopPolling() {
    if (this._pollTimeout) {
      GLib.source_remove(this._pollTimeout);
      this._pollTimeout = null;
    }
  }

  destroy() {
    // Clear pending timeout
    if (this._pendingTimeout) {
      GLib.source_remove(this._pendingTimeout);
      this._pendingTimeout = null;
    }

    // Clear polling
    this._stopPolling();

    // Cleanup D-Bus connections
    if (this.dbus && this._signalId) {
      this.dbus.disconnect(this._signalId);
      this._signalId = null;
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
