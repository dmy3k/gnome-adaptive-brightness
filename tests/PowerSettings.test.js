import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { PowerSettings } from "../lib/PowerSettings.js";
import Gio from "gi://Gio";

describe("PowerSettings", () => {
  let powerSettings;

  beforeEach(() => {
    powerSettings = new PowerSettings();
  });

  afterEach(() => {
    if (powerSettings) {
      powerSettings.destroy();
    }
  });

  describe("constructor", () => {
    it("should initialize with null settings", () => {
      expect(powerSettings._settings).toBeNull();
    });

    it("should return null for getters when not connected", () => {
      expect(powerSettings.idleBrightness).toBeNull();
      expect(powerSettings.ambientEnabled).toBeNull();
    });
  });

  describe("connect", () => {
    it("should connect to GSettings", () => {
      powerSettings.connect();

      expect(powerSettings._settings).not.toBeNull();
    });

    it("should read initial idle-brightness value", () => {
      powerSettings.connect();

      expect(powerSettings.idleBrightness).toBe(30);
    });

    it("should read initial ambient-enabled value", () => {
      powerSettings.connect();

      expect(powerSettings.ambientEnabled).toBe(false);
    });
  });

  describe("getters", () => {
    beforeEach(() => {
      powerSettings.connect();
    });

    it("should return current idleBrightness value", () => {
      expect(powerSettings.idleBrightness).toBe(30);

      powerSettings._settings.set_int("idle-brightness", 50);

      expect(powerSettings.idleBrightness).toBe(50);
    });

    it("should return current ambientEnabled value", () => {
      expect(powerSettings.ambientEnabled).toBe(false);

      powerSettings._settings.set_boolean("ambient-enabled", true);

      expect(powerSettings.ambientEnabled).toBe(true);
    });
  });

  describe("callbacks", () => {
    beforeEach(() => {
      powerSettings.connect();
    });

    it("should invoke callback when idleBrightness changes", () => {
      const callback = jest.fn();
      powerSettings.onIdleBrightnessChanged(callback);

      powerSettings._settings.set_int("idle-brightness", 50);

      expect(callback).toHaveBeenCalledWith(50);
    });

    it("should invoke callback when ambientEnabled changes", () => {
      const callback = jest.fn();
      powerSettings.onAmbientEnabledChanged(callback);

      powerSettings._settings.set_boolean("ambient-enabled", true);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it("should return signal ID for idleBrightness callback", () => {
      const callback = jest.fn();
      const signalId = powerSettings.onIdleBrightnessChanged(callback);

      expect(typeof signalId).toBe("number");
      expect(signalId).toBeGreaterThan(0);
    });

    it("should return signal ID for ambientEnabled callback", () => {
      const callback = jest.fn();
      const signalId = powerSettings.onAmbientEnabledChanged(callback);

      expect(typeof signalId).toBe("number");
      expect(signalId).toBeGreaterThan(0);
    });

    it("should disconnect specific callback by signal ID", () => {
      const callback = jest.fn();
      const signalId = powerSettings.onIdleBrightnessChanged(callback);

      powerSettings.disconnect(signalId);

      powerSettings._settings.set_int("idle-brightness", 50);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should support multiple callbacks for same property", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      powerSettings.onIdleBrightnessChanged(callback1);
      powerSettings.onIdleBrightnessChanged(callback2);

      powerSettings._settings.set_int("idle-brightness", 50);

      expect(callback1).toHaveBeenCalledWith(50);
      expect(callback2).toHaveBeenCalledWith(50);
    });
  });

  describe("disconnect", () => {
    it("should disconnect specific signal by signal ID", () => {
      powerSettings.connect();
      const callback = jest.fn();
      const signalId = powerSettings.onIdleBrightnessChanged(callback);

      powerSettings.disconnect(signalId);

      powerSettings._settings.set_int("idle-brightness", 99);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle disconnect when not connected", () => {
      expect(() => powerSettings.disconnect(1)).not.toThrow();
    });

    it("should handle disconnect with specific signal ID", () => {
      powerSettings.connect();
      const callback = jest.fn();
      const signalId = powerSettings.onIdleBrightnessChanged(callback);

      expect(() => powerSettings.disconnect(signalId)).not.toThrow();
    });
  });

  describe("destroy", () => {
    it("should clear settings reference", () => {
      powerSettings.connect();

      powerSettings.destroy();

      expect(powerSettings._settings).toBeNull();
    });

    it("should handle destroy when not connected", () => {
      expect(() => powerSettings.destroy()).not.toThrow();
    });
  });
});
