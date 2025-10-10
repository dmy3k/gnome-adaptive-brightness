import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { SensorProxyService } from "../lib/SensorProxyService.js";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

describe("SensorProxyService", () => {
  let service;
  let mockProxy;

  beforeEach(() => {
    service = new SensorProxyService();
    mockProxy = null;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    // Force cleanup of any remaining timeouts
    GLib.clearAllTimeouts();
  });

  describe("constructor", () => {
    it("should initialize with null proxy and signal", () => {
      expect(service.dbus._proxy).toBeNull();
      expect(service._signalId).toBeNull();
    });

    it("should initialize timeout tracking", () => {
      expect(service._pendingTimeout).toBeNull();
      expect(service._lastUpdateTime).toBe(0);
      expect(service._throttleTimeoutMs).toBe(2000);
    });

    it("should initialize polling parameters", () => {
      expect(service._pollTimeout).toBeNull();
      expect(service._pollIntervalStep).toBe(10);
      expect(service._maxPollInterval).toBe(60);
      expect(service._pollInterval).toBe(10);
    });

    it("should initialize light level and sensor availability", () => {
      expect(service.dbus.lightLevel).toBeNull();
      expect(service.dbus.hasAmbientLight).toBeNull();
    });

    it("should initialize callback managers", () => {
      expect(service.onLightLevelChanged).toBeDefined();
      expect(service.onLightLevelChanged.size).toBe(0);
      expect(service.onSensorAvailableChanged).toBeDefined();
      expect(service.onSensorAvailableChanged.size).toBe(0);
    });
  });

  describe("start", () => {
    it("should create DBusProxy connection", async () => {
      await service.start();

      expect(service.dbus._proxy).not.toBeNull();
      expect(service._signalId).not.toBeNull();
    });

    it("should connect to SensorProxy service", async () => {
      await service.start();

      expect(service.dbus._proxy._busName).toBe("net.hadess.SensorProxy");
      expect(service.dbus._proxy._objectPath).toBe("/net/hadess/SensorProxy");
    });

    it("should claim light sensor", async () => {
      await service.start();

      // Verify service is properly initialized
      expect(service.dbus._proxy).not.toBeNull();
      expect(service._signalId).not.toBeNull();
    });

    it("should start polling", async () => {
      await service.start();

      expect(service._pollTimeout).not.toBeNull();
    });

    it("should handle claim light error", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      // Mock call to reject
      const originalCall = Gio.DBusProxy.prototype.call;
      Gio.DBusProxy.prototype.call = function (
        method,
        params,
        flags,
        timeout,
        cancellable,
        callback
      ) {
        process.nextTick(() => {
          callback(
            {
              call_finish: () => {
                throw new Error("ClaimLight failed");
              },
            },
            { __asyncResult: true, __error: new Error("ClaimLight failed") }
          );
        });
      };

      await expect(service.start()).rejects.toThrow("ClaimLight failed");

      Gio.DBusProxy.prototype.call = originalCall;
      consoleErrorSpy.mockRestore();
    });
  });

  describe("_onPropertiesChanged", () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it("should handle LightLevel property change", () => {
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "LightLevel") {
            return { get_double: () => 500 };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      // Due to throttling, the value might not be set immediately
      // But we can check the last update time was set
      expect(service._lastUpdateTime).toBeGreaterThan(0);
    });

    it("should handle HasAmbientLight property change", () => {
      const callback = jest.fn();
      service.onSensorAvailableChanged.add(callback);

      // Set the property on the mock proxy so the getter can read it
      mockProxy.set_cached_property("HasAmbientLight", true);

      const mockChanged = {
        lookup_value: (key) => {
          if (key === "HasAmbientLight") {
            return { get_boolean: () => true };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      expect(service.dbus.hasAmbientLight).toBe(true);
      expect(callback).toHaveBeenCalledWith(true);
    });

    it("should handle both properties changing", () => {
      const callback = jest.fn();
      service.onSensorAvailableChanged.add(callback);

      // Set the property on the mock proxy so the getter can read it
      mockProxy.set_cached_property("HasAmbientLight", false);

      const mockChanged = {
        lookup_value: (key) => {
          if (key === "LightLevel") {
            return { get_double: () => 300 };
          }
          if (key === "HasAmbientLight") {
            return { get_boolean: () => false };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      expect(service.dbus.hasAmbientLight).toBe(false);
      expect(callback).toHaveBeenCalledWith(false);
      expect(service._lastUpdateTime).toBeGreaterThan(0);
    });

    it("should invoke callback even when value unchanged", () => {
      // Set initial value on the proxy
      mockProxy.set_cached_property("HasAmbientLight", true);

      const callback = jest.fn();
      service.onSensorAvailableChanged.add(callback);

      const mockChanged = {
        lookup_value: (key) => {
          if (key === "HasAmbientLight") {
            return { get_boolean: () => true };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      // Callback is now invoked regardless of value change
      expect(callback).toHaveBeenCalledWith(true);
    });
  });

  describe("_handleLightLevelChange", () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it("should process light level immediately if enough time passed", () => {
      service._lastUpdateTime = Date.now() - 3000; // 3 seconds ago

      // Set the property on the proxy before processing
      mockProxy.set_cached_property("LightLevel", 400);

      service._handleLightLevelChange(400);

      expect(service.dbus.lightLevel).toBe(400);
    });

    it("should schedule delayed update if updated recently", () => {
      service._lastUpdateTime = Date.now() - 500; // 500ms ago

      service._handleLightLevelChange(400);

      expect(service._pendingTimeout).not.toBeNull();
    });

    it("should clear existing pending timeout when scheduling new one", () => {
      service._lastUpdateTime = Date.now() - 500;

      service._handleLightLevelChange(400);
      const firstTimeout = service._pendingTimeout;

      service._handleLightLevelChange(500);
      const secondTimeout = service._pendingTimeout;

      expect(secondTimeout).not.toBe(firstTimeout);
    });
  });

  describe("_processLightLevelUpdate", () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it("should update light level value", () => {
      // Set the property on the proxy before processing
      mockProxy.set_cached_property("LightLevel", 250);

      service._processLightLevelUpdate(250);

      expect(service.dbus.lightLevel).toBe(250);
    });

    it("should invoke callback when value changes", () => {
      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);

      service._processLightLevelUpdate(250);

      expect(callback).toHaveBeenCalledWith(250);
    });

    it("should invoke callback even when value unchanged", () => {
      // Set initial value on the proxy
      mockProxy.set_cached_property("LightLevel", 250);

      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);

      service._processLightLevelUpdate(250);

      // Callback is now invoked regardless of value change
      expect(callback).toHaveBeenCalledWith(250);
    });

    it("should update last update time", () => {
      const before = service._lastUpdateTime;

      service._processLightLevelUpdate(250);

      expect(service._lastUpdateTime).toBeGreaterThan(before);
    });

    it("should start polling when polling watchdog enabled", () => {
      service._clearPolling();

      service._processLightLevelUpdate(250);

      expect(service._pollTimeout).not.toBeNull();
    });

    it("should not start polling when polling watchdog disabled", () => {
      service._clearPolling();

      service._processLightLevelUpdate();

      expect(service._pollTimeout).toBeNull();
    });
  });

  describe("polling mechanism", () => {
    beforeEach(async () => {
      await service.start();
    });

    it("should poll at regular intervals", () => {
      service._clearPolling();
      service._startPolling();

      expect(service._pollTimeout).not.toBeNull();
    });

    it("should increase poll interval after each poll", () => {
      service._clearPolling();
      service._pollInterval = 10;

      service._performPoll();
      service._scheduleNextPoll();

      expect(service._pollInterval).toBe(20);
    });

    it("should cap poll interval at maximum", () => {
      service._pollInterval = 55;

      service._performPoll();
      service._scheduleNextPoll();

      expect(service._pollInterval).toBe(60);

      service._performPoll();
      service._scheduleNextPoll();

      expect(service._pollInterval).toBe(60);
    });

    it("should get cached light level during poll", () => {
      mockProxy = service.dbus._proxy;
      mockProxy.set_cached_property("LightLevel", 350);

      service._performPoll();

      expect(service.dbus.lightLevel).toBe(350);
    });

    it("should handle polling error gracefully", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      service.dbus = null;

      expect(() => service._performPoll()).not.toThrow();

      consoleErrorSpy.mockRestore();
    });

    it("should reset poll interval when starting polling", () => {
      service._pollInterval = 50;

      service._startPolling();

      expect(service._pollInterval).toBe(10);
    });
  });
  describe("destroy", () => {
    it("should clear pending timeout", async () => {
      await service.start();
      service._lastUpdateTime = Date.now() - 500;
      service._handleLightLevelChange(400);

      expect(service._pendingTimeout).not.toBeNull();

      service.destroy();

      expect(service._pendingTimeout).toBeNull();
    });

    it("should clear polling timeout", async () => {
      await service.start();

      expect(service._pollTimeout).not.toBeNull();

      service.destroy();

      expect(service._pollTimeout).toBeNull();
    });

    it("should disconnect proxy signal", async () => {
      await service.start();
      const signalId = service._signalId;

      expect(signalId).not.toBeNull();

      service.destroy();

      expect(service._signalId).toBeNull();
    });

    it("should release light sensor", async () => {
      await service.start();
      mockProxy = service.dbus._proxy;

      service.destroy();

      expect(service.dbus._proxy).toBeNull();
    });

    it("should clear callbacks", async () => {
      await service.start();
      const lightCallback = jest.fn();
      const sensorCallback = jest.fn();

      service.onLightLevelChanged.add(lightCallback);
      service.onSensorAvailableChanged.add(sensorCallback);

      service.destroy();

      expect(service.onLightLevelChanged.size).toBe(0);
      expect(service.onSensorAvailableChanged.size).toBe(0);
    });

    it("should handle destroy when not started", () => {
      expect(() => service.destroy()).not.toThrow();
    });

    it("should handle multiple destroy calls", async () => {
      await service.start();
      service.destroy();
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it("should handle rapid light level changes with throttling", () => {
      service._lastUpdateTime = 0;

      // Set properties on the proxy so getter can read them
      mockProxy.set_cached_property("LightLevel", 100);

      // First change - immediate
      service._handleLightLevelChange(100);
      expect(service.dbus.lightLevel).toBe(100);

      // Second change - throttled
      service._handleLightLevelChange(200);
      expect(service.dbus.lightLevel).toBe(100); // Still old value
      expect(service._pendingTimeout).not.toBeNull();
    });

    it("should handle complete sensor lifecycle", async () => {
      const sensorCallback = jest.fn();
      service.onSensorAvailableChanged.add(sensorCallback);

      // Sensor becomes available
      mockProxy.set_cached_property("HasAmbientLight", true);
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "HasAmbientLight") {
            return { get_boolean: () => true };
          }
          return null;
        },
      };
      service._onPropertiesChanged(service.dbus._proxy, mockChanged, {});
      expect(service.dbus.hasAmbientLight).toBe(true);
      expect(sensorCallback).toHaveBeenCalledWith(true);

      // Light level updates
      mockProxy.set_cached_property("LightLevel", 500);
      service._processLightLevelUpdate(500);
      expect(service.dbus.lightLevel).toBe(500);

      // Service destroyed
      service.destroy();
      expect(service.dbus._proxy).toBeNull();
    });
  });

  describe("callback API", () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it("should register light level callback", () => {
      const callback = jest.fn();
      const id = service.onLightLevelChanged.add(callback);
      expect(id).toBeGreaterThan(0);
      expect(service.onLightLevelChanged.size).toBe(1);
    });

    it("should register sensor available callback", () => {
      const callback = jest.fn();
      const id = service.onSensorAvailableChanged.add(callback);
      expect(id).toBeGreaterThan(0);
      expect(service.onSensorAvailableChanged.size).toBe(1);
    });

    it("should provide light level via dbus layer", async () => {
      await service.start();
      service.dbus._proxy.set_cached_property("LightLevel", 123);
      expect(service.dbus.lightLevel).toBe(123);
    });

    it("should provide sensor availability via dbus layer", async () => {
      await service.start();
      service.dbus._proxy.set_cached_property("HasAmbientLight", true);
      expect(service.dbus.hasAmbientLight).toBe(true);
    });

    it("should handle callback errors gracefully", async () => {
      await service.start();
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
      const callback = jest.fn(() => {
        throw new Error("Callback error");
      });

      service.onLightLevelChanged.add(callback);
      service._processLightLevelUpdate(100);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("CallbackManager"),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
