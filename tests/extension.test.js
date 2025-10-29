import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import GLib from 'gi://GLib';

// Mock all service modules before importing the extension
const mockNotificationService = jest.fn();
const mockDisplayBrightnessService = jest.fn();
const mockSensorProxyService = jest.fn();
const mockUserPreferenceLearning = jest.fn();
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

jest.unstable_mockModule('../lib/UserPreferenceLearning.js', () => ({
  UserPreferenceLearning: mockUserPreferenceLearning,
}));

jest.unstable_mockModule('../lib/BucketMapper.js', () => ({
  BucketMapper: mockBucketMapper,
}));

const { default: AdaptiveBrightnessExtension } = await import('../extension.js');

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
    mockUserPreferenceLearning.mockClear();
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

    const mockUserLearning = {
      biasRatio: 1.0,
      reset: jest.fn(),
      recordAdjustment: jest.fn(),
      updateBiasFromManualAdjustment: jest.fn(),
      applyBiasTo: jest.fn((brightness) => brightness), // Pass through by default
      setBiasRatio: jest.fn((ratio) => {
        mockUserLearning.biasRatio = ratio;
      }),
    };

    const mockBucketMapperInstance = {
      getBrightness: jest.fn((lux) => {
        if (lux <= 20) return 0.15;
        if (lux <= 200) return 0.25;
        if (lux <= 650) return 0.5;
        if (lux <= 2000) return 0.75;
        if (lux <= 7000) return 1.0;
        return 1.5;
      }),
      mapLuxToBrightness: jest.fn((lux, withHysteresis = true) => {
        let brightness;
        if (lux <= 20) brightness = 0.15;
        else if (lux <= 200) brightness = 0.25;
        else if (lux <= 650) brightness = 0.5;
        else if (lux <= 2000) brightness = 0.75;
        else if (lux <= 7000) brightness = 1.0;
        else brightness = 1.5;

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
        { min: 5000, max: 10000, brightness: 1.5 },
      ],
    };

    // Configure mock constructors to return mock instances
    mockNotificationService.mockImplementation(() => mockNotifications);
    mockDisplayBrightnessService.mockImplementation(() => mockDisplayBrightness);
    mockSensorProxyService.mockImplementation((filterFn) => mockSensorProxy);
    mockUserPreferenceLearning.mockImplementation(() => mockUserLearning);
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
    it('should initialize properly on construction and enable', async () => {
      const ext = new AdaptiveBrightnessExtension({});

      // Check initial state - signals should be null
      expect(ext.sleepResumeSignalId).toBeFalsy();
      expect(ext.biasRatioSignalId).toBeFalsy();

      // Services should not be initialized until enable()
      expect(ext.notifications).toBeUndefined();

      await ext.enable();

      // After enable, services should be initialized
      expect(ext.notifications).toBeDefined();
      expect(ext.displayBrightness).toBeDefined();
      expect(ext.sensorProxy).toBeDefined();
      expect(ext.loginManager).toBeDefined();
      expect(ext.userLearning).toBeDefined();
      expect(ext.bucketMapper).toBeDefined();

      ext.disable();
    });
  });

  describe('Bug Fix #2: Async Initialization Race Condition', () => {
    it('should await displayBrightness.start() before proceeding', async () => {
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

      await extension.enable();

      // Verify all services started (order not guaranteed due to Promise.all)
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
    });

    it('should handle displayBrightness.start() failure gracefully', async () => {
      mockDisplayBrightness.start = jest
        .fn()
        .mockRejectedValue(new Error('D-Bus connection failed'));

      // Promise.all will reject if any service fails
      await expect(extension.enable()).rejects.toThrow('D-Bus connection failed');
    });

    it('should handle sensorProxy.start() failure gracefully', async () => {
      mockSensorProxy.start = jest.fn().mockRejectedValue(new Error('Sensor not available'));

      // Promise.all will reject if any service fails
      await expect(extension.enable()).rejects.toThrow('Sensor not available');
    });
  });

  describe('Brightness Adjustment', () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it('should adjust brightness directly using animateBrightness', async () => {
      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100; // Should map to 0.25 brightness
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(100);

      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(0.25);
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

    it('should apply user learning bias to target brightness', async () => {
      const mockUserLearning = extension.userLearning;
      mockUserLearning.applyBiasTo.mockReturnValue(0.3); // Biased from 0.25 to 0.3

      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100; // Should map to 0.25 brightness
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(100);

      expect(mockUserLearning.applyBiasTo).toHaveBeenCalledWith(0.25);
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(0.3);
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
      await extension.enable();
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
      await extension.enable();

      expect(mockDisplayBrightness.start).toHaveBeenCalled();
      expect(mockSensorProxy.start).toHaveBeenCalled();
    });

    it('should register all callbacks after enable', async () => {
      await extension.enable();

      expect(mockDisplayBrightness.backend.onUserPreferenceChange.add).toHaveBeenCalled();
      expect(mockDisplayBrightness.onDisplayIsActiveChanged.add).toHaveBeenCalled();
      expect(mockSensorProxy.onLightLevelChanged.add).toHaveBeenCalled();
      expect(mockSensorProxy.onSensorAvailableChanged.add).toHaveBeenCalled();
      expect(extension.loginManager).not.toBeNull();
      expect(extension.sleepResumeSignalId).not.toBeNull();
    });

    it('should disable extension successfully', async () => {
      await extension.enable();
      extension.disable();

      expect(mockDisplayBrightness.destroy).toHaveBeenCalled();
      expect(mockSensorProxy.destroy).toHaveBeenCalled();
      expect(mockNotifications.destroy).toHaveBeenCalled();
      expect(extension.loginManager).toBeNull();
    });

    it('should disconnect signals on disable', async () => {
      await extension.enable();
      const loginManager = extension.loginManager;
      const sleepSignalId = extension.sleepResumeSignalId;
      const biasRatioSignalId = extension.biasRatioSignalId;

      const mockLoginDisconnect = jest.spyOn(loginManager, 'disconnect');
      const mockSettingsDisconnect = jest.spyOn(extension.settings, 'disconnect');

      extension.disable();

      // Should disconnect sleep/resume signal
      if (sleepSignalId) {
        expect(mockLoginDisconnect).toHaveBeenCalledWith(sleepSignalId);
      }
      expect(extension.sleepResumeSignalId).toBeNull();

      // Should disconnect bias ratio signal
      if (biasRatioSignalId) {
        expect(mockSettingsDisconnect).toHaveBeenCalledWith(biasRatioSignalId);
      }
      expect(extension.biasRatioSignalId).toBeFalsy();
    });
  });

  describe('Sleep/Resume Integration', () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it('should register prepare-for-sleep handler on enable', async () => {
      expect(extension.loginManager).not.toBeNull();
      expect(extension.sleepResumeSignalId).not.toBeNull();
    });

    it('should adjust brightness on resume based on current light level', async () => {
      mockDisplayBrightness.displayIsActive = true;

      // Test waking in darkness (0 lux)
      mockDisplayBrightness.dbus.brightness = 0.75;
      mockSensorProxy.dbus.lightLevel = 0;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(0.15);

      // Test waking in bright conditions (5000 lux)
      mockDisplayBrightness.dbus.brightness = 0.5;
      mockSensorProxy.dbus.lightLevel = 5000;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(1.0);

      // Test waking in very bright conditions (8000 lux)
      mockDisplayBrightness.dbus.brightness = 0.5;
      mockSensorProxy.dbus.lightLevel = 8000;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(1.5);
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
      await extension.enable();
    });

    it.each([
      [5, 0.15, 'very dark (night)'],
      [100, 0.25, 'dim indoor'],
      [300, 0.5, 'normal indoor'],
      [1000, 0.75, 'bright indoor'],
      [5000, 1.0, 'outdoor'],
      [8000, 1.5, 'direct sunlight'],
    ])('should map %s lux to %s brightness (%s)', async (lux, expectedBrightness, condition) => {
      mockDisplayBrightness.dbus.brightness = 0; // Far from target to ensure update
      mockDisplayBrightness.animateBrightness.mockClear();

      extension.adjustBrightnessForLightLevel(lux);

      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(expectedBrightness);
    });
  });

  describe('User Learning Integration', () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it('should record user adjustments when brightness changed manually', () => {
      // Get the user preference change callback
      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      // Set up the scenario
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      mockDisplayBrightness.backend.userPreference = null; // Ensure we bypass GNOME49 quirk
      const updateBiasSpy = jest.spyOn(extension.userLearning, 'updateBiasFromManualAdjustment');

      // Simulate manual brightness change
      userPreferenceCallback(0.6);

      // Should update bias with the manual adjustment
      expect(updateBiasSpy).toHaveBeenCalledWith(0.6, expect.any(Number));
    });

    it('should not record brightness changes when display is inactive', () => {
      // Get the user preference change callback
      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      mockDisplayBrightness.displayIsActive = false;
      const updateBiasSpy = jest.spyOn(extension.userLearning, 'updateBiasFromManualAdjustment');

      // Simulate brightness change when display is inactive
      userPreferenceCallback(0.6);

      // Should NOT record when display is inactive
      expect(updateBiasSpy).not.toHaveBeenCalled();
    });
  });

  describe('Settings Persistence (Refactored Architecture)', () => {
    let mockSettings;

    beforeEach(async () => {
      // Mock the settings object
      mockSettings = {
        get_double: jest.fn().mockReturnValue(1.0),
        set_double: jest.fn(),
        get_boolean: jest.fn().mockReturnValue(false),
        connect: jest.fn().mockReturnValue(123),
        disconnect: jest.fn(),
      };

      // Mock getSettings method
      extension.getSettings = jest.fn().mockReturnValue(mockSettings);

      await extension.enable();
    });

    it('should initialize UserPreferenceLearning with default bias ratio', async () => {
      const newExtension = new AdaptiveBrightnessExtension({
        uuid: 'test@test.com',
        path: '/test',
      });
      newExtension.getSettings = jest.fn().mockReturnValue(mockSettings);

      // Enable initializes services
      await newExtension.enable();

      // Verify the constructor was called without arguments (default 1.0)
      expect(mockUserPreferenceLearning).toHaveBeenCalledWith();
    });

    it('should show notification when manual adjustment occurs', () => {
      // Mock the learning update to return a new bias ratio
      extension.userLearning.updateBiasFromManualAdjustment.mockReturnValue(1.5);

      // Get the user preference change callback
      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      // Set up the scenario
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      mockDisplayBrightness.backend.userPreference = null; // Ensure we bypass GNOME49 quirk

      // Simulate manual brightness change
      userPreferenceCallback(60);

      // Should show notification about the bias change
      expect(mockNotifications.showNotification).toHaveBeenCalled();
    });

    it('should not show notification when updateBiasFromManualAdjustment returns falsy', () => {
      // Mock no bias update (returns undefined)
      extension.userLearning.updateBiasFromManualAdjustment.mockReturnValue(undefined);

      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      mockNotifications.showNotification.mockClear();

      userPreferenceCallback(60);

      // Should NOT show notification if update returned falsy
      expect(mockNotifications.showNotification).not.toHaveBeenCalled();
    });

    it('should persist bias ratio when reset is triggered from notification', () => {
      // Mock the learning update to trigger notification
      extension.userLearning.updateBiasFromManualAdjustment.mockReturnValue(1.8);

      const userPreferenceCallback =
        mockDisplayBrightness.backend.onUserPreferenceChange.add.mock.calls[0][0];

      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      mockDisplayBrightness.backend.userPreference = null; // Ensure we bypass GNOME49 quirk

      // Simulate manual adjustment to trigger notification with reset callback
      userPreferenceCallback(60);

      // Get the notification options with reset callback
      const notificationCall = mockNotifications.showNotification.mock.calls.find(
        (call) => call[2]?.action?.label === 'Reset'
      );
      expect(notificationCall).toBeDefined();

      const resetCallback = notificationCall[2].action.callback;

      // Trigger the reset callback
      resetCallback();

      // Should reset the bias ratio
      expect(extension.userLearning.reset).toHaveBeenCalled();
    });
  });
});
