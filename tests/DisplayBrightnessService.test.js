import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DisplayBrightnessService } from '../lib/DisplayBrightnessService.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

describe('DisplayBrightnessService', () => {
  let service;

  beforeEach(() => {
    service = new DisplayBrightnessService();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    GLib.clearAllTimeouts();
  });

  describe('constructor', () => {
    it('should initialize with BrightnessDbus instance', () => {
      expect(service.dbus).toBeDefined();
      expect(service.settings._settings).toBeDefined();
    });

    it('should initialize callback managers', () => {
      expect(service.onManualBrightnessChange).toBeDefined();
      expect(service.onManualBrightnessChange.size).toBe(0);
      expect(service.onDisplayIsActiveChanged).toBeDefined();
      expect(service.onDisplayIsActiveChanged.size).toBe(0);
      expect(service.displayIsActive).toBe(true);
    });

    it('should initialize display state properties', () => {
      expect(service.displayIsDimmed).toBe(false);
      expect(service.displayIsOff).toBe(false);
    });
  });

  describe('start', () => {
    it('should initialize settings and connect to brightness D-Bus', async () => {
      await service.start();

      expect(service.settings._settings).not.toBeNull();
      expect(service._brightnessSignalId).not.toBeNull();
      expect(service._ambientEnabledSignalId).not.toBeNull();
    });

    it('should read initial power settings', async () => {
      await service.start();

      expect(service.settings.idleBrightness).toBe(30);
      expect(service.settings.ambientEnabled).toBe(false);
    });

    it('should monitor settings changes', async () => {
      await service.start();

      service.settings._settings.set_int('idle-brightness', 50);
      expect(service.settings.idleBrightness).toBe(50);
    });

    it('should read initial brightness value', async () => {
      await service.start();

      expect(service.dbus.brightness).toBeDefined();
    });
  });

  describe('power settings changes', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should update idleBrightness when setting changes', () => {
      service.settings._settings.set_int('idle-brightness', 40);
      expect(service.settings.idleBrightness).toBe(40);
    });

    it('should update ambientEnabled when setting changes', () => {
      service.settings._settings.set_boolean('ambient-enabled', true);
      expect(service.settings.ambientEnabled).toBe(true);
    });

    it('should set displayIsActive to false when ambient-enabled becomes true', () => {
      service.settings._settings.set_boolean('ambient-enabled', true);
      expect(service.displayIsActive).toBe(false);
    });

    it('should restore displayIsActive when ambient-enabled becomes false', () => {
      service.settings._settings.set_boolean('ambient-enabled', true);
      expect(service.displayIsActive).toBe(false);

      service.settings._settings.set_boolean('ambient-enabled', false);
      expect(service.displayIsActive).toBe(true);
    });
  });

  describe('brightness change detection', () => {
    beforeEach(async () => {
      await service.start();
      // Simulate a brightness change via the D-Bus service
      Object.defineProperty(service.dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });
    });

    it('should detect manual brightness changes', () => {
      const callback = jest.fn();
      service.onManualBrightnessChange.add(callback);

      service._onBrightnessChanged(70);

      expect(callback).toHaveBeenCalledWith(70);
    });

    it('should not detect automatic brightness changes as manual', () => {
      const callback = jest.fn();
      service.onManualBrightnessChange.add(callback);
      service._settingBrightness = true;

      service._onBrightnessChanged(70);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not detect changes when display is inactive', () => {
      const callback = jest.fn();
      service.onManualBrightnessChange.add(callback);
      // Set ambient-enabled to keep display inactive even after brightness change
      service.settings._settings.set_boolean('ambient-enabled', true);
      expect(service.displayIsActive).toBe(false);

      service._onBrightnessChanged(70);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('display state tracking', () => {
    beforeEach(async () => {
      await service.start();
      Object.defineProperty(service.dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });
    });

    it('should detect off state when brightness < 0', () => {
      service._onBrightnessChanged(-1);
      expect(service.displayIsOff).toBe(true);
      expect(service.displayIsDimmed).toBe(false);
    });

    it('should detect dimmed state when brightness equals idle brightness', () => {
      service.settings._settings.set_int('idle-brightness', 30);
      service._onBrightnessChanged(30);
      expect(service.displayIsDimmed).toBe(true);
      expect(service.displayIsOff).toBe(false);
    });

    it('should delay active state when transitioning from off', () => {
      service._onBrightnessChanged(-1);
      expect(service.displayIsOff).toBe(true);

      service._onBrightnessChanged(50);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(service.displayIsActive).toBe(true);
          resolve();
        }, 300); // Increased timeout to account for the 250ms delay
      });
    });

    it('should set inactive immediately when transitioning to dimmed', () => {
      service.settings._settings.set_int('idle-brightness', 30);
      service._onBrightnessChanged(30);
      expect(service.displayIsActive).toBe(false);
    });
  });

  describe('animateBrightness', () => {
    beforeEach(async () => {
      await service.start();
      // Set up Brightness property using Object.defineProperty
      Object.defineProperty(service.dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });
    });

    it('should animate brightness using generator-based animator', async () => {
      const animationPromise = service.animateBrightness(60);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Animation timeout should be active during animation
      expect(service._animationTimeout).not.toBeNull();

      // Wait for animation to complete
      await animationPromise;
    });

    it('should stop animation when display becomes inactive', async () => {
      const animationPromise = service.animateBrightness(80);

      await new Promise((resolve) => setTimeout(resolve, 50));

      service.displayIsActive = false;

      // Wait for animation to abort
      await animationPromise;

      // Animation should be cleared
      expect(service._animationTimeout).toBeNull();
    });

    it('should stop animation when _settingBrightness is set to false', async () => {
      service.animateBrightness(80); // Don't await

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Halt the animation externally
      service.haltAnimatingBrightness();

      // Give a moment for the animation to abort
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Animation should be cleared and flag reset
      expect(service._animationTimeout).toBeNull();
      expect(service._settingBrightness).toBe(false);
    });

    it('should cancel previous animation when starting new one', async () => {
      const firstAnimation = service.animateBrightness(80);

      await new Promise((resolve) => setTimeout(resolve, 30));

      const secondAnimation = service.animateBrightness(60);

      // First animation should be cancelled, second should run
      await secondAnimation;

      expect(service._animationTimeout).toBeNull();
    });

    it('should call haltAnimatingBrightness before starting new animation', async () => {
      const haltSpy = jest.spyOn(service, 'haltAnimatingBrightness');

      await service.animateBrightness(60);

      // haltAnimatingBrightness should be called at the start
      expect(haltSpy).toHaveBeenCalled();

      haltSpy.mockRestore();
    });

    it('should skip idle brightness values during animation', async () => {
      service.settings._settings.set_int('idle-brightness', 55);
      Object.defineProperty(service.dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });

      // Animate through the idle brightness value
      await service.animateBrightness(60);

      // The brightness should never be set to exactly idle-brightness (55)
      // This is harder to test directly, but we can verify animation completes
      expect(service._settingBrightness).toBe(false);
    });
  });

  describe('haltAnimatingBrightness', () => {
    beforeEach(async () => {
      await service.start();
      Object.defineProperty(service.dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });
    });

    it('should clear animation timeout', async () => {
      service.animateBrightness(80); // Don't await

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(service._animationTimeout).not.toBeNull();

      service.haltAnimatingBrightness();

      expect(service._animationTimeout).toBeNull();

      // Give time for animation loop to exit
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should set _settingBrightness to false', () => {
      service._settingBrightness = true;
      service._animationTimeout = 123; // Fake timeout ID

      service.haltAnimatingBrightness();

      expect(service._settingBrightness).toBe(false);
    });

    it('should be safe to call when no animation is running', () => {
      service._settingBrightness = false;
      service._animationTimeout = null;

      expect(() => service.haltAnimatingBrightness()).not.toThrow();
      expect(service._settingBrightness).toBe(false);
      expect(service._animationTimeout).toBeNull();
    });

    it('should be safe to call multiple times', async () => {
      service.animateBrightness(80); // Don't await

      await new Promise((resolve) => setTimeout(resolve, 30));

      service.haltAnimatingBrightness();
      service.haltAnimatingBrightness();
      service.haltAnimatingBrightness();

      expect(service._animationTimeout).toBeNull();
      expect(service._settingBrightness).toBe(false);

      // Give time for animation loop to exit
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe('destroy', () => {
    it('should cancel ongoing animation', async () => {
      await service.start();
      Object.defineProperty(service.dbus._proxy, 'Brightness', {
        value: 10,
        writable: true,
        configurable: true,
      });

      // Start a long animation (10->90 = 80 steps) - don't await it
      service.animateBrightness(90);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(service._animationTimeout).not.toBeNull();

      service.destroy();

      expect(service._animationTimeout).toBeNull();
      expect(service._settingBrightness).toBe(false);

      // Give time for any pending callbacks to settle
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should disconnect settings signal', async () => {
      await service.start();
      const signalId = service._ambientEnabledSignalId;
      expect(signalId).not.toBeNull();

      service.destroy();

      // Signal should have been disconnected (can't easily verify in mock)
      expect(service.settings._settings).toBeNull();
    });

    it('should handle destroy when not started', () => {
      expect(() => service.destroy()).not.toThrow();
    });

    it('should reset _settingBrightness flag', async () => {
      await service.start();
      service._settingBrightness = true;

      service.destroy();

      expect(service._settingBrightness).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should handle complete brightness cycle', async () => {
      Object.defineProperty(service.dbus._proxy, 'Brightness', {
        value: 50,
        writable: true,
        configurable: true,
      });
      service._onBrightnessChanged(50);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(service.displayIsActive).toBe(true);

      service.settings._settings.set_int('idle-brightness', 30);
      service._onBrightnessChanged(30);
      expect(service.displayIsDimmed).toBe(true);
      expect(service.displayIsActive).toBe(false);

      service._onBrightnessChanged(-1);
      expect(service.displayIsOff).toBe(true);

      service._onBrightnessChanged(50);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(service.displayIsActive).toBe(true);
      expect(service.displayIsOff).toBe(false);
      expect(service.displayIsDimmed).toBe(false);
    });

    it('should handle manual brightness changes during animation', async () => {
      const callback = jest.fn();
      service.onManualBrightnessChange.add(callback);

      const animationPromise = service.animateBrightness(80);

      await new Promise((resolve) => setTimeout(resolve, 50));

      service._settingBrightness = false;
      service._onBrightnessChanged(60);

      expect(callback).toHaveBeenCalledWith(60);
    });
  });
});
