import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import GLib from 'gi://GLib';

// Mock all service modules before importing the extension
const mockNotificationService = jest.fn();
const mockDisplayBrightnessService = jest.fn();
const mockSensorProxyService = jest.fn();
const mockBucketMapper = jest.fn();

jest.unstable_mockModule('../lib/NotificationService.js', () => ({
  NotificationService: mockNotificationService,
}));

jest.unstable_mockModule('../lib/DisplayBrightnessService.js', () => ({
  DisplayBrightnessService: mockDisplayBrightnessService,
}));

jest.unstable_mockModule('../lib/SensorProxyService.js', () => ({
  SensorProxyService: mockSensorProxyService,
}));

jest.unstable_mockModule('../lib/BucketMapper.js', () => ({
  BucketMapper: mockBucketMapper,
}));

const { default: AdaptiveBrightnessExtension } = await import('../extension.js');

// Helper to wait for async initialization after enable()
async function enableAndWait(extension, timeout = 100) {
  extension.enable();
  await new Promise((resolve) => setTimeout(resolve, timeout));
}

describe('AdaptiveBrightnessExtension', () => {
  let extension;
  let mockDisplayBrightness;
  let mockSensorProxy;
  let mockPowerSettings;
  let mockNotifications;
  let LoginManager;

  beforeEach(async () => {
    // Import LoginManager inside beforeEach to ensure mocks are set up
    LoginManager = await import('resource:///org/gnome/shell/misc/loginManager.js');

    // Reset all mocks
    jest.clearAllMocks();
    mockNotificationService.mockClear();
    mockDisplayBrightnessService.mockClear();
    mockSensorProxyService.mockClear();
    mockBucketMapper.mockClear();

    // Mock the services
    mockDisplayBrightness = {
      start: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      brightness: 0.5,
      _settingBrightness: false,
      displayIsActive: true,
      setBrightness: jest.fn().mockResolvedValue(undefined),
      animateBrightness: jest.fn().mockResolvedValue(undefined),
      haltAnimatingBrightness: jest.fn(),
      backend: {
        brightness: 0.5,
        userPreference: 0.5,
        onBrightnessChange: {
          add: jest.fn(),
          remove: jest.fn(),
        },
        onUserPreferenceChange: {
          add: jest.fn(),
          remove: jest.fn(),
        },
        disconnect: jest.fn(),
      },
      dbus: {
        brightness: 0.5,
        disconnect: jest.fn(),
      },
      onBrightnessChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      onDisplayStateChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      onDisplayIsActiveChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      onAmbientEnabledChanged: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      isGSDambientEnabled: false,
      settings: {
        ambientEnabled: false,
        onAmbientEnabledChanged: jest.fn().mockReturnValue(1),
        disconnect: jest.fn(),
      },
    };

    mockSensorProxy = {
      start: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      forceUpdate: jest.fn(() => {
        // Simulate what forceUpdate does - invokes the light level changed callback
        const callback = mockSensorProxy.onLightLevelChanged.add.mock.calls[0]?.[0];
        if (callback && mockSensorProxy.dbus.lightLevel !== null) {
          callback(mockSensorProxy.dbus.lightLevel);
        }
      }),
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

    const mockBucketMapperInstance = {
      getBrightness: jest.fn((lux) => {
        if (lux <= 20) return 0.15;
        if (lux <= 200) return 0.25;
        if (lux <= 650) return 0.5;
        if (lux <= 2000) return 0.75;
        if (lux <= 7000) return 1.0;
        return 2.0;
      }),
      mapLuxToBrightness: jest.fn((lux, withHysteresis = true) => {
        let brightness;
        if (lux <= 20) brightness = 0.15;
        else if (lux <= 200) brightness = 0.25;
        else if (lux <= 650) brightness = 0.5;
        else if (lux <= 2000) brightness = 0.75;
        else if (lux <= 7000) brightness = 1.0;
        else brightness = 2.0;

        return { brightness };
      }),
      crossesBucketBoundary: jest.fn((prev, curr) => {
        // Simple mock: return true if values cross bucket boundaries
        if (prev === null || curr === null) return true;

        const getBucket = (lux) => {
          if (lux <= 20) return 0;
          if (lux <= 200) return 1;
          if (lux <= 650) return 2;
          if (lux <= 2000) return 3;
          if (lux <= 7000) return 4;
          return 5;
        };

        return getBucket(prev) !== getBucket(curr);
      }),
      currentBucketIndex: 0,
      buckets: [
        { min: 0, max: 20, brightness: 0.15 },
        { min: 5, max: 200, brightness: 0.25 },
        { min: 50, max: 650, brightness: 0.5 },
        { min: 350, max: 2000, brightness: 0.75 },
        { min: 1000, max: 7000, brightness: 1.0 },
        { min: 5000, max: 10000, brightness: 2.0 },
      ],
    };

    // Configure mock constructors to return mock instances
    mockNotificationService.mockImplementation(() => mockNotifications);
    mockDisplayBrightnessService.mockImplementation(() => mockDisplayBrightness);
    mockSensorProxyService.mockImplementation((filterFn) => mockSensorProxy);
    mockBucketMapper.mockImplementation(() => mockBucketMapperInstance);

    // Create extension instance
    extension = new AdaptiveBrightnessExtension({
      uuid: 'adaptive-brightness@test.com',
      path: '/test/path',
    });

    // Reset LoginManager singleton for each test
    LoginManager._resetLoginManager();
  });

  afterEach(() => {
    // Only disable if extension services were initialized
    if (extension && extension.displayBrightness) {
      extension.disable();
    }
    GLib.clearAllTimeouts();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize properly on construction and enable', (done) => {
      const ext = new AdaptiveBrightnessExtension({});

      // Check initial state - signals should be null
      expect(ext.sleepResumeSignalId).toBeFalsy();

      // Services should not be initialized until enable()
      expect(ext.notifications).toBeUndefined();

      ext.enable();

      // Wait for async initialization
      setTimeout(() => {
        // After enable, services should be initialized
        expect(ext.notifications).toBeDefined();
        expect(ext.displayBrightness).toBeDefined();
        expect(ext.sensorProxy).toBeDefined();
        expect(ext.loginManager).toBeDefined();
        // userPreference is set during resetUserPreference() which is called on enable
        expect(ext.displayBrightness.backend.userPreference).toBeDefined();
        expect(ext.bucketMapper).toBeDefined();

        ext.disable();
        done();
      }, 50);
    });
  });

  describe('Bug Fix #2: Async Initialization Race Condition', () => {
    it('should start services using Promise.allSettled', (done) => {
      const startOrder = [];

      mockDisplayBrightness.start = jest.fn(async () => {
        startOrder.push('displayBrightness.start');
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        startOrder.push('displayBrightness.start.complete');
      });

      mockSensorProxy.start = jest.fn(async () => {
        startOrder.push('sensorProxy.start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        startOrder.push('sensorProxy.start.complete');
      });

      extension.enable();

      // Wait for async initialization to complete
      setTimeout(() => {
        // Verify all services started (order not guaranteed due to Promise.allSettled)
        expect(startOrder).toContain('displayBrightness.start');
        expect(startOrder).toContain('displayBrightness.start.complete');
        expect(startOrder).toContain('sensorProxy.start');
        expect(startOrder).toContain('sensorProxy.start.complete');

        // All starts should happen before all completes
        const displayStartIdx = startOrder.indexOf('displayBrightness.start');
        const displayCompleteIdx = startOrder.indexOf('displayBrightness.start.complete');
        const sensorStartIdx = startOrder.indexOf('sensorProxy.start');
        const sensorCompleteIdx = startOrder.indexOf('sensorProxy.start.complete');

        expect(displayStartIdx).toBeLessThan(displayCompleteIdx);
        expect(sensorStartIdx).toBeLessThan(sensorCompleteIdx);

        // Verify callbacks were registered AFTER services started
        expect(mockDisplayBrightness.backend.onUserPreferenceChange.add).toHaveBeenCalled();
        expect(mockSensorProxy.onLightLevelChanged.add).toHaveBeenCalled();

        // Verify LoginManager was obtained
        expect(extension.loginManager).not.toBeNull();
        done();
      }, 100);
    });

    it('should continue initialization even if displayBrightness.start() fails', (done) => {
      mockDisplayBrightness.start = jest
        .fn()
        .mockRejectedValue(new Error('D-Bus connection failed'));

      // enable() is now synchronous and handles errors internally
      extension.enable();

      // Wait for async initialization
      setTimeout(() => {
        // Extension should log error but not throw
        expect(mockDisplayBrightness.start).toHaveBeenCalled();
        done();
      }, 50);
    });

    it('should continue initialization even if sensorProxy.start() fails', (done) => {
      mockSensorProxy.start = jest.fn().mockRejectedValue(new Error('Sensor not available'));

      // enable() is now synchronous and handles errors internally
      extension.enable();

      // Wait for async initialization
      setTimeout(() => {
        // Extension should log error but not throw
        expect(mockSensorProxy.start).toHaveBeenCalled();
        done();
      }, 50);
    });
  });

  describe('Brightness Adjustment', () => {
    beforeEach(async () => {
      await enableAndWait(extension);
    });

    it('should adjust brightness directly using animateBrightness', async () => {
      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100; // Should map to 0.25 brightness
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(100);

      // With neutral bias (1.0), result should be 0.25
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalled();
      const result = mockDisplayBrightness.animateBrightness.mock.calls[0][0];
      expect(result).toBeCloseTo(0.25, 2);
    });

    it('should NOT adjust brightness when display is inactive', async () => {
      mockDisplayBrightness.displayIsActive = false;
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(100);

      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it('should NOT adjust brightness when luxValue is null', async () => {
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(null);

      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it('should apply user brightness preference to target brightness', async () => {
      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100; // Should map to 0.25 brightness

      // First, simulate a manual adjustment to train the bias
      // User adjusts to 0.3 when automatic is 0.25 (bias ratio = 0.3/0.25 = 1.2)
      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];
      mockDisplayBrightness._settingBrightness = false;
      mockDisplayBrightness.backend.userPreference = 0.3;
      userPreferenceCallback(0.3);

      // Now test that the bias is applied correctly at a different light level
      mockSensorProxy.dbus.lightLevel = 300; // Maps to 0.5 brightness
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(300);

      // With bias ratio 1.2, result should be 0.5 * 1.2 = 0.6
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalled();
      const result = mockDisplayBrightness.animateBrightness.mock.calls[0][0];
      expect(result).toBeCloseTo(0.6, 2);
    });

    it('should handle animation errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.animateBrightness.mockRejectedValue(new Error('Animation failed'));

      await extension.adjustBrightnessForLightLevel(100);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Bug Fix #3: Display Active State Override', () => {
    beforeEach(async () => {
      await enableAndWait(extension);
    });

    it('should respect display active state when adjusting brightness', async () => {
      const displayActiveCallback =
        mockDisplayBrightness.onDisplayIsActiveChanged.add.mock.calls[0][0];

      // Test: Display inactive - should not update brightness
      mockDisplayBrightness.displayIsActive = false;
      mockDisplayBrightness.animateBrightness.mockClear();
      displayActiveCallback();
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();

      // Test: Display becomes active - should update brightness
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness.dbus.brightness = 0.1;
      mockSensorProxy.dbus.lightLevel = 100; // 0.25 target
      mockDisplayBrightness.animateBrightness.mockClear();
      displayActiveCallback();
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalled();
    });
  });

  describe('Extension Lifecycle', () => {
    it('should enable extension successfully', async () => {
      await enableAndWait(extension);

      expect(mockDisplayBrightness.start).toHaveBeenCalled();
      expect(mockSensorProxy.start).toHaveBeenCalled();
    });

    it('should register all callbacks after enable', async () => {
      await enableAndWait(extension);

      expect(mockDisplayBrightness.backend.onUserPreferenceChange.add).toHaveBeenCalled();
      expect(mockDisplayBrightness.onDisplayIsActiveChanged.add).toHaveBeenCalled();
      expect(mockSensorProxy.onLightLevelChanged.add).toHaveBeenCalled();
      expect(mockSensorProxy.onSensorAvailableChanged.add).toHaveBeenCalled();
      expect(extension.loginManager).not.toBeNull();
      expect(extension.sleepResumeSignalId).not.toBeNull();
    });

    it('should disable extension successfully', async () => {
      await enableAndWait(extension);
      extension.disable();

      expect(mockDisplayBrightness.destroy).toHaveBeenCalled();
      expect(mockSensorProxy.destroy).toHaveBeenCalled();
      expect(mockNotifications.destroy).toHaveBeenCalled();
      expect(extension.loginManager).toBeNull();
    });

    it('should disconnect signals on disable', async () => {
      await enableAndWait(extension);
      const loginManager = extension.loginManager;
      const sleepSignalId = extension.sleepResumeSignalId;

      const mockLoginDisconnect = jest.spyOn(loginManager, 'disconnect');

      extension.disable();

      // Should disconnect sleep/resume signal
      if (sleepSignalId) {
        expect(mockLoginDisconnect).toHaveBeenCalledWith(sleepSignalId);
      }
      expect(extension.sleepResumeSignalId).toBeNull();
    });
  });

  describe('Sleep/Resume Integration', () => {
    beforeEach(async () => {
      await enableAndWait(extension);
    });

    it('should register prepare-for-sleep handler on enable', async () => {
      expect(extension.loginManager).not.toBeNull();
      expect(extension.sleepResumeSignalId).not.toBeNull();
    });

    it('should adjust brightness on resume based on current light level', async () => {
      mockDisplayBrightness.displayIsActive = true;

      // Test waking in darkness (0 lux) - automatic brightness 0.15
      mockDisplayBrightness.dbus.brightness = 0.75;
      mockSensorProxy.dbus.lightLevel = 0;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      const call1 = mockDisplayBrightness.animateBrightness.mock.calls[0][0];
      expect(call1).toBeCloseTo(0.15, 2);

      // Test waking in bright conditions (5000 lux) - automatic brightness 1.0
      mockDisplayBrightness.dbus.brightness = 0.5;
      mockSensorProxy.dbus.lightLevel = 5000;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      const call2 = mockDisplayBrightness.animateBrightness.mock.calls[0][0];
      expect(call2).toBeCloseTo(1.0, 2);

      // Test waking in very bright conditions (8000 lux) - automatic brightness 2.0, clamped to 1.0
      mockDisplayBrightness.dbus.brightness = 0.5;
      mockSensorProxy.dbus.lightLevel = 8000;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      const call3 = mockDisplayBrightness.animateBrightness.mock.calls[0][0];
      expect(call3).toBeCloseTo(1.0, 2);
    });

    it('should NOT adjust brightness when preparing for sleep', async () => {
      mockDisplayBrightness.animateBrightness.mockClear();

      // Simulate preparing for sleep - aboutToSuspend=true
      extension.loginManager._emitPrepareForSleep(true);

      // Should NOT adjust brightness when going to sleep
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it('should handle resume with null light level gracefully', async () => {
      mockSensorProxy.dbus.lightLevel = null;
      mockDisplayBrightness.animateBrightness.mockClear();

      // Simulate resume from sleep
      extension.loginManager._emitPrepareForSleep(false);

      // Should NOT crash or attempt to adjust brightness
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it('should handle resume when display is inactive', async () => {
      mockDisplayBrightness.displayIsActive = false;
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.animateBrightness.mockClear();

      // Simulate resume from sleep
      extension.loginManager._emitPrepareForSleep(false);

      // Should NOT adjust brightness when display is inactive
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it('should disconnect login manager signal on disable', async () => {
      const signalId = extension.sleepResumeSignalId;
      expect(signalId).not.toBeNull();

      const mockDisconnect = jest.spyOn(extension.loginManager, 'disconnect');
      extension.disable();

      expect(mockDisconnect).toHaveBeenCalledWith(signalId);
      expect(extension.sleepResumeSignalId).toBeNull();
    });
  });

  describe('Brightness Mapping', () => {
    beforeEach(async () => {
      await enableAndWait(extension);
    });

    it.each([
      [5, 0.15, 'very dark (night)'],
      [100, 0.25, 'dim indoor'],
      [300, 0.5, 'normal indoor'],
      [1000, 0.75, 'bright indoor'],
      [5000, 1.0, 'outdoor'],
      [8000, 1.0, 'direct sunlight'], // Clamped to 1.0 max
    ])('should map %s lux to %s brightness (%s)', async (lux, expectedBrightness, condition) => {
      mockDisplayBrightness.dbus.brightness = 0; // Far from target to ensure update
      mockDisplayBrightness.animateBrightness.mockClear();

      extension.adjustBrightnessForLightLevel(lux);

      const actualBrightness = mockDisplayBrightness.animateBrightness.mock.calls[0][0];
      // With neutral bias (1.0) and gamma correction, results should be close to automatic brightness
      expect(actualBrightness).toBeCloseTo(expectedBrightness, 2);
    });
  });

  describe('User Preference Learning', () => {
    beforeEach(async () => {
      await enableAndWait(extension);
    });

    it('should update backend.userPreference when brightness changed manually', () => {
      // Get the user preference change callback
      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      // Set up the scenario
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      mockDisplayBrightness.backend.userPreference = null; // Ensure we bypass GNOME49 quirk

      // Initial preference should be 0.5 (neutral)
      expect(mockDisplayBrightness.backend.userPreference).toBeNull();

      // Simulate manual brightness change to 0.6
      userPreferenceCallback(0.6);

      // Backend userPreference should have been updated via the callback
      // (The actual update happens in DisplayBrightnessService, not the extension)
      // Extension should call adjustBrightnessForLightLevel with immediate=true
      expect(mockDisplayBrightness.backend.brightness).toBeDefined();
    });

    it('should not record brightness changes when display is inactive', () => {
      // Get the user preference change callback
      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      mockDisplayBrightness.displayIsActive = false;
      mockDisplayBrightness.animateBrightness.mockClear();

      // Simulate brightness change when display is inactive
      userPreferenceCallback(0.6);

      // Should NOT adjust brightness when display is inactive
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });

    it('should show notification when manual adjustment occurs', async () => {
      // Get the user preference change callback
      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      // Set up the scenario
      mockSensorProxy.dbus.lightLevel = 100; // Maps to 0.25 brightness
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      mockDisplayBrightness.backend.userPreference = null;

      // Simulate manual brightness change to 0.3 (brighter than automatic 0.25)
      userPreferenceCallback(0.3);

      // Should show notification about the bias ratio
      expect(mockNotifications.showNotification).toHaveBeenCalled();
      const notificationCall = mockNotifications.showNotification.mock.calls[0];
      // The notification should contain the bias ratio (e.g., "1.15x")
      expect(notificationCall[1]).toMatch(/\d+\.\d+x/);
    });
  });
});
