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
      get_boolean: jest.fn().mockReturnValue(true), // auto-keyboard-backlight enabled
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
      addIdleWatch: jest.fn((timeout, callback) => {
        idleCallback = callback;
        return Promise.resolve();
      }),
      removeWatch: jest.fn().mockResolvedValue(undefined),
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
    });
  });

  describe('updateForLightLevel()', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should enable backlight and add idle watch in low light', async () => {
      mockDbus.isEnabled = false;
      await service.updateForLightLevel(true);

      expect(mockDbus.setBrightness).toHaveBeenCalledWith(1);
    });

    it('should add idle watch after enabling backlight', async () => {
      mockDbus.isEnabled = true; // Simulate backlight is now on
      await service.updateForLightLevel(true);

      // Wait for async operations
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.addIdleWatch).toHaveBeenCalledWith(10000, expect.any(Function));
    });

    it('should disable backlight and remove watches in bright light', async () => {
      // First enable in low light
      mockDbus.isEnabled = true;
      await service.updateForLightLevel(true);
      await new Promise((resolve) => setImmediate(resolve));

      // Reset mocks
      jest.clearAllMocks();

      // Then switch to bright light
      await service.updateForLightLevel(false);

      expect(mockDbus.setBrightness).toHaveBeenCalledWith(0);
      expect(mockIdleMonitor.removeWatch).toHaveBeenCalled();
    });

    it('should not do anything when auto-keyboard-backlight is disabled', async () => {
      mockSettings.get_boolean.mockReturnValue(false);

      await service.updateForLightLevel(true);

      expect(mockDbus.setBrightness).not.toHaveBeenCalled();
    });

    it('should not add idle watch if backlight is not enabled', async () => {
      mockDbus.isEnabled = false; // Backlight failed to turn on
      await service.updateForLightLevel(true);

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockIdleMonitor.addIdleWatch).not.toHaveBeenCalled();
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
      await service.updateForLightLevel(true);
      await new Promise((resolve) => setImmediate(resolve));

      jest.clearAllMocks();

      // Then handle display inactive
      await service.handleDisplayInactive();

      expect(mockIdleMonitor.removeWatch).toHaveBeenCalled();
    });
  });

  describe('idle state management', () => {
    beforeEach(async () => {
      await service.start();
      mockDbus.isEnabled = true;
      await service.updateForLightLevel(true);
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
      expect(mockIdleMonitor.removeWatch).not.toHaveBeenCalled();
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

      // Light increases while user is idle (calls updateForLightLevel with false)
      await service.updateForLightLevel(false);

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

      await service.updateForLightLevel(true);
      await new Promise((resolve) => setImmediate(resolve));

      // Try to enable again
      await service.updateForLightLevel(true);
      await new Promise((resolve) => setImmediate(resolve));

      // Should only add watch once
      expect(mockIdleMonitor.addIdleWatch).toHaveBeenCalledTimes(1);
    });

    it('should properly clean up watches on destroy', async () => {
      mockDbus.isEnabled = true;
      await service.updateForLightLevel(true);
      await new Promise((resolve) => setImmediate(resolve));

      await service.destroy();

      expect(mockIdleMonitor.removeWatch).toHaveBeenCalled();
      expect(mockIdleMonitor.destroy).toHaveBeenCalled();
      expect(mockDbus.destroy).toHaveBeenCalled();
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
});
