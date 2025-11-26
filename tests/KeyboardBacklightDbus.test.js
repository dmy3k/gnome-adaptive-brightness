/**
 * Tests for KeyboardBacklightDbus
 * Tests the low-level D-Bus interface for keyboard backlight control
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock proxy instance with properties from GNOME Settings Daemon Power.Keyboard interface
const mockProxy = {
  Steps: 3, // Default: Off, Low, High
  Brightness: 0, // Default: Off
};

// Mock the makeProxyWrapper to return a constructor function
let mockProxyConstructor;
const mockMakeProxyWrapper = jest.fn((xml) => {
  mockProxyConstructor = jest.fn((bus, busName, objectPath, callback) => {
    process.nextTick(() => callback(mockProxy, null));
  });
  return mockProxyConstructor;
});

const mockGio = {
  DBus: {
    session: {},
  },
  DBusProxy: {
    makeProxyWrapper: mockMakeProxyWrapper,
  },
};

jest.unstable_mockModule('gi://Gio', () => ({ default: mockGio }));

const { KeyboardBacklightDbus } = await import('../lib/KeyboardBacklightDbus.js');

describe('KeyboardBacklightDbus', () => {
  let dbus;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock proxy to defaults
    mockProxy.Steps = 3; // Off, Low, High
    mockProxy.Brightness = 0;

    dbus = new KeyboardBacklightDbus();
  });

  describe('connect()', () => {
    it('should connect to GNOME Settings Daemon keyboard backlight service', async () => {
      await dbus.connect();

      expect(mockProxyConstructor).toHaveBeenCalledWith(
        mockGio.DBus.session,
        'org.gnome.SettingsDaemon.Power',
        '/org/gnome/SettingsDaemon/Power',
        expect.any(Function)
      );
    });

    it('should store the proxy reference after connection', async () => {
      await dbus.connect();

      expect(dbus._proxy).toBe(mockProxy);
    });
  });

  describe('Steps', () => {
    it('should return Steps property from proxy', async () => {
      await dbus.connect();

      expect(dbus.Steps).toBe(3);
    });

    it('should return 1 when proxy is not connected', () => {
      expect(dbus.Steps).toBe(1);
    });

    it('should return 1 when proxy has no Steps', async () => {
      mockProxy.Steps = undefined;
      await dbus.connect();

      expect(dbus.Steps).toBe(1);
    });
  });

  describe('BrightnessLevel setter', () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it('should warn and return early if Steps < 2', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockProxy.Steps = 1;

      dbus.BrightnessLevel = 5;

      expect(consoleWarnSpy).toHaveBeenCalledWith('Keyboard backlight not available');
      expect(mockProxy.Brightness).toBe(0); // Unchanged

      consoleWarnSpy.mockRestore();
    });

    it('should set brightness to 0 for level 0', () => {
      mockProxy.Steps = 3; // 3 steps: off, low, high

      dbus.BrightnessLevel = 0;

      expect(mockProxy.Brightness).toBe(0);
    });

    it('should set brightness to 50 for level 1 with 3 steps', () => {
      mockProxy.Steps = 3; // 3 steps: (3-1)=2 active levels -> 100/2 = 50 per level

      dbus.BrightnessLevel = 1;

      expect(mockProxy.Brightness).toBe(50);
    });

    it('should set brightness to 100 for level 2 with 3 steps', () => {
      mockProxy.Steps = 3; // 3 steps: (3-1)=2 active levels

      dbus.BrightnessLevel = 2;

      expect(mockProxy.Brightness).toBe(100);
    });

    it('should calculate brightness for 2-step devices (on/off only)', () => {
      mockProxy.Steps = 2; // 2 steps: off, on -> (2-1)=1 active level

      dbus.BrightnessLevel = 1;

      expect(mockProxy.Brightness).toBe(100); // 100 / 1 * 1 = 100
    });

    it('should calculate brightness for multi-step devices', () => {
      mockProxy.Steps = 5; // 5 steps: (5-1)=4 active levels -> 25 per level

      dbus.BrightnessLevel = 2;

      expect(mockProxy.Brightness).toBe(50); // 100 / 4 * 2 = 50
    });

    it('should round fractional brightness values', () => {
      mockProxy.Steps = 4; // 4 steps: (4-1)=3 active levels -> 33.33 per level

      dbus.BrightnessLevel = 1;

      expect(mockProxy.Brightness).toBe(33); // Math.round(100 / 3 * 1) = 33
    });

    it('should clamp brightness to minimum of 0', () => {
      mockProxy.Steps = 3;

      dbus.BrightnessLevel = 0;
      const value = Math.round(100 / (mockProxy.Steps - 1) * 0);
      const clamped = Math.max(0, Math.min(100, value));

      expect(mockProxy.Brightness).toBe(clamped);
    });

    it('should clamp brightness to maximum of 100', () => {
      mockProxy.Steps = 3;

      dbus.BrightnessLevel = 10; // Way over max
      const value = Math.round(100 / (mockProxy.Steps - 1) * 10);
      const clamped = Math.max(0, Math.min(100, value));

      expect(mockProxy.Brightness).toBe(clamped);
    });
  });

  describe('destroy()', () => {
    it('should clear proxy reference', async () => {
      await dbus.connect();

      dbus.destroy();

      expect(dbus._proxy).toBeNull();
    });

    it('should handle destroy before connection', () => {
      expect(() => dbus.destroy()).not.toThrow();
    });

    it('should handle multiple destroy calls', async () => {
      await dbus.connect();
      dbus.destroy();

      expect(() => dbus.destroy()).not.toThrow();
    });
  });
});
