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
    this._lastUpdateTime = 0;
    this._throttleTimeoutMs = 2000;

    // Polling with exponential backoff
    this._pollTimeout = null;
    this._pollIntervalStep = 10;
    this._maxPollInterval = 60;
    this._pollInterval = this._pollIntervalStep;

    // Public callback managers
    this.onLightLevelChanged = new CallbackManager();
    this.onSensorAvailableChanged = new CallbackManager();
  }

  /**
   * Start sensor proxy connection
   */
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
    if (level === undefined) {
      level = this.dbus.lightLevel;
    } else {
      this._startPolling();
    }
    this._lastUpdateTime = Date.now();
    this.onLightLevelChanged.invoke(level);
  }

  /**
   * Periodic polling with exponential backoff.
   * This acts like a watchdog for scenarios
   * where light level might change suddenly to 0 lux
   * and be undetected by sensor proxy
   */
  _startPolling() {
    this._clearPolling();
    this._scheduleNextPoll();
  }

  _scheduleNextPoll() {
    this._pollTimeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_LOW,
      this._pollInterval,
      () => {
        this._performPoll();
        return GLib.SOURCE_REMOVE;
      }
    );
  }

  _performPoll() {
    if (!this.dbus) {
      return;
    }

    try {
      this._processLightLevelUpdate();
    } catch (error) {
      console.error("SensorProxyService: Polling error:", error);
    }

    this._pollInterval = Math.min(
      this._pollInterval + this._pollIntervalStep,
      this._maxPollInterval
    );
    this._scheduleNextPoll();
  }

  _clearPolling() {
    if (this._pollTimeout) {
      GLib.source_remove(this._pollTimeout);
      this._pollTimeout = null;
    }
    this._pollInterval = this._pollIntervalStep;
  }

  destroy() {
    // Clear pending timeout
    if (this._pendingTimeout) {
      GLib.source_remove(this._pendingTimeout);
      this._pendingTimeout = null;
    }

    // Clear polling
    this._clearPolling();

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
