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
      brightness: 50,
      _settingBrightness: false,
      displayIsActive: true,
      setBrightness: jest.fn().mockResolvedValue(undefined),
      animateBrightness: jest.fn().mockResolvedValue(undefined),
      haltAnimatingBrightness: jest.fn(),
      dbus: {
        brightness: 50,
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
        if (lux <= 10) return 10;
        if (lux <= 200) return 25;
        if (lux <= 650) return 50;
        if (lux <= 2000) return 75;
        return 100;
      }),
      mapLuxToBrightness: jest.fn((lux, withHysteresis = true) => {
        let brightness;
        if (lux <= 10) brightness = 10;
        else if (lux <= 200) brightness = 25;
        else if (lux <= 650) brightness = 50;
        else if (lux <= 2000) brightness = 75;
        else brightness = 100;

        return { brightness };
      }),
      crossesBucketBoundary: jest.fn((prev, curr) => {
        // Simple mock: return true if values cross bucket boundaries
        if (prev === null || curr === null) return true;

        const getBucket = (lux) => {
          if (lux <= 10) return 0;
          if (lux <= 200) return 1;
          if (lux <= 650) return 2;
          if (lux <= 2000) return 3;
          return 4;
        };

        return getBucket(prev) !== getBucket(curr);
      }),
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
      expect(ext.ambientSignalId).toBeNull();
      expect(ext.brightnessSignalId).toBeNull();
      expect(ext.sleepResumeSignalId).toBeNull();

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

      // Verify all services started in order and completed before proceeding
      expect(startOrder).toEqual([
        'displayBrightness.start',
        'displayBrightness.start.complete',
        'sensorProxy.start',
        'sensorProxy.start.complete',
      ]);

      // Verify callbacks were registered AFTER services started
      expect(mockDisplayBrightness.onManualBrightnessChange.add).toHaveBeenCalled();
      expect(mockSensorProxy.onLightLevelChanged.add).toHaveBeenCalled();

      // Verify LoginManager was obtained
      expect(extension.loginManager).not.toBeNull();
    });

    it('should handle displayBrightness.start() failure gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      mockDisplayBrightness.start = jest
        .fn()
        .mockRejectedValue(new Error('D-Bus connection failed'));

      await extension.enable();

      // Should log error and show notification
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[AdaptiveBrightness] Failed to start Display Brightness Service:',
        expect.any(Error)
      );
      expect(mockNotifications.showNotification).toHaveBeenCalledWith(
        'Adaptive Brightness Extension Error',
        expect.stringContaining('D-Bus connection failed'),
        { transient: false }
      );

      // Should NOT proceed to start other services (early return)
      expect(mockSensorProxy.start).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle sensorProxy.start() failure gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      mockSensorProxy.start = jest.fn().mockRejectedValue(new Error('Sensor not available'));

      await extension.enable();

      // Should log error and show notification
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[AdaptiveBrightness] Failed to start Sensor Proxy Service:',
        expect.any(Error)
      );
      expect(mockNotifications.showNotification).toHaveBeenCalledWith(
        'Adaptive Brightness Extension Error',
        expect.stringContaining('Sensor not available'),
        { transient: false }
      );

      // Should NOT proceed to register callbacks (early return)
      expect(mockDisplayBrightness.onManualBrightnessChange.add).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Brightness Adjustment', () => {
    beforeEach(async () => {
      await extension.enable();
    });

    it('should adjust brightness directly using animateBrightness', async () => {
      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100; // Should map to 25% brightness
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(100);

      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(25);
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
      mockUserLearning.applyBiasTo.mockReturnValue(30); // Biased from 25 to 30

      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100; // Should map to 25% brightness
      mockDisplayBrightness.animateBrightness.mockClear();

      await extension.adjustBrightnessForLightLevel(100);

      expect(mockUserLearning.applyBiasTo).toHaveBeenCalledWith(25);
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(30);
    });

    it('should handle animation errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockDisplayBrightness.displayIsActive = true;
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.animateBrightness.mockRejectedValue(new Error('Animation failed'));

      await extension.adjustBrightnessForLightLevel(100);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[AdaptiveBrightness] Error animating brightness:',
        expect.any(Error)
      );

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
      mockDisplayBrightness.dbus.brightness = 10;
      mockSensorProxy.dbus.lightLevel = 100; // 25% target
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

      expect(mockDisplayBrightness.onManualBrightnessChange.add).toHaveBeenCalled();
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
      const brightnessSignalId = extension.brightnessSignalId;

      const mockLoginDisconnect = jest.spyOn(loginManager, 'disconnect');

      extension.disable();

      // Should disconnect ambient signal
      expect(mockDisplayBrightness.settings.disconnect).toHaveBeenCalled();

      // Should disconnect sleep/resume signal
      if (sleepSignalId) {
        expect(mockLoginDisconnect).toHaveBeenCalledWith(sleepSignalId);
      }
      expect(extension.sleepResumeSignalId).toBeNull();

      // Should disconnect brightness signal if it exists
      if (brightnessSignalId) {
        expect(mockDisplayBrightness.dbus.disconnect).toHaveBeenCalled();
      }
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
      mockDisplayBrightness.dbus.brightness = 75;
      mockSensorProxy.dbus.lightLevel = 0;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(10);

      // Test waking in bright conditions (5000 lux)
      mockDisplayBrightness.dbus.brightness = 50;
      mockSensorProxy.dbus.lightLevel = 5000;
      mockDisplayBrightness.animateBrightness.mockClear();
      extension.loginManager._emitPrepareForSleep(false);
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalledWith(100);
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
      [5, 10, 'very dark (night)'],
      [100, 25, 'dim indoor'],
      [300, 50, 'normal indoor'],
      [1000, 75, 'bright indoor'],
      [5000, 100, 'outdoor'],
    ])('should map %s lux to %s%% brightness (%s)', async (lux, expectedBrightness, condition) => {
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
      // Get the manual brightness change callback
      const manualBrightnessCallback =
        mockDisplayBrightness.onManualBrightnessChange.add.mock.calls[0][0];

      // Set up the scenario
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      const updateBiasSpy = jest.spyOn(extension.userLearning, 'updateBiasFromManualAdjustment');

      // Simulate manual brightness change
      manualBrightnessCallback(60);

      // Should update bias with the manual adjustment
      expect(updateBiasSpy).toHaveBeenCalledWith(60, expect.any(Number));
    });

    it('should not record brightness changes when display is inactive', () => {
      // Get the manual brightness change callback
      const manualBrightnessCallback =
        mockDisplayBrightness.onManualBrightnessChange.add.mock.calls[0][0];

      mockDisplayBrightness.displayIsActive = false;
      const updateBiasSpy = jest.spyOn(extension.userLearning, 'updateBiasFromManualAdjustment');

      // Simulate brightness change when display is inactive
      manualBrightnessCallback(60);

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

    it('should initialize UserPreferenceLearning with bias ratio from settings', () => {
      mockSettings.get_double.mockReturnValue(1.7);

      const newExtension = new AdaptiveBrightnessExtension({
        uuid: 'test@test.com',
        path: '/test',
      });
      newExtension.getSettings = jest.fn().mockReturnValue(mockSettings);
      newExtension.initializeServices();

      // Verify the constructor was called with the value from settings
      expect(mockUserPreferenceLearning).toHaveBeenCalledWith(1.7);
    });

    it('should persist bias ratio to settings when manual adjustment occurs', () => {
      // Mock the learning update to return a new bias ratio
      extension.userLearning.updateBiasFromManualAdjustment.mockReturnValue(1.5);

      // Get the manual brightness change callback
      const manualBrightnessCallback =
        mockDisplayBrightness.onManualBrightnessChange.add.mock.calls[0][0];

      // Set up the scenario
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;

      // Simulate manual brightness change
      manualBrightnessCallback(60);

      // Should persist the updated bias ratio to settings
      expect(mockSettings.set_double).toHaveBeenCalledWith('brightness-bias-ratio', 1.5);
    });

    it('should not persist when updateBiasFromManualAdjustment returns falsy', () => {
      // Mock no bias update (returns undefined)
      extension.userLearning.updateBiasFromManualAdjustment.mockReturnValue(undefined);

      const manualBrightnessCallback =
        mockDisplayBrightness.onManualBrightnessChange.add.mock.calls[0][0];

      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;
      mockSettings.set_double.mockClear();

      manualBrightnessCallback(60);

      // Should NOT persist if update returned falsy
      expect(mockSettings.set_double).not.toHaveBeenCalled();
    });

    it('should persist bias ratio when reset is triggered from notification', () => {
      // Mock the learning update to trigger notification
      extension.userLearning.updateBiasFromManualAdjustment.mockReturnValue(1.8);

      const manualBrightnessCallback =
        mockDisplayBrightness.onManualBrightnessChange.add.mock.calls[0][0];

      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;
      mockDisplayBrightness._settingBrightness = false;

      // Simulate manual adjustment to trigger notification with reset callback
      manualBrightnessCallback(60);

      // Get the notification options with reset callback
      const notificationCall = mockNotifications.showNotification.mock.calls.find(
        (call) => call[2]?.action?.label === 'Reset'
      );
      expect(notificationCall).toBeDefined();

      const resetCallback = notificationCall[2].action.callback;
      mockSettings.set_double.mockClear();

      // Trigger the reset callback
      resetCallback();

      // Should persist the reset value (1.0) to settings
      expect(mockSettings.set_double).toHaveBeenCalledWith('brightness-bias-ratio', 1.0);
      expect(extension.userLearning.reset).toHaveBeenCalled();
    });

    it('should react to external settings changes via handleBiasRatioChanges', () => {
      // Get the settings change callback
      const settingsChangeCallback = mockSettings.connect.mock.calls.find(
        (call) => call[0] === 'changed::brightness-bias-ratio'
      )?.[1];

      expect(settingsChangeCallback).toBeDefined();

      // Mock external settings change to 2.0
      mockSettings.get_double.mockReturnValue(2.0);
      extension.userLearning.biasRatio = 1.0; // Current value

      mockDisplayBrightness.animateBrightness.mockClear();
      mockSensorProxy.dbus.lightLevel = 100;
      mockDisplayBrightness.displayIsActive = true;

      // Simulate external settings change
      settingsChangeCallback();

      // Should update the user learning object
      expect(extension.userLearning.setBiasRatio).toHaveBeenCalledWith(2.0);

      // Should re-apply brightness with new bias
      expect(mockDisplayBrightness.animateBrightness).toHaveBeenCalled();
    });

    it('should ignore settings changes that match current bias (avoid re-entry)', () => {
      const settingsChangeCallback = mockSettings.connect.mock.calls.find(
        (call) => call[0] === 'changed::brightness-bias-ratio'
      )?.[1];

      // Set both to the same value
      mockSettings.get_double.mockReturnValue(1.5);
      extension.userLearning.biasRatio = 1.5;

      const setBiasRatioSpy = jest.spyOn(extension.userLearning, 'setBiasRatio');
      mockDisplayBrightness.animateBrightness.mockClear();

      // Simulate settings change with same value
      settingsChangeCallback();

      // Should NOT update or re-apply brightness (within 0.01 tolerance)
      expect(setBiasRatioSpy).not.toHaveBeenCalled();
      expect(mockDisplayBrightness.animateBrightness).not.toHaveBeenCalled();
    });
  });
});
