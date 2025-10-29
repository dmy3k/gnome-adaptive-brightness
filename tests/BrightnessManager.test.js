import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { BrightnessManager } from '../lib/BrightnessManager.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

describe('BrightnessManager', () => {
  let manager;

  beforeEach(() => {
    Main.resetBrightnessManager(true);
    manager = new BrightnessManager();
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
    }
  });

  describe('constructor', () => {
    it('should create instance with GNOME Shell BrightnessManager', () => {
      expect(manager).toBeDefined();
      expect(manager._manager).toBeDefined();
      expect(manager._manager).toBe(Main.brightnessManager);
    });

    it('should initialize with brightness callback manager', () => {
      expect(manager.onBrightnessChange).toBeDefined();
      expect(manager.onBrightnessChange.size).toBe(0);
    });
  });

  describe('connect', () => {
    it('should connect synchronously without returning a promise', () => {
      const result = manager.connect();

      expect(result).toBeUndefined();
      expect(manager._changedSignalId).toBeDefined();
    });

    it('should setup brightness change callback', () => {
      manager.connect();

      expect(manager._changedSignalId).toBeDefined();
      expect(typeof manager._changedSignalId).toBe('number');
    });

    it('should allow multiple connect calls without error', () => {
      manager.connect();
      const firstId = manager._changedSignalId;

      manager.connect();
      const secondId = manager._changedSignalId;

      expect(firstId).toBeDefined();
      expect(secondId).toBeDefined();
    });

    it('should setup globalScale listener when changed signal is emitted', () => {
      manager.connect();

      // Trigger the 'changed' signal which should set up globalScale listener
      Main.brightnessManager.emit('changed');

      expect(manager._globalScaleSignalId).toBeDefined();
      expect(typeof manager._globalScaleSignalId).toBe('number');
    });
  });

  describe('brightness getter', () => {
    beforeEach(() => {
      manager.connect();
    });

    it('should return autoBrightnessTarget value', () => {
      Main.brightnessManager.globalScale.value = 0.5;
      Main.brightnessManager.autoBrightnessTarget = 0.6;

      expect(manager.brightness).toBe(0.6);
    });

    it('should return autoBrightnessTarget when it is active', () => {
      Main.brightnessManager.globalScale.value = 0.3;
      Main.brightnessManager.autoBrightnessTarget = 0.7;

      expect(manager.brightness).toBe(0.7);
    });

    it('should handle minimum brightness', () => {
      Main.brightnessManager.autoBrightnessTarget = 0.0;

      expect(manager.brightness).toBe(0.0);
    });

    it('should handle maximum brightness', () => {
      Main.brightnessManager.autoBrightnessTarget = 1.0;

      expect(manager.brightness).toBe(1.0);
    });

    it('should return null when globalScale is not available', () => {
      Main.brightnessManager.setDisplayOff(true); // This makes globalScale null

      expect(manager.brightness).toBeNull();
    });
  });

  describe('brightness setter', () => {
    beforeEach(() => {
      manager.connect();
    });

    it('should set brightness in 0.0-1.0 range', () => {
      manager.brightness = 0.7;

      expect(Main.brightnessManager.autoBrightnessTarget).toBe(0.7);
      expect(manager.brightness).toBe(0.7);
    });

    it('should handle minimum brightness', () => {
      manager.brightness = 0.0;

      expect(Main.brightnessManager.autoBrightnessTarget).toBe(0.0);
      expect(manager.brightness).toBe(0.0);
    });

    it('should handle maximum brightness', () => {
      manager.brightness = 1.0;

      expect(Main.brightnessManager.autoBrightnessTarget).toBe(1.0);
      expect(manager.brightness).toBe(1.0);
    });

    it('should clamp values outside 0.0-1.0 range', () => {
      manager.brightness = 1.5;
      expect(Main.brightnessManager.autoBrightnessTarget).toBe(1.0);

      manager.brightness = -0.5;
      expect(Main.brightnessManager.autoBrightnessTarget).toBe(0.0);
    });
  });

  describe('brightness change callbacks', () => {
    beforeEach(() => {
      manager.connect();
    });

    it('should invoke callback when brightness changes via monitor scale backlights-changed', () => {
      const callback = jest.fn();
      manager.onBrightnessChange.add(callback);

      // Trigger monitor change to set up listeners
      Main.brightnessManager.emit('changed');

      // Simulate autoBrightnessTarget change (e.g., from dimming or system adjustment)
      Main.brightnessManager.autoBrightnessTarget = 0.6;

      // Trigger backlights-changed on first monitor scale
      const firstScale = Main.brightnessManager.scales[0];
      firstScale._callbacks.forEach(({ callback: cb }) => cb());

      expect(callback).toHaveBeenCalledWith(0.6);
    });

    it('should invoke callback when autoBrightnessTarget changes', () => {
      const callback = jest.fn();
      manager.onBrightnessChange.add(callback);

      // Set autoBrightnessTarget which should trigger backlights-changed
      Main.brightnessManager.autoBrightnessTarget = 0.8;

      // Trigger backlights-changed on monitor scales
      const firstScale = Main.brightnessManager.scales[0];
      firstScale._callbacks.forEach(({ callback: cb }) => cb());

      expect(callback).toHaveBeenCalledWith(0.8);
    });

    it('should support multiple callbacks', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      manager.onBrightnessChange.add(callback1);
      manager.onBrightnessChange.add(callback2);

      Main.brightnessManager.autoBrightnessTarget = 0.9;

      // Trigger backlights-changed
      const firstScale = Main.brightnessManager.scales[0];
      firstScale._callbacks.forEach(({ callback: cb }) => cb());

      expect(callback1).toHaveBeenCalledWith(0.9);
      expect(callback2).toHaveBeenCalledWith(0.9);
    });

    it('should not invoke removed callbacks', () => {
      const callback = jest.fn();
      const id = manager.onBrightnessChange.add(callback);
      manager.onBrightnessChange.remove(id);

      Main.brightnessManager.globalScale.value = 0.8;
      Main.brightnessManager.emit('changed');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should remove brightness change callback', () => {
      manager.connect();
      const signalId = manager._changedSignalId;

      manager.destroy();

      expect(manager._manager).toBeNull();
      expect(manager._changedSignalId).toBeNull();
    });

    it('should remove globalScale and monitor scale listeners if they were set up', () => {
      manager.connect();
      Main.brightnessManager.emit('changed'); // Set up listeners

      expect(manager._globalScaleSignalId).not.toBeNull();
      expect(manager._monitorScaleSignalIds.length).toBeGreaterThan(0);

      manager.destroy();

      expect(manager._globalScaleSignalId).toBeNull();
      expect(manager._monitorScaleSignalIds.length).toBe(0);
    });

    it('should clear brightness callback manager', () => {
      manager.connect();
      const callback = jest.fn();
      manager.onBrightnessChange.add(callback);

      manager.destroy();

      expect(manager.onBrightnessChange.size).toBe(0);
    });

    it('should release brightness control', () => {
      manager.connect();
      manager.brightness = 0.5;
      expect(Main.brightnessManager.autoBrightnessTarget).toBe(0.5);

      manager.destroy();

      expect(Main.brightnessManager.autoBrightnessTarget).toBe(-1.0);
    });

    it('should handle destroy when not connected', () => {
      expect(() => manager.destroy()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      manager.connect();

      manager.destroy();
      manager.destroy();

      expect(manager._manager).toBeNull();
    });
  });
});
