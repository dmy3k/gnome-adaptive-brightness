import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { SensorProxyDbus } from "../lib/SensorProxyDbus.js";
import Gio from "gi://Gio";

describe("SensorProxyDbus", () => {
  let dbus;

  beforeEach(() => {
    dbus = new SensorProxyDbus();
  });

  afterEach(() => {
    if (dbus) {
      dbus.destroy();
    }
  });

  describe("constructor", () => {
    it("should initialize with null proxy", () => {
      expect(dbus._proxy).toBeNull();
    });
  });

  describe("connect", () => {
    it("should connect to D-Bus sensor proxy service", async () => {
      await dbus.connect();

      expect(dbus._proxy).not.toBeNull();
    });

    it("should connect to correct D-Bus service and interface", async () => {
      await dbus.connect();

      expect(dbus._proxy._busName).toBe("net.hadess.SensorProxy");
      expect(dbus._proxy._objectPath).toBe("/net/hadess/SensorProxy");
    });
  });

  describe("claimLight", () => {
    it("should claim light sensor after connection", async () => {
      await dbus.connect();
      await dbus.claimLight();
      // Should complete without error
    });

    it("should throw error when not connected", async () => {
      await expect(dbus.claimLight()).rejects.toThrow(
        "D-Bus proxy not connected"
      );
    });

    it("should handle claim light error", async () => {
      await dbus.connect();

      const originalCall = dbus._proxy.call;
      dbus._proxy.call = function (
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

      await expect(dbus.claimLight()).rejects.toThrow("ClaimLight failed");

      dbus._proxy.call = originalCall;
    });
  });

  describe("releaseLight", () => {
    it("should release light sensor", async () => {
      await dbus.connect();
      await dbus.claimLight();

      dbus.releaseLight();
      // Should complete without error
    });

    it("should handle release when not connected", () => {
      expect(() => dbus.releaseLight()).not.toThrow();
    });
  });

  describe("lightLevel", () => {
    it("should return null when not connected", () => {
      const level = dbus.lightLevel;
      expect(level).toBeNull();
    });

    it("should return current light level after connection", async () => {
      await dbus.connect();
      dbus._proxy.set_cached_property("LightLevel", 123.5);

      const level = dbus.lightLevel;
      expect(level).toBe(123.5);
    });

    it("should return null when light level property not available", async () => {
      await dbus.connect();

      const level = dbus.lightLevel;
      expect(level).toBeNull();
    });
  });

  describe("hasAmbientLight", () => {
    it("should return null when not connected", () => {
      const hasLight = dbus.hasAmbientLight;
      expect(hasLight).toBeNull();
    });

    it("should return true when ambient light sensor is available", async () => {
      await dbus.connect();
      dbus._proxy.set_cached_property("HasAmbientLight", true);

      const hasLight = dbus.hasAmbientLight;
      expect(hasLight).toBe(true);
    });

    it("should return false when ambient light sensor is not available", async () => {
      await dbus.connect();
      dbus._proxy.set_cached_property("HasAmbientLight", false);

      const hasLight = dbus.hasAmbientLight;
      expect(hasLight).toBe(false);
    });

    it("should return null when property not available", async () => {
      await dbus.connect();

      const hasLight = dbus.hasAmbientLight;
      expect(hasLight).toBeNull();
    });
  });

  describe("onPropertiesChanged", () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it("should call callback when properties change", () => {
      const callback = jest.fn();
      const signalId = dbus.onPropertiesChanged(callback);

      expect(signalId).not.toBeNull();

      // Simulate property change
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "LightLevel") {
            return { get_double: () => 250.0 };
          }
          return null;
        },
      };

      dbus._proxy.emit("g-properties-changed", mockChanged, {});

      expect(callback).toHaveBeenCalledWith(dbus._proxy, mockChanged, {});
    });

    it("should handle multiple property changes", () => {
      const callback = jest.fn();
      dbus.onPropertiesChanged(callback);

      // Simulate multiple property changes
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "LightLevel") {
            return { get_double: () => 300.0 };
          }
          if (key === "HasAmbientLight") {
            return { get_boolean: () => true };
          }
          return null;
        },
      };

      dbus._proxy.emit("g-properties-changed", mockChanged, {});

      expect(callback).toHaveBeenCalledWith(dbus._proxy, mockChanged, {});
    });

    it("should throw error when not connected", () => {
      dbus.destroy();

      expect(() => dbus.onPropertiesChanged(() => {})).toThrow(
        "D-Bus proxy not connected"
      );
    });
  });

  describe("disconnect", () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it("should disconnect signal handler", () => {
      const callback = jest.fn();
      const signalId = dbus.onPropertiesChanged(callback);

      dbus.disconnect(signalId);

      // Simulate property change after disconnect
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "LightLevel") {
            return { get_double: () => 250.0 };
          }
          return null;
        },
      };

      dbus._proxy.emit("g-properties-changed", mockChanged, {});

      // Callback should not have been called since signal was disconnected
      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle disconnect when not connected", () => {
      dbus.destroy();
      expect(() => dbus.disconnect(123)).not.toThrow();
    });

    it("should handle disconnect with null signalId", () => {
      expect(() => dbus.disconnect(null)).not.toThrow();
    });
  });

  describe("destroy", () => {
    it("should clear proxy reference", async () => {
      await dbus.connect();
      expect(dbus._proxy).not.toBeNull();

      dbus.destroy();
      expect(dbus._proxy).toBeNull();
    });

    it("should handle destroy when not connected", () => {
      expect(() => dbus.destroy()).not.toThrow();
    });

    it("should handle multiple destroy calls", async () => {
      await dbus.connect();
      dbus.destroy();
      expect(() => dbus.destroy()).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete lifecycle", async () => {
      // Connect
      await dbus.connect();

      // Claim sensor
      await dbus.claimLight();

      // Get light level
      dbus._proxy.set_cached_property("LightLevel", 150.0);
      expect(dbus.lightLevel).toBe(150.0);

      // Get sensor availability
      dbus._proxy.set_cached_property("HasAmbientLight", true);
      expect(dbus.hasAmbientLight).toBe(true);

      // Subscribe to changes
      const callback = jest.fn();
      const signalId = dbus.onPropertiesChanged(callback);

      // Simulate change
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "LightLevel") {
            return { get_double: () => 200.0 };
          }
          return null;
        },
      };
      dbus._proxy.emit("g-properties-changed", mockChanged, {});
      expect(callback).toHaveBeenCalledWith(dbus._proxy, mockChanged, {});

      // Disconnect
      dbus.disconnect(signalId);

      // Release sensor
      dbus.releaseLight();

      // Destroy
      dbus.destroy();
    });

    it("should handle error during connection", async () => {
      const originalNew = Gio.DBusProxy.new;
      Gio.DBusProxy.new = function (
        connection,
        flags,
        info,
        busName,
        objectPath,
        interfaceName,
        cancellable,
        callback
      ) {
        process.nextTick(() => {
          callback(null, {
            __asyncResult: true,
            __error: new Error("Connection failed"),
          });
        });
      };

      await expect(dbus.connect()).rejects.toThrow("Connection failed");

      Gio.DBusProxy.new = originalNew;
    });
  });
});
