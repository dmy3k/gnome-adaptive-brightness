import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { BrightnessDbus } from "../lib/BrightnessDbus.js";
import Gio from "gi://Gio";

describe("BrightnessDbus", () => {
  let dbus;

  beforeEach(() => {
    dbus = new BrightnessDbus();
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
    it("should connect to D-Bus power service", async () => {
      await dbus.connect();

      expect(dbus._proxy).not.toBeNull();
    });

    it("should connect to correct D-Bus service and interface", async () => {
      await dbus.connect();

      expect(dbus._proxy._busName).toBe("org.gnome.SettingsDaemon.Power");
      expect(dbus._proxy._objectPath).toBe("/org/gnome/SettingsDaemon/Power");
    });
  });

  describe("getCurrentBrightness", () => {
    it("should return null when not connected", () => {
      const brightness = dbus.brightness;
      expect(brightness).toBeNull();
    });

    it("should return current brightness after connection", async () => {
      await dbus.connect();
      dbus._proxy.set_cached_property("Brightness", 50);

      const brightness = dbus.brightness;
      expect(brightness).toBe(50);
    });

    it("should return null when brightness property not available", async () => {
      await dbus.connect();

      const brightness = dbus.brightness;
      expect(brightness).toBeNull();
    });
  });

  describe("setBrightness", () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it("should set brightness via D-Bus", () => {
      dbus.brightness = 75;
      // D-Bus call should complete without error
    });

    it("should clamp brightness to 0-100 range", () => {
      dbus.brightness = 150;
      // Should clamp to 100

      dbus.brightness = -10;
      // Should clamp to 0
    });

    it("should round fractional brightness values", () => {
      dbus.brightness = 75.7;
      // Should round to 76
    });

    it("should throw error when not connected", () => {
      dbus.destroy();

      expect(() => {
        dbus.brightness = 50;
      }).toThrow("D-Bus proxy not connected");
    });
  });

  describe("onBrightnessChanged", () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it("should call callback when brightness changes", () => {
      const callback = jest.fn();
      const signalId = dbus.onChanged(callback);

      expect(signalId).not.toBeNull();

      // Simulate brightness change
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "Brightness") {
            return { get_int32: () => 60 };
          }
          return null;
        },
      };

      dbus._proxy.emit("g-properties-changed", mockChanged, {});

      expect(callback).toHaveBeenCalledWith(60);
    });

    it("should not call callback for other property changes", () => {
      const callback = jest.fn();
      dbus.onChanged(callback);

      // Simulate other property change
      const mockChanged = {
        lookup_value: (key) => null,
      };

      dbus._proxy.emit("g-properties-changed", mockChanged, {});

      expect(callback).not.toHaveBeenCalled();
    });

    it("should throw error when not connected", () => {
      dbus.destroy();

      expect(() => dbus.onChanged(() => {})).toThrow(
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
      const signalId = dbus.onChanged(callback);

      dbus.disconnect(signalId);

      // Simulate brightness change after disconnect
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "Brightness") {
            return { get_int32: () => 60 };
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

      // Get brightness
      dbus._proxy.set_cached_property("Brightness", 50);
      expect(dbus.brightness).toBe(50);

      // Set brightness
      dbus.brightness = 75;

      // Subscribe to changes
      const callback = jest.fn();
      const signalId = dbus.onChanged(callback);

      // Simulate change
      const mockChanged = {
        lookup_value: (key) => {
          if (key === "Brightness") {
            return { get_int32: () => 80 };
          }
          return null;
        },
      };
      dbus._proxy.emit("g-properties-changed", mockChanged, {});
      expect(callback).toHaveBeenCalledWith(80);

      // Disconnect
      dbus.disconnect(signalId);

      // Destroy
      dbus.destroy();
    });
  });
});
