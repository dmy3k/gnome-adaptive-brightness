/**
 * Tests for KeyboardBacklightDbus
 * Tests the low-level D-Bus interface for keyboard backlight control
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock Gio with synchronous callback invocation for deterministic testing
const mockProxy = {
  connect: jest.fn().mockReturnValue(1), // Return signal ID
  disconnect: jest.fn(),
  call: jest.fn((method, params, flags, timeout, cancellable, callback) => {
    // Create mock result based on method
    let mockResult;
    if (method === 'GetMaxBrightness') {
      mockResult = {
        deep_unpack: () => 2,
      };
    } else if (method === 'GetBrightness') {
      mockResult = {
        deep_unpack: () => 0,
      };
    } else if (method === 'SetBrightness') {
      mockResult = {};
    }

    // For tests, we need to invoke callback asynchronously but ensure
    // the promise in the actual code waits for it. Using process.nextTick
    // ensures the callback runs before any other I/O or timers.
    // The callback receives (source, result) where source has call_finish(result)
    const mockSource = {
      call_finish: (result) => mockResult,
    };
    process.nextTick(() => callback(mockSource, mockResult));
  }),
};

const mockBus = {};

const mockGio = {
  BusType: {
    SYSTEM: 0,
  },
  DBusProxyFlags: {
    NONE: 0,
  },
  DBusCallFlags: {
    NONE: 0,
  },
  bus_get_sync: jest.fn().mockReturnValue(mockBus),
  DBusProxy: {
    new: jest.fn((bus, flags, info, name, path, iface, cancellable, callback) => {
      // Use process.nextTick for immediate async execution
      process.nextTick(() => callback(null, null));
    }),
    new_finish: jest.fn(() => mockProxy),
  },
};

const mockGLib = {
  Variant: jest.fn((type, value) => ({ type, value })),
};

jest.unstable_mockModule('gi://Gio', () => ({ default: mockGio }));
jest.unstable_mockModule('gi://GLib', () => ({ default: mockGLib }));

const { KeyboardBacklightDbus } = await import('../lib/KeyboardBacklightDbus.js');

describe('KeyboardBacklightDbus', () => {
  let dbus;
  let signalCallback;

  beforeEach(() => {
    jest.clearAllMocks();
    // Capture signal callback when mockProxy.connect is called
    mockProxy.connect.mockImplementation((signal, callback) => {
      if (signal === 'g-properties-changed') {
        signalCallback = callback;
      }
      return 1; // Return signal ID
    });
    dbus = new KeyboardBacklightDbus();
  });

  describe('connect()', () => {
    it('should connect to UPower keyboard backlight service', async () => {
      await dbus.connect();

      expect(mockGio.DBusProxy.new).toHaveBeenCalledWith(
        expect.anything(),
        0,
        null,
        'org.freedesktop.UPower',
        '/org/freedesktop/UPower/KbdBacklight',
        'org.freedesktop.UPower.KbdBacklight',
        null,
        expect.any(Function)
      );
    });

    it('should fetch max brightness after connection', async () => {
      await dbus.connect();

      expect(mockProxy.call).toHaveBeenCalledWith(
        'GetMaxBrightness',
        null,
        expect.anything(),
        -1,
        null,
        expect.any(Function)
      );
    });

    it('should subscribe to brightness changes', async () => {
      await dbus.connect();

      expect(mockProxy.connect).toHaveBeenCalledWith('g-properties-changed', expect.any(Function));
    });
  });

  describe('maxBrightness', () => {
    it('should return max brightness after connection', async () => {
      await dbus.connect();

      expect(dbus.maxBrightness).toBe(2);
    });

    it('should return null before connection', () => {
      expect(dbus.maxBrightness).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('should return true when max brightness is greater than 0', async () => {
      await dbus.connect();

      expect(dbus.isAvailable).toBe(true);
    });

    it('should return false when max brightness is 0', async () => {
      // Mock to return 0 for max brightness
      mockProxy.call.mockImplementationOnce(
        (method, params, flags, timeout, cancellable, callback) => {
          const mockResult = { deep_unpack: () => 0 };
          const mockSource = {
            call_finish: (result) => mockResult,
          };
          process.nextTick(() => callback(mockSource, mockResult));
        }
      );

      await dbus.connect();

      expect(dbus.isAvailable).toBe(false);
    });
  });

  describe('setBrightness()', () => {
    beforeEach(async () => {
      await dbus.connect();
      jest.clearAllMocks();
    });

    it('should set brightness via D-Bus', async () => {
      await dbus.setBrightness(1);

      expect(mockProxy.call).toHaveBeenCalledWith(
        'SetBrightness',
        expect.objectContaining({
          type: '(i)',
          value: [1],
        }),
        expect.anything(),
        -1,
        null,
        expect.any(Function)
      );
    });

    it('should clamp brightness to max value', async () => {
      await dbus.setBrightness(999);

      expect(mockProxy.call).toHaveBeenCalledWith(
        'SetBrightness',
        expect.objectContaining({
          value: [2], // Clamped to maxBrightness
        }),
        expect.anything(),
        -1,
        null,
        expect.any(Function)
      );
    });

    it('should clamp brightness to minimum of 0', async () => {
      // First set brightness to non-zero so the deduplication doesn't skip
      // Simulate signal emission to update internal state
      const changed = {
        lookup_value: jest.fn().mockReturnValue({
          get_int32: () => 1,
        }),
      };
      signalCallback(mockProxy, changed);

      // Now set to -5, which should clamp to 0
      await dbus.setBrightness(-5);

      // Find the SetBrightness call (not GetMaxBrightness or GetBrightness)
      const setBrightnessCall = mockProxy.call.mock.calls.find(
        (call) => call[0] === 'SetBrightness'
      );
      expect(setBrightnessCall).toBeDefined();
      expect(setBrightnessCall[1].value).toEqual([0]);
    });

    it('should skip D-Bus call if brightness has not changed', async () => {
      // Set initial brightness to 1
      await dbus.setBrightness(1);

      // Simulate signal emission to update internal state to 1
      const changed = {
        lookup_value: jest.fn().mockReturnValue({
          get_int32: () => 1,
        }),
      };
      signalCallback(mockProxy, changed);

      jest.clearAllMocks();

      // Try to set same brightness again
      await dbus.setBrightness(1);

      expect(mockProxy.call).not.toHaveBeenCalled();
    });

    it('should throw error if not connected', async () => {
      const newDbus = new KeyboardBacklightDbus();

      await expect(newDbus.setBrightness(1)).rejects.toThrow('D-Bus proxy not connected');
    });
  });

  describe('isEnabled', () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it('should return false when brightness is 0', () => {
      // Initial brightness is 0 from connection
      expect(dbus.isEnabled).toBe(false);
    });

    it('should return true when brightness is greater than 0', async () => {
      // Set brightness to 1
      await dbus.setBrightness(1);

      // Simulate property changed signal
      const propertyChangedCallback = mockProxy.connect.mock.calls[0][1];
      propertyChangedCallback(mockProxy, {
        lookup_value: (key) => {
          if (key === 'Brightness') {
            return {
              get_int32: () => 1,
            };
          }
          return null;
        },
      });

      expect(dbus.isEnabled).toBe(true);
    });
  });

  describe('destroy()', () => {
    it('should disconnect signal handler and clean up', async () => {
      await dbus.connect();

      dbus.destroy();

      expect(mockProxy.disconnect).toHaveBeenCalledWith(1);
      expect(dbus.maxBrightness).toBeNull();
    });
  });
});
