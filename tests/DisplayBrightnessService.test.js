import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DisplayBrightnessService } from '../lib/DisplayBrightnessService.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';

describe('DisplayBrightnessService', () => {
  let service;

  beforeEach(() => {
    // Reset Main.brightnessManager to enabled state
    Main.resetBrightnessManager(true);
    service = new DisplayBrightnessService();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    GLib.clearAllTimeouts();
  });

  describe('constructor', () => {
    it('should initialize with backend instance (BrightnessManager for GNOME 49)', () => {
      expect(service.backend).toBeDefined();
      expect(service._powerSettings).toBeDefined();
    });

    it('should initialize callback managers', () => {
      expect(service.onDisplayIsActiveChanged).toBeDefined();
      expect(service.onDisplayIsActiveChanged.size).toBe(0);
      expect(service.onAmbientEnabledChanged).toBeDefined();
      expect(service.onAmbientEnabledChanged.size).toBe(0);
      expect(service.displayIsActive).toBe(true);
    });

    it('should initialize display state properties', () => {
      expect(service.displayIsDimmed).toBe(false);
      expect(service.displayIsOff).toBe(false);
    });
  });

  describe('start', () => {
    it('should connect to BrightnessManager and set up signals', async () => {
      await service.start();

      expect(service._powerSettings).not.toBeNull();
      expect(service._ambientEnabledSignalId).not.toBeNull();
    });

    it('should read initial ambient-enabled setting', async () => {
      await service.start();

      expect(service.isGSDambientEnabled).toBe(false);
    });

    it('should read initial brightness value', async () => {
      await service.start();

      expect(service.backend.brightness).toBeDefined();
    });
  });

  describe('ambient-enabled setting changes', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should update isGSDambientEnabled when setting changes', () => {
      service._powerSettings.set_boolean('ambient-enabled', true);
      expect(service.isGSDambientEnabled).toBe(true);
    });

    it('should set displayIsActive to false when ambient-enabled becomes true', async () => {
      expect(service.displayIsActive).toBe(true);

      service._powerSettings.set_boolean('ambient-enabled', true);

      // Trigger brightness change to update display active state
      service._onBrightnessChanged(0.6);

      // Wait a tick for the signal to propagate
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(service.displayIsActive).toBe(false);
    });

    it('should restore displayIsActive when ambient-enabled becomes false', async () => {
      service._powerSettings.set_boolean('ambient-enabled', true);
      service._onBrightnessChanged(0.6);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(service.displayIsActive).toBe(false);

      service._powerSettings.set_boolean('ambient-enabled', false);
      service._onBrightnessChanged(0.7);
      // Need to wait for the 250ms delay when transitioning from inactive to active
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(service.displayIsActive).toBe(true);
    });
  });

  describe('display state tracking', () => {
    beforeEach(async () => {
      await service.start();
      Main.brightnessManager.globalScale.value = 0.5;
    });

    it('should detect off state when display hardware is unavailable', () => {
      // Simulate display being turned off (GNOME 49 behavior)
      Main.brightnessManager.setDisplayOff(true);
      service._onBrightnessChanged(null);

      expect(service.displayIsOff).toBe(true);
      expect(service.displayIsDimmed).toBe(false);
    });

    it('should detect dimmed state via backend.isDimming', () => {
      // Enable dimming in BrightnessManager
      Main.brightnessManager.dimming = true;

      // Trigger brightness change to update dimmed state
      service._onBrightnessChanged(0.3);

      expect(service.displayIsDimmed).toBe(true);
      expect(service.displayIsOff).toBe(false);
    });

    it('should set inactive immediately when transitioning to dimmed', () => {
      Main.brightnessManager.dimming = true;
      service._onBrightnessChanged(0.3);
      expect(service.displayIsActive).toBe(false);
    });
  });

  describe('animateBrightness', () => {
    beforeEach(async () => {
      await service.start();
      // Set initial brightness via BrightnessManager
      Main.brightnessManager.globalScale.value = 0.5;
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
  });

  describe('haltAnimatingBrightness', () => {
    beforeEach(async () => {
      await service.start();
      Main.brightnessManager.globalScale.value = 0.5;
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
      Main.brightnessManager.globalScale.value = 0.1;

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

      // Signal should have been disconnected and settings cleared
      expect(service._powerSettings).toBeNull();
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
      Main.brightnessManager.globalScale.value = 0.5;
      service._onBrightnessChanged(0.5);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(service.displayIsActive).toBe(true);

      // Simulate dimming
      Main.brightnessManager.dimming = true;
      service._onBrightnessChanged(0.3);
      expect(service.displayIsDimmed).toBe(true);
      expect(service.displayIsActive).toBe(false);

      // Simulate display off (GNOME 49 behavior)
      Main.brightnessManager.setDisplayOff(true);
      service._onBrightnessChanged(null);
      expect(service.displayIsOff).toBe(true);

      // Display back on
      Main.brightnessManager.setDisplayOff(false);
      Main.brightnessManager.dimming = false;
      service._onBrightnessChanged(0.5);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(service.displayIsActive).toBe(true);
      expect(service.displayIsOff).toBe(false);
      expect(service.displayIsDimmed).toBe(false);
    });
  });
});
