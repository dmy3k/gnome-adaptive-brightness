/**
 * Tests for extension.js
 * These tests verify critical bug fixes:
 * 1. Logic error in setAutomaticBrightness (null check)
 * 2. Async initialization race condition
 * 3. Display active state handling
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import AdaptiveBrightnessExtension from "../extension.js";
import GLib from "gi://GLib";

describe("AdaptiveBrightnessExtension", () => {
  let extension;
  let mockDisplayBrightness;
  let mockSensorProxy;
  let mockPowerSettings;
  let mockNotifications;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create extension instance
    extension = new AdaptiveBrightnessExtension({
      uuid: "adaptive-brightness@test.com",
      path: "/test/path",
    });

    // Mock the services
    mockDisplayBrightness = {
      start: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      brightness: 50,
      _settingBrightness: false,
      displayIsActive: true,
      setBrightness: jest.fn().mockResolvedValue(undefined),
      animateBrightness: jest.fn().mockResolvedValue(undefined),
      dbus: {
        brightness: 50,
      },
      onBrightnessChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      onDisplayStateChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      onManualBrightnessChange: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      onDisplayIsActiveChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      settings: {
        ambientEnabled: false,
        onAmbientEnabledChanged: jest.fn().mockReturnValue(1),
        disconnect: jest.fn(),
      },
    };

    mockSensorProxy = {
      start: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      dbus: {
        lightLevel: 100,
        hasAmbientLight: true,
      },
      onLightLevelChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      onSensorAvailableChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
    };

    mockPowerSettings = {
      start: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      idleBrightnessEnabled: false,
      idleBrightness: null,
      onIdleBrightnessChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
    };

    mockNotifications = {
      showNotification: jest.fn(),
      destroy: jest.fn(),
    };

    // Replace services with mocks
    extension.displayBrightness = mockDisplayBrightness;
    extension.sensorProxy = mockSensorProxy;
    extension.powerSettings = mockPowerSettings;
    extension.notifications = mockNotifications;
  });

  afterEach(() => {
    if (extension) {
      extension.disable();
    }
    GLib.clearAllTimeouts();
  });

  describe("Constructor", () => {
    it("should initialize services", () => {
      const ext = new AdaptiveBrightnessExtension({});
      expect(ext.notifications).toBeDefined();
      expect(ext.displayBrightness).toBeDefined();
      expect(ext.sensorProxy).toBeDefined();
      expect(ext.userLearning).toBeDefined();
      expect(ext.bucketMapper).toBeDefined();
    });

    it("should initialize state", () => {
      const ext = new AdaptiveBrightnessExtension({});
      expect(ext.ambientSignalId).toBeNull();
      expect(ext.brightnessSignalId).toBeNull();
      expect(ext.lightLevelSignalId).toBeNull();
      expect(ext.sensorAvailableSignalId).toBeNull();
    });
  });

  describe("Bug Fix #2: Async Initialization Race Condition", () => {
    it("should await displayBrightness.start() before proceeding", async () => {
      const startOrder = [];

      mockDisplayBrightness.start = jest.fn(async () => {
        startOrder.push("displayBrightness.start");
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        startOrder.push("displayBrightness.start.complete");
      });

      mockSensorProxy.start = jest.fn(async () => {
        startOrder.push("sensorProxy.start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        startOrder.push("sensorProxy.start.complete");
      });

      await extension.enable();

      // Verify all services started in order and completed before proceeding
      expect(startOrder).toEqual([
        "displayBrightness.start",
        "displayBrightness.start.complete",
        "sensorProxy.start",
        "sensorProxy.start.complete",
      ]);

      // Verify callbacks were registered AFTER services started
      expect(
        mockDisplayBrightness.onManualBrightnessChange.add
      ).toHaveBeenCalled();
      expect(mockSensorProxy.onLightLevelChanged.add).toHaveBeenCalled();
    });

    it("should handle displayBrightness.start() failure gracefully", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      mockDisplayBrightness.start = jest
        .fn()
        .mockRejectedValue(new Error("D-Bus connection failed"));

      await extension.enable();

      // Should log error and show notification
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AdaptiveBrightness] Failed to start Display Brightness Service:",
        expect.any(Error)
      );
      expect(mockNotifications.showNotification).toHaveBeenCalledWith(
        "Adaptive Brightness Extension Error",
        expect.stringContaining("D-Bus connection failed"),
        { transient: false }
      );

      // Should NOT proceed to start other services (early return)
      expect(mockSensorProxy.start).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should handle sensorProxy.start() failure gracefully", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      mockSensorProxy.start = jest
        .fn()
        .mockRejectedValue(new Error("Sensor not available"));

      await extension.enable();

      // Should log error and show notification
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AdaptiveBrightness] Failed to start Sensor Proxy Service:",
        expect.any(Error)
      );
      expect(mockNotifications.showNotification).toHaveBeenCalledWith(
        "Adaptive Brightness Extension Error",
        expect.stringContaining("Sensor not available"),
        { transient: false }
      );

      // Should NOT proceed to register callbacks (early return)
      expect(
        mockDisplayBrightness.onManualBrightnessChange.add
      ).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Bug Fix #1: setAutomaticBrightness Logic Error", () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it("should update brightness when current brightness is null", async () => {
      // This is the KEY test case for the nullish coalescing bug
      // Before fix: (currentBrightness ?? Math.abs(...)) always truthy when not null
      // After fix: Separate null check and comparison

      mockDisplayBrightness.dbus.brightness = null;

      await extension.setAutomaticBrightness(75);

      // Should call animateBrightness because currentBrightness is null
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(75);
    });

    it("should update brightness when difference is greater than 1", async () => {
      mockDisplayBrightness.dbus.brightness = 50;

      await extension.setAutomaticBrightness(75);

      // Should call animateBrightness because |50 - 75| = 25 > 1
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(75);
    });

    it("should update brightness when difference is exactly 2", async () => {
      mockDisplayBrightness.dbus.brightness = 50;

      await extension.setAutomaticBrightness(52);

      // Should call animateBrightness because |50 - 52| = 2 > 1
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(52);
    });

    it("should NOT update brightness when difference is exactly 1", async () => {
      mockDisplayBrightness.dbus.brightness = 50;

      await extension.setAutomaticBrightness(51);

      // Should NOT call animateBrightness because |50 - 51| = 1 <= 1
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it("should NOT update brightness when difference is 0 (same value)", async () => {
      mockDisplayBrightness.dbus.brightness = 50;

      await extension.setAutomaticBrightness(50);

      // Should NOT call animateBrightness because |50 - 50| = 0 <= 1
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it("should NOT update brightness when difference is less than 1", async () => {
      mockDisplayBrightness.dbus.brightness = 50.5;

      await extension.setAutomaticBrightness(51);

      // Should NOT call animateBrightness because |50.5 - 51| = 0.5 <= 1
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it("should NOT update brightness when _settingBrightness is true", async () => {
      mockDisplayBrightness._settingBrightness = true;
      mockDisplayBrightness.dbus.brightness = 50;

      await extension.setAutomaticBrightness(100);

      // Should NOT call animateBrightness because we're already setting brightness
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it("should handle zero brightness correctly", async () => {
      mockDisplayBrightness.dbus.brightness = 0;

      await extension.setAutomaticBrightness(50);

      // Should call animateBrightness because |0 - 50| = 50 > 1
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(50);
    });

    it("should handle negative differences correctly", async () => {
      mockDisplayBrightness.dbus.brightness = 75;

      await extension.setAutomaticBrightness(50);

      // Should call animateBrightness because |75 - 50| = 25 > 1
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(50);
    });

    it("should handle brightness value of 100", async () => {
      mockDisplayBrightness.dbus.brightness = 98;

      await extension.setAutomaticBrightness(100);

      // Should call animateBrightness because |98 - 100| = 2 > 1
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(100);
    });
  });

  describe("Bug Fix #3: Display Active State Override", () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it("should handle display inactive state without logging spam", async () => {
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();

      // Get the display active changed callback
      const displayActiveCallback =
        mockDisplayBrightness.onDisplayIsActiveChanged.add.mock.calls[0][0];

      // Simulate display entering dimmed/inactive state
      mockDisplayBrightness.displayIsActive = false;
      displayActiveCallback();

      // Should handle gracefully without verbose logging
      // The fix ensures silent return for inactive state
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should update brightness when display becomes active", async () => {
      // Get the display active changed callback
      const displayActiveCallback =
        mockDisplayBrightness.onDisplayIsActiveChanged.add.mock.calls[0][0];

      // Reset mock to track only this call
      mockDisplayBrightness.animateBrightness.mockClear();

      // Set a light level so we have a target brightness
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness.dbus.brightness = 10;

      // Simulate display becoming active
      displayActiveCallback();

      // Should attempt to update brightness when display becomes active
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalled();
    });

    it("should not update brightness when display is inactive", async () => {
      // Get the display active changed callback
      const displayActiveCallback =
        mockDisplayBrightness.onDisplayIsActiveChanged.add.mock.calls[0][0];

      // Reset mock
      mockDisplayBrightness.animateBrightness.mockClear();

      // Simulate display becoming inactive
      mockDisplayBrightness.displayIsActive = false;
      displayActiveCallback();

      // Should NOT update brightness when display is inactive
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });
  });

  describe("Extension Lifecycle", () => {
    it("should enable extension successfully", async () => {
      await extension.enable();

      expect(mockDisplayBrightness.start).toHaveBeenCalled();
      expect(mockSensorProxy.start).toHaveBeenCalled();
    });

    it("should register all callbacks after enable", async () => {
      await extension.enable();

      expect(
        mockDisplayBrightness.onManualBrightnessChange.add
      ).toHaveBeenCalled();
      expect(
        mockDisplayBrightness.onDisplayIsActiveChanged.add
      ).toHaveBeenCalled();
      expect(mockSensorProxy.onLightLevelChanged.add).toHaveBeenCalled();
      expect(mockSensorProxy.onSensorAvailableChanged.add).toHaveBeenCalled();
    });

    it("should disable extension successfully", async () => {
      await extension.enable();
      extension.disable();

      expect(mockDisplayBrightness.destroy).toHaveBeenCalled();
      expect(mockSensorProxy.destroy).toHaveBeenCalled();
      expect(mockNotifications.destroy).toHaveBeenCalled();
    });

    it("should disconnect signals on disable", async () => {
      // Add dbus.disconnect to mock
      mockDisplayBrightness.dbus.disconnect = jest.fn();

      await extension.enable();
      extension.disable();

      // Should disconnect ambient signal
      expect(mockDisplayBrightness.settings.disconnect).toHaveBeenCalled();
      // Should disconnect brightness signal if it exists
      if (extension.brightnessSignalId) {
        expect(mockDisplayBrightness.dbus.disconnect).toHaveBeenCalled();
      }
    });
  });

  describe("Brightness Mapping", () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it("should map light levels to brightness correctly", async () => {
      // Test very dark conditions (night)
      mockDisplayBrightness.animateBrightness.mockClear();
      mockDisplayBrightness.dbus.brightness = 50;
      extension.adjustBrightnessForLightLevel(5); // 0-10 lux -> 10% brightness
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(10);

      // Test dim indoor
      mockDisplayBrightness.animateBrightness.mockClear();
      mockDisplayBrightness.dbus.brightness = 10;
      extension.adjustBrightnessForLightLevel(100); // 5-200 lux -> 25% brightness
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(25);

      // Test normal indoor
      mockDisplayBrightness.animateBrightness.mockClear();
      mockDisplayBrightness.dbus.brightness = 25;
      extension.adjustBrightnessForLightLevel(300); // 50-650 lux -> 50% brightness
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(50);

      // Test bright indoor
      mockDisplayBrightness.animateBrightness.mockClear();
      mockDisplayBrightness.dbus.brightness = 10; // Set far from target to ensure update
      extension.adjustBrightnessForLightLevel(1000); // 350-2000 lux -> 75% brightness
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(75);

      // Test outdoor
      mockDisplayBrightness.animateBrightness.mockClear();
      mockDisplayBrightness.dbus.brightness = 10; // Set far from target
      extension.adjustBrightnessForLightLevel(5000); // 1000-10000 lux -> 100% brightness
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(100);
    });
  });

  describe("User Learning Integration", () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it("should record user adjustments when brightness changed manually", () => {
      // Get the manual brightness change callback
      const manualBrightnessCallback =
        mockDisplayBrightness.onManualBrightnessChange.add.mock.calls[0][0];

      // Set up the scenario
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      const updateBiasSpy = jest.spyOn(
        extension.userLearning,
        "updateBiasFromManualAdjustment"
      );

      // Simulate manual brightness change
      manualBrightnessCallback(60);

      // Should update bias with the manual adjustment
      expect(updateBiasSpy).toHaveBeenCalledWith(60, expect.any(Number));
    });

    it("should not record brightness changes when display is inactive", () => {
      // Get the manual brightness change callback
      const manualBrightnessCallback =
        mockDisplayBrightness.onManualBrightnessChange.add.mock.calls[0][0];

      mockDisplayBrightness.displayIsActive = false;
      const updateBiasSpy = jest.spyOn(
        extension.userLearning,
        "updateBiasFromManualAdjustment"
      );

      // Simulate brightness change when display is inactive
      manualBrightnessCallback(60);

      // Should NOT record when display is inactive
      expect(updateBiasSpy).not.toHaveBeenCalled();
    });
  });
});
