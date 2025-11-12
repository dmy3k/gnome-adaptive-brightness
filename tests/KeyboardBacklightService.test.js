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
        n_children: jest.fn().mockReturnValue(2), // Default [0, 1] - first two buckets enabled
        get_child_value: jest.fn((i) => ({
          get_uint32: () => i, // Return bucket indices 0, 1
        })),
      }),
      get_uint: jest.fn().mockReturnValue(10), // keyboard-idle-timeout default (10 seconds)
      connect: jest.fn().mockReturnValue(1), // Return signal ID
      disconnect: jest.fn(),
    };

    // Mock D-Bus
    mockDbus = {
      connect: jest.fn().mockResolvedValue(undefined),
      setBrightness: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      isAvailable: true,
      isEnabled: false,
    };

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

    it('should return false when hardware is not available', async () => {
      mockDbus.isAvailable = false;

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
      mockDbus.isEnabled = false;
      await service.updateForBrightnessBucket(0); // Bucket 0 is enabled

      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1);
    });

    it('should add idle watch after enabling backlight', async () => {
      mockDbus.isEnabled = true; // Simulate backlight is now on
      await service.updateForBrightnessBucket(1); // Bucket 1 is enabled

      // Wait for async operations
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalledWith(10000, expect.any(Function));
    });

    it('should disable backlight and remove watches in bright light', async () => {
      // First enable in low light
      mockDbus.isEnabled = true;
      await service.updateForBrightnessBucket(0); // Bucket 0 is enabled
      await new Promise((resolve) => setImmediate(resolve));

      // Reset mocks
      jest.clearAllMocks();

      // Then switch to bright light
      await service.updateForBrightnessBucket(2); // Bucket 2 is NOT enabled

      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled();
    });

    it('should disable backlight when no buckets are enabled', async () => {
      // When no buckets are enabled, extension.js passes bucket index but it won't match
      mockDbus.isEnabled = true; // Backlight starts enabled

      // Mock empty array (all buckets disabled)
      mockSettings.get_value.mockReturnValue({
        n_children: jest.fn().mockReturnValue(0),
        get_child_value: jest.fn(),
      });
      // Need to reload enabled buckets
      const settingsCallback = mockSettings.connect.mock.calls[0][1];
      await settingsCallback(mockSettings, 'keyboard-backlight-buckets');

      await service.updateForBrightnessBucket(0); // Bucket 0 not enabled anymore

      // Should disable the backlight
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled();
    });

    it('should not add idle watch if setBrightness throws error', async () => {
      mockDbus.setBrightness.mockRejectedValueOnce(new Error('Hardware failure'));
      await service.updateForBrightnessBucket(0);

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.startMonitoring).not.toHaveBeenCalled();
    });
  });

  describe('handleDisplayInactive()', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should disable backlight when display becomes inactive', async () => {
      await service.handleDisplayInactive();

      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
    });

    it('should remove any active watches', async () => {
      // First enable backlight with watches
      mockDbus.isEnabled = true;
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
      mockDbus.isEnabled = true;
      await service.updateForBrightnessBucket(0); // Bucket 0 is enabled
      await new Promise((resolve) => setImmediate(resolve));
      jest.clearAllMocks();
    });

    it('should turn off backlight when user goes idle', async () => {
      mockDbus.isEnabled = true;

      // Simulate user going idle
      await idleCallback(true);

      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
    });

    it('should not manually manage watches (IdleMonitorDbus handles cycling)', async () => {
      mockDbus.isEnabled = true;

      // Simulate user going idle
      await idleCallback(true);
      await new Promise((resolve) => setImmediate(resolve));

      // Service should NOT manually remove or add watches
      // IdleMonitorDbus handles the idle/active watch cycling internally
      expect(mockIdleMonitor.stopMonitoring).not.toHaveBeenCalled();
    });

    it('should not turn off backlight when idle if already disabled', async () => {
      mockDbus.isEnabled = false;

      await idleCallback(true);

      expect(mockDbus.setBrightness).not.toHaveBeenCalled();
    });

    it('should re-enable backlight when user returns and still in low light', async () => {
      mockDbus.isEnabled = true;

      // User goes idle
      await idleCallback(true);
      await new Promise((resolve) => setImmediate(resolve));

      jest.clearAllMocks();
      mockDbus.isEnabled = false; // Backlight is now off

      // User becomes active (IdleMonitorDbus calls callback with false)
      await idleCallback(false);
      await new Promise((resolve) => setImmediate(resolve));

      // Should re-enable backlight
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1);
    });

    it('should not re-enable backlight when user returns if light increased', async () => {
      mockDbus.isEnabled = true;

      // User goes idle in low light
      await idleCallback(true);
      await new Promise((resolve) => setImmediate(resolve));

      // Light increases while user is idle
      await service.updateForBrightnessBucket(2); // Bucket 2 is NOT enabled

      jest.clearAllMocks();
      mockDbus.isEnabled = false;

      // User becomes active (IdleMonitorDbus calls callback with false)
      await idleCallback(false);
      await new Promise((resolve) => setImmediate(resolve));

      // Should NOT re-enable backlight because light increased
      expect(mockDbus.setBrightness).not.toHaveBeenCalled();
    });
  });

  describe('watch management', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should not add duplicate idle watches', async () => {
      mockDbus.isEnabled = true;

      await service.updateForBrightnessBucket(0); // Bucket 0 is enabled
      await new Promise((resolve) => setImmediate(resolve));

      // Try to enable again
      await service.updateForBrightnessBucket(0);
      await new Promise((resolve) => setImmediate(resolve));

      // Should only add watch once
      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalledTimes(1);
    });

    it('should properly clean up watches on destroy', async () => {
      mockDbus.isEnabled = true;
      await service.updateForBrightnessBucket(1); // Bucket 1 is enabled
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

    it('should disable backlight when keyboard-backlight-buckets becomes empty', async () => {
      // First enable backlight in a bucket
      mockDbus.isEnabled = true;
      await service.updateForBrightnessBucket(0); // Bucket 0 is enabled
      await new Promise((resolve) => setImmediate(resolve));

      jest.clearAllMocks();

      // Mock empty array (all buckets disabled)
      mockSettings.get_value.mockReturnValue({
        n_children: jest.fn().mockReturnValue(0),
        get_child_value: jest.fn(),
      });

      // Trigger settings change callback
      await settingsCallback(mockSettings, 'keyboard-backlight-buckets');

      // Now bucket 0 is not enabled, should disable backlight
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
    });

    it('should restart idle watch when keyboard-idle-timeout changes', async () => {
      // First enable backlight with watches
      mockDbus.isEnabled = true;
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
      mockDbus.isEnabled = true;

      await service.updateForBrightnessBucket(1); // Bucket 1 is enabled
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalledWith(30000, expect.any(Function));
    });
  });

  describe('isAvailable', () => {
    it('should return true when D-Bus hardware is available', async () => {
      mockDbus.isAvailable = true;
      await service.start();

      expect(service.isAvailable).toBe(true);
    });

    it('should return false when D-Bus hardware is not available', async () => {
      mockDbus.isAvailable = false;
      await service.start();

      expect(service.isAvailable).toBe(false);
    });
  });

  describe('Light level changes while idle (bug fix)', () => {
    it('should re-enable backlight when light goes dark->bright->dark while user was idle', async () => {
      await service.start();

      // Step 1: Dark room, backlight enabled, user goes idle
      // Simulate hardware enabling when setBrightness(1) is called
      mockDbus.setBrightness.mockImplementation((value) => {
        mockDbus.isEnabled = value > 0;
        return Promise.resolve();
      });

      await service.updateForBrightnessBucket(0); // Bucket 0 enabled - dark
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1);
      expect(mockIdleMonitor.startMonitoring).toHaveBeenCalled();

      mockDbus.setBrightness.mockClear();

      // User goes idle - backlight disabled
      await idleCallback(true);
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
      mockDbus.isEnabled = false;
      mockDbus.setBrightness.mockClear();

      // Step 2: Bright lamp turned on while idle
      await service.updateForBrightnessBucket(2); // Bucket 2 NOT enabled - bright
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0); // Stays off
      expect(mockIdleMonitor.stopMonitoring).toHaveBeenCalled(); // Monitoring stopped

      // Step 3: Lamp turned off - back to dark
      mockDbus.setBrightness.mockClear();
      await service.updateForBrightnessBucket(0); // Bucket 0 enabled - dark again

      // BUG FIX: Should re-enable backlight because we stopped monitoring
      // and can no longer track if user is idle. We assume user is active.
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1);
    });

    it('should re-enable backlight when user becomes active in dark room', async () => {
      await service.start();

      // Simulate hardware enabling when setBrightness(1) is called
      mockDbus.setBrightness.mockImplementation((value) => {
        mockDbus.isEnabled = value > 0;
        return Promise.resolve();
      });

      // Dark room, backlight enabled
      await service.updateForBrightnessBucket(0); // Bucket 0 enabled
      mockDbus.setBrightness.mockClear();

      // User goes idle
      await idleCallback(true);
      mockDbus.isEnabled = false;
      mockDbus.setBrightness.mockClear();

      // Lamp turned on then off while idle
      await service.updateForBrightnessBucket(2); // Bucket 2 NOT enabled
      await service.updateForBrightnessBucket(0); // Bucket 0 enabled
      mockDbus.setBrightness.mockClear();

      // User becomes active again in dark room
      await idleCallback(false);
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1); // Re-enabled
    });

    it('should ignore stale callbacks from stopped monitoring sessions', async () => {
      await service.start();

      mockDbus.setBrightness.mockImplementation((value) => {
        mockDbus.isEnabled = value > 0;
        return Promise.resolve();
      });

      // Step 1: Dark room, backlight enabled, monitoring starts
      await service.updateForBrightnessBucket(0); // Bucket 0 enabled
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1);
      const firstSessionCallback = idleCallback; // Save reference to first session callback
      mockDbus.setBrightness.mockClear();

      // Step 2: User goes idle
      await idleCallback(true);
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
      mockDbus.isEnabled = false;
      mockDbus.setBrightness.mockClear();

      // Step 3: Light increases (stops monitoring), then decreases again quickly
      await service.updateForBrightnessBucket(2); // Bucket 2 NOT enabled - stops monitoring
      await service.updateForBrightnessBucket(0); // Bucket 0 enabled - starts NEW monitoring session
      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1); // Backlight re-enabled
      mockDbus.setBrightness.mockClear();

      // Step 4: OLD active callback from first session fires (should be ignored!)
      await firstSessionCallback(false);

      // Should NOT set brightness again (callback from old session ignored)
      expect(mockDbus.setBrightness).not.toHaveBeenCalled();
    });
  });
});
