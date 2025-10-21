import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { BrightnessDbus } from '../lib/BrightnessDbus.js';
import Gio from 'gi://Gio';

describe('BrightnessDbus', () => {
  let dbus;

  beforeEach(() => {
    dbus = new BrightnessDbus();
  });

  afterEach(() => {
    if (dbus) {
      dbus.destroy();
    }
  });

  describe('constructor', () => {
    it('should initialize with null proxy', () => {
      expect(dbus._proxy).toBeNull();
    });
  });

  describe('connect', () => {
    it('should connect to D-Bus power service', async () => {
      await dbus.connect();

      expect(dbus._proxy).not.toBeNull();
    });

    it('should connect to correct D-Bus service and interface', async () => {
      await dbus.connect();

      expect(dbus._proxy._busName).toBe('org.gnome.SettingsDaemon.Power');
      expect(dbus._proxy._objectPath).toBe('/org/gnome/SettingsDaemon/Power');
    });
  });

  describe('getCurrentBrightness', () => {
    it('should return null when not connected', () => {
      const brightness = dbus.brightness;
      expect(brightness).toBeNull();
    });

    it('should return current brightness after connection', async () => {
      await dbus.connect();

      // Mock the Brightness property using Object.defineProperty
      Object.defineProperty(dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });

      const brightness = dbus.brightness;
      expect(brightness).toBe(50);
    });

    it('should return null when brightness property not available', async () => {
      await dbus.connect();

      // Mock property as undefined
      Object.defineProperty(dbus._proxy, 'Brightness', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const brightness = dbus.brightness;
      expect(brightness).toBeNull();
    });
  });

  describe('setBrightness', () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it('should set brightness via D-Bus', () => {
      const mockValues = [];
      Object.defineProperty(dbus._proxy, 'Brightness', {
        get: () => 50,
        set: (v) => mockValues.push(v),
        configurable: true,
      });

      dbus.brightness = 75;
      expect(mockValues).toContain(75);
    });

    it('should clamp brightness to 0-100 range', () => {
      const mockValues = [];
      Object.defineProperty(dbus._proxy, 'Brightness', {
        get: () => 50,
        set: (v) => mockValues.push(v),
        configurable: true,
      });

      dbus.brightness = 150;
      expect(mockValues[0]).toBe(100);

      dbus.brightness = -10;
      expect(mockValues[1]).toBe(0);
    });

    it('should round fractional brightness values', () => {
      const mockValues = [];
      Object.defineProperty(dbus._proxy, 'Brightness', {
        get: () => 50,
        set: (v) => mockValues.push(v),
        configurable: true,
      });

      dbus.brightness = 75.7;
      expect(mockValues[0]).toBe(76);
    });

    it('should not throw when not connected (error is caught and logged)', () => {
      dbus.destroy();

      // Should not throw - try-catch catches the error
      expect(() => {
        dbus.brightness = 50;
      }).not.toThrow();
    });
  });

  describe('onBrightnessChanged', () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it('should call callback when brightness changes', () => {
      const callback = jest.fn();
      const signalId = dbus.onChanged(callback);

      expect(signalId).not.toBeNull();

      // Simulate brightness change
      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'Brightness') {
            return { get_int32: () => 60 };
          }
          return null;
        },
      };

      dbus._proxy.emit('g-properties-changed', mockChanged, {});

      expect(callback).toHaveBeenCalledWith(60);
    });

    it('should not call callback for other property changes', () => {
      const callback = jest.fn();
      dbus.onChanged(callback);

      // Simulate other property change
      const mockChanged = {
        lookup_value: (key) => null,
      };

      dbus._proxy.emit('g-properties-changed', mockChanged, {});

      expect(callback).not.toHaveBeenCalled();
    });

    it('should throw error when not connected', () => {
      dbus.destroy();

      // Will throw because _proxy is null
      expect(() => dbus.onChanged(() => {})).toThrow();
    });
  });

  describe('disconnect', () => {
    beforeEach(async () => {
      await dbus.connect();
    });

    it('should disconnect signal handler', () => {
      const callback = jest.fn();
      const signalId = dbus.onChanged(callback);

      dbus.disconnect(signalId);

      // Simulate brightness change after disconnect
      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'Brightness') {
            return { get_int32: () => 60 };
          }
          return null;
        },
      };

      dbus._proxy.emit('g-properties-changed', mockChanged, {});

      // Callback should not have been called since signal was disconnected
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', () => {
      dbus.destroy();
      expect(() => dbus.disconnect(123)).not.toThrow();
    });

    it('should handle disconnect with null signalId', () => {
      expect(() => dbus.disconnect(null)).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should clear proxy reference', async () => {
      await dbus.connect();
      expect(dbus._proxy).not.toBeNull();

      dbus.destroy();
      expect(dbus._proxy).toBeNull();
    });

    it('should handle destroy when not connected', () => {
      expect(() => dbus.destroy()).not.toThrow();
    });

    it('should handle multiple destroy calls', async () => {
      await dbus.connect();
      dbus.destroy();
      expect(() => dbus.destroy()).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete lifecycle', async () => {
      // Connect
      await dbus.connect();

      // Get brightness
      Object.defineProperty(dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });
      expect(dbus.brightness).toBe(50);

      // Set brightness
      const mockValues = [];
      Object.defineProperty(dbus._proxy, 'Brightness', {
        get: () => 50,
        set: (v) => mockValues.push(v),
        configurable: true,
      });
      dbus.brightness = 75;
      expect(mockValues).toContain(75);

      // Subscribe to changes
      const callback = jest.fn();
      const signalId = dbus.onChanged(callback);

      // Simulate change
      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'Brightness') {
            return { get_int32: () => 80 };
          }
          return null;
        },
      };
      dbus._proxy.emit('g-properties-changed', mockChanged, {});
      expect(callback).toHaveBeenCalledWith(80);

      // Disconnect
      dbus.disconnect(signalId);

      // Destroy
      dbus.destroy();
    });
  });
});
