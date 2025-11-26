/**
 * Tests for KeyboardBacklightService
 * Tests the coordination between keyboard backlight hardware and idle monitoring
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../lib/KeyboardBacklightDbus.js', () => ({
  KeyboardBacklightDbus: jest.fn(),
}));

jest.unstable_mockModule('../lib/IdleMonitorDbus.js', () => ({
  IdleMonitorDbus: jest.fn(),
}));

const { KeyboardBacklightService } = await import('../lib/KeyboardBacklightService.js');
const { KeyboardBacklightDbus } = await import('../lib/KeyboardBacklightDbus.js');
const { IdleMonitorDbus } = await import('../lib/IdleMonitorDbus.js');

describe('KeyboardBacklightService', () => {
  let service;
  let mockSettings;
  let mockDbus;
  let mockIdleMonitor;
  let idleCallback;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock settings
    mockSettings = {
      get_value: jest.fn().mockReturnValue({
        n_children: jest.fn().mockReturnValue(5), // Default [2, 1, 0, 0, 0] - levels for 5 buckets
        get_child_value: jest.fn((i) => ({
          get_uint32: () => [2, 1, 0, 0, 0][i], // Return backlight level for each bucket
        })),
      }),
      get_uint: jest.fn().mockReturnValue(10), // keyboard-idle-timeout default (10 seconds)
      connect: jest.fn().mockReturnValue(1), // Return signal ID
      disconnect: jest.fn(),
    };

    // Mock D-Bus - new property-based API
    mockDbus = {
      connect: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      Steps: 3, // Default: 3 steps (off, low, high)
      BrightnessLevel: 0,
    };

    // Track BrightnessLevel setter calls
    Object.defineProperty(mockDbus, 'BrightnessLevel', {
      get: jest.fn(() => mockDbus._brightnessLevel || 0),
      set: jest.fn((value) => {
        mockDbus._brightnessLevel = value;
      }),
      configurable: true,
    });

    // Mock idle monitor
    mockIdleMonitor = {
      connect: jest.fn().mockResolvedValue(undefined),
      startMonitoring: jest.fn((timeout, callback) => {
        idleCallback = callback;
        mockIdleMonitor.isMonitoring = true;
        return Promise.resolve();
      }),
      stopMonitoring: jest.fn().mockImplementation(() => {
        mockIdleMonitor.isMonitoring = false;
        return Promise.resolve();
      }),
      isMonitoring: false,
      destroy: jest.fn(),
    };

    KeyboardBacklightDbus.mockImplementation(() => mockDbus);
    IdleMonitorDbus.mockImplementation(() => mockIdleMonitor);

    service = new KeyboardBacklightService(mockSettings);
  });

  describe('start()', () => {
    it('should connect to D-Bus and idle monitor when hardware is available', async () => {
      const result = await service.start();

      expect(mockDbus.connect).toHaveBeenCalled();
      expect(mockIdleMonitor.connect).toHaveBeenCalled();
      expect(mockSettings.connect).toHaveBeenCalledWith('changed', expect.any(Function));
      expect(result).toBe(true);
    });

    it('should return false when hardware is not available (Steps < 2)', async () => {
      // Redefine Steps property before calling start()
      delete mockDbus.Steps;
      mockDbus.Steps = 1;

      const result = await service.start();

      expect(result).toBe(false);
      expect(mockIdleMonitor.connect).not.toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      mockDbus.connect.mockRejectedValue(new Error('Connection failed'));

      const result = await service.start();

      expect(result).toBe(false);
      // Settings listener was never connected due to early error
      expect(mockSettings.connect).not.toHaveBeenCalled();
    });

    it('should clean up if error occurs after initialization', async () => {
      // Simulate error during settings connection by making it throw
      mockSettings.connect.mockImplementationOnce(() => {
        throw new Error('Settings connection failed');
      });

      const result = await service.start();

      expect(result).toBe(false);
      // Dbus and idle monitor should be cleaned up
      expect(mockDbus.destroy).toHaveBeenCalled();
      expect(mockIdleMonitor.destroy).toHaveBeenCalled();
    });
  });

  describe('updateForBrightnessBucket()', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should enable backlight and add idle watch in low light', async () => {
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2

      expect(mockDbus.BrightnessLevel).toBe(2);
    });

    it('should add idle watch after enabling backlight', async () => {
      await service.updateForBrightnessBucket(1); // Bucket 1 has level 1

      // Wait for async operations
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalledWith(10000, expect.any(Function));
    });

    it('should disable backlight and remove watches in bright light', async () => {
      // First enable in low light
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2
      await new Promise((resolve) => setImmediate(resolve));

      // Reset mocks
      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });

      // Then switch to bright light
      await service.updateForBrightnessBucket(2); // Bucket 2 has level 0 (off)

      expect(mockDbus.BrightnessLevel).toBe(0);
      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled();
    });

    it('should disable backlight when all buckets have level 0', async () => {
      // When all buckets have level 0, backlight is disabled for all lighting conditions
      // Mock array with all zeros (all buckets disabled)
      mockSettings.get_value.mockReturnValue({
        n_children: jest.fn().mockReturnValue(5),
        get_child_value: jest.fn((i) => ({
          get_uint32: () => 0, // All buckets have level 0
        })),
      });
      // Need to reload backlight levels
      const settingsCallback = mockSettings.connect.mock.calls[0][1];
      await settingsCallback(mockSettings, 'keyboard-backlight-levels');

      await service.updateForBrightnessBucket(0); // Bucket 0 now has level 0

      // Should disable the backlight
      expect(mockDbus.BrightnessLevel).toBe(0);
      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled();
    });

    it('should add idle watch even if BrightnessLevel setter has no side effects', async () => {
      // BrightnessLevel is a direct property setter, doesn't throw errors
      await service.updateForBrightnessBucket(0);

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalled();
    });
  });

  describe('handleDisplayInactive()', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should disable backlight when display becomes inactive', async () => {
      await service.handleDisplayInactive();

      expect(mockDbus.BrightnessLevel).toBe(0);
    });

    it('should remove any active watches', async () => {
      // First enable backlight with watches
      await service.updateForBrightnessBucket(0); // Bucket 0 is enabled
      await new Promise((resolve) => setImmediate(resolve));

      jest.clearAllMocks();

      // Then handle display inactive
      await service.handleDisplayInactive();

      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled();
    });
  });

  describe('idle state management', () => {
    beforeEach(async () => {
      await service.start();
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2
      await new Promise((resolve) => setImmediate(resolve));
      jest.clearAllMocks();
    });

    it('should turn off backlight when user goes idle', async () => {
      // Simulate user going idle
      await idleCallback(true);

      expect(mockDbus.BrightnessLevel).toBe(0);
    });

    it('should not manually manage watches (IdleMonitorDbus handles cycling)', async () => {
      // Simulate user going idle
      await idleCallback(true);
      await new Promise((resolve) => setImmediate(resolve));

      // Service should NOT manually remove or add watches
      // IdleMonitorDbus handles the idle/active watch cycling internally
      expect(mockIdleMonitor.stopMonitoring).not.toHaveBeenCalled();
    });

    it('should not turn off backlight when idle if Steps < 2', async () => {
      // Save the current brightness level before changing Steps
      const currentLevel = mockDbus._brightnessLevel || 2; // Backlight was set to 2 in beforeEach

      mockDbus.Steps = 1;

      await idleCallback(true);

      // BrightnessLevel setter should not have been called since we check Steps first
      // So the value remains unchanged
      const setter = Object.getOwnPropertyDescriptor(mockDbus, 'BrightnessLevel').set;
      expect(setter).not.toHaveBeenCalled();
    });

    it('should re-enable backlight when user returns and still in low light', async () => {
      // User goes idle
      await idleCallback(true);
      await new Promise((resolve) => setImmediate(resolve));

      jest.clearAllMocks();

      // Track the brightness level properly
      let trackedLevel = 0;
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => trackedLevel),
        set: jest.fn((value) => {
          trackedLevel = value;
        }),
        configurable: true,
      });

      // User becomes active (IdleMonitorDbus calls callback with false)
      await idleCallback(false);
      await new Promise((resolve) => setImmediate(resolve));

      // Should re-enable backlight at configured level (2 for bucket 0)
      const setter = Object.getOwnPropertyDescriptor(mockDbus, 'BrightnessLevel').set;
      expect(setter).toHaveBeenCalledWith(2);
    });

    it('should not re-enable backlight when user returns if light increased', async () => {
      // User goes idle in low light
      await idleCallback(true);
      await new Promise((resolve) => setImmediate(resolve));

      // Light increases while user is idle
      await service.updateForBrightnessBucket(2); // Bucket 2 has level 0 (off)

      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });

      // User becomes active (IdleMonitorDbus calls callback with false)
      await idleCallback(false);
      await new Promise((resolve) => setImmediate(resolve));

      // Should NOT re-enable backlight because light increased
      // BrightnessLevel setter should not have been called
      const setter = Object.getOwnPropertyDescriptor(mockDbus, 'BrightnessLevel').set;
      expect(setter).not.toHaveBeenCalled();
    });
  });

  describe('watch management', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should not add duplicate idle watches', async () => {
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2
      await new Promise((resolve) => setImmediate(resolve));

      // Try to enable again
      await service.updateForBrightnessBucket(0);
      await new Promise((resolve) => setImmediate(resolve));

      // Should only add watch once
      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalledTimes(1);
    });

    it('should properly clean up watches on destroy', async () => {
      await service.updateForBrightnessBucket(1); // Bucket 1 has level 1
      await new Promise((resolve) => setImmediate(resolve));

      await service.destroy();

      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled();
      expect(mockIdleMonitor.destroy).toHaveBeenCalled();
      expect(mockDbus.destroy).toHaveBeenCalled();
    });
  });

  describe('settings changes', () => {
    let settingsCallback;

    beforeEach(async () => {
      await service.start();
      // Capture the settings change callback
      settingsCallback = mockSettings.connect.mock.calls[0][1];
    });

    it('should disable backlight when keyboard-backlight-levels becomes all zeros', async () => {
      // First enable backlight in a bucket
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2
      await new Promise((resolve) => setImmediate(resolve));

      jest.clearAllMocks();

      // Mock array with all zeros (all buckets disabled)
      mockSettings.get_value.mockReturnValue({
        n_children: jest.fn().mockReturnValue(5),
        get_child_value: jest.fn((i) => ({
          get_uint32: () => 0, // All buckets have level 0
        })),
      });

      // Trigger settings change callback
      await settingsCallback(mockSettings, 'keyboard-backlight-levels');

      // Now bucket 0 has level 0, should disable backlight
      expect(mockDbus.BrightnessLevel).toBe(0);
    });

    it('should restart idle watch when keyboard-idle-timeout changes', async () => {
      // First enable backlight with watches
      await service.updateForBrightnessBucket(0); // Bucket 0 is enabled
      await new Promise((resolve) => setImmediate(resolve));

      jest.clearAllMocks();
      mockSettings.get_uint.mockReturnValue(20); // Change to 20 seconds

      // Simulate timeout setting change
      await settingsCallback(mockSettings, 'keyboard-idle-timeout');

      // Should remove old watch and add new one with new timeout
      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled();
      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalledWith(20000, expect.any(Function));
    });

    it('should not restart idle watch if no watch is active', async () => {
      mockSettings.get_uint.mockReturnValue(15);

      await settingsCallback(mockSettings, 'keyboard-idle-timeout');

      expect(mockIdleMonitor.stopMonitoring).not.toHaveBeenCalled();
      expect(mockIdleMonitor.startMonitoring).not.toHaveBeenCalled();
    });

    it('should use custom timeout value from settings', async () => {
      mockSettings.get_uint.mockReturnValue(30); // 30 seconds

      await service.updateForBrightnessBucket(1); // Bucket 1 has level 1
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalledWith(30000, expect.any(Function));
    });
  });

  describe('Light level changes while idle (bug fix)', () => {
    it('should re-enable backlight when light goes dark->bright->dark while user was idle', async () => {
      await service.start();

      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2 - dark
      expect(mockDbus.BrightnessLevel).toBe(2);
      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalled();

      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => mockDbus._brightnessLevel || 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });

      // User goes idle - backlight disabled
      await idleCallback(true);
      expect(mockDbus.BrightnessLevel).toBe(0);

      // Step 2: Bright lamp turned on while idle
      await service.updateForBrightnessBucket(2); // Bucket 2 has level 0 - bright
      expect(mockDbus.BrightnessLevel).toBe(0); // Stays off
      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled(); // Monitoring stopped

      // Step 3: Lamp turned off - back to dark
      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => mockDbus._brightnessLevel || 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2 - dark again

      // BUG FIX: Should re-enable backlight because we stopped monitoring
      // and can no longer track if user is idle. We assume user is active.
      expect(mockDbus.BrightnessLevel).toBe(2);
    });

    it('should re-enable backlight when user becomes active in dark room', async () => {
      await service.start();

      // Dark room, backlight enabled
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2
      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => mockDbus._brightnessLevel || 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });

      // User goes idle
      await idleCallback(true);

      // Lamp turned on then off while idle
      await service.updateForBrightnessBucket(2); // Bucket 2 has level 0
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2
      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => mockDbus._brightnessLevel || 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });

      // User becomes active again in dark room
      await idleCallback(false);
      expect(mockDbus.BrightnessLevel).toBe(2); // Re-enabled at level 2
    });

    it('should ignore stale callbacks from stopped monitoring sessions', async () => {
      await service.start();

      // Step 1: Dark room, backlight enabled, monitoring starts
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2
      expect(mockDbus.BrightnessLevel).toBe(2);
      const firstSessionCallback = idleCallback; // Save reference to first session callback
      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => mockDbus._brightnessLevel || 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });

      // Step 2: User goes idle
      await idleCallback(true);
      expect(mockDbus.BrightnessLevel).toBe(0);

      // Step 3: Light increases (stops monitoring), then decreases again quickly
      await service.updateForBrightnessBucket(2); // Bucket 2 has level 0 - stops monitoring
      await service.updateForBrightnessBucket(0); // Bucket 0 has level 2 - starts NEW monitoring session
      expect(mockDbus.BrightnessLevel).toBe(2); // Backlight re-enabled at level 2
      jest.clearAllMocks();
      Object.defineProperty(mockDbus, 'BrightnessLevel', {
        get: jest.fn(() => mockDbus._brightnessLevel || 0),
        set: jest.fn((value) => { mockDbus._brightnessLevel = value; }),
        configurable: true,
      });

      // Step 4: OLD active callback from first session fires (should be ignored!)
      await firstSessionCallback(false);

      // Should NOT set brightness again (callback from old session ignored)
      const setter = Object.getOwnPropertyDescriptor(mockDbus, 'BrightnessLevel').set;
      expect(setter).not.toHaveBeenCalled();
    });
  });
});
