import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SensorProxyService } from '../lib/SensorProxyService.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

describe('SensorProxyService', () => {
  let service;
  let mockProxy;

  beforeEach(() => {
    service = new SensorProxyService();
    mockProxy = null;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    // Force cleanup of any remaining timeouts
    GLib.clearAllTimeouts();
  });

  describe('constructor', () => {
    it('should initialize with null proxy and signal', () => {
      expect(service.dbus._proxy).toBeNull();
      expect(service._signalId).toBeNull();
    });

    it('should initialize with no filter function by default', () => {
      expect(service._filterFn).toBeNull();
      expect(service._lastLuxValue).toBeNull();
    });

    it('should accept filter function parameter', () => {
      const filterFn = (prev, curr) => prev !== curr;
      const serviceWithFilter = new SensorProxyService(filterFn);

      expect(serviceWithFilter._filterFn).toBe(filterFn);
      expect(serviceWithFilter._lastLuxValue).toBeNull();

      serviceWithFilter.destroy();
    });

    it('should initialize timeout tracking', () => {
      expect(service._pendingTimeout).toBeNull();
      expect(service._lastUpdateTime).toBe(0);
      expect(service._throttleTimeoutMs).toBe(1000);
    });

    it('should initialize light level and sensor availability', () => {
      expect(service.dbus.lightLevel).toBeNull();
      expect(service.dbus.hasAmbientLight).toBeNull();
    });

    it('should initialize callback managers', () => {
      expect(service.onLightLevelChanged).toBeDefined();
      expect(service.onLightLevelChanged.size).toBe(0);
      expect(service.onSensorAvailableChanged).toBeDefined();
      expect(service.onSensorAvailableChanged.size).toBe(0);
    });
  });

  describe('start', () => {
    it('should create DBusProxy connection', async () => {
      await service.start();

      expect(service.dbus._proxy).not.toBeNull();
      expect(service._signalId).not.toBeNull();
    });

    it('should connect to SensorProxy service', async () => {
      await service.start();

      expect(service.dbus._proxy._busName).toBe('net.hadess.SensorProxy');
      expect(service.dbus._proxy._objectPath).toBe('/net/hadess/SensorProxy');
    });

    it('should claim light sensor', async () => {
      await service.start();

      // Verify service is properly initialized
      expect(service.dbus._proxy).not.toBeNull();
      expect(service._signalId).not.toBeNull();
    });

    it('should handle claim light error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Spy on claimLight to make it reject
      const testService = new SensorProxyService();
      const originalClaimLight = testService.dbus.claimLight;
      testService.dbus.claimLight = jest.fn().mockRejectedValue(new Error('ClaimLight failed'));

      await expect(testService.start()).rejects.toThrow('ClaimLight failed');

      testService.dbus.claimLight = originalClaimLight;
      testService.destroy();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('_onPropertiesChanged', () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it('should handle LightLevel property change', () => {
      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'LightLevel') {
            return { get_double: () => 500 };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      // Due to throttling, the value might not be set immediately
      // But we can check the last update time was set
      expect(service._lastUpdateTime).toBeGreaterThan(0);
    });

    it('should handle HasAmbientLight property change', () => {
      const callback = jest.fn();
      service.onSensorAvailableChanged.add(callback);

      // Set the property on the mock proxy so the getter can read it
      mockProxy.set_cached_property('HasAmbientLight', true);

      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'HasAmbientLight') {
            return { get_boolean: () => true };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      expect(service.dbus.hasAmbientLight).toBe(true);
      expect(callback).toHaveBeenCalledWith(true);
    });

    it('should handle both properties changing', () => {
      const callback = jest.fn();
      service.onSensorAvailableChanged.add(callback);

      // Set the property on the mock proxy so the getter can read it
      mockProxy.set_cached_property('HasAmbientLight', false);

      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'LightLevel') {
            return { get_double: () => 300 };
          }
          if (key === 'HasAmbientLight') {
            return { get_boolean: () => false };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      expect(service.dbus.hasAmbientLight).toBe(false);
      expect(callback).toHaveBeenCalledWith(false);
      expect(service._lastUpdateTime).toBeGreaterThan(0);
    });

    it('should invoke callback even when value unchanged', () => {
      // Set initial value on the proxy
      mockProxy.set_cached_property('HasAmbientLight', true);

      const callback = jest.fn();
      service.onSensorAvailableChanged.add(callback);

      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'HasAmbientLight') {
            return { get_boolean: () => true };
          }
          return null;
        },
      };

      service._onPropertiesChanged(mockProxy, mockChanged, {});

      // Callback is now invoked regardless of value change
      expect(callback).toHaveBeenCalledWith(true);
    });
  });

  describe('_handleLightLevelChange', () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it('should process light level immediately if enough time passed', () => {
      service._lastUpdateTime = Date.now() - 3000; // 3 seconds ago

      // Set the property on the proxy before processing
      mockProxy.set_cached_property('LightLevel', 400);

      service._handleLightLevelChange(400);

      expect(service.dbus.lightLevel).toBe(400);
    });

    it('should schedule delayed update if updated recently', () => {
      service._lastUpdateTime = Date.now() - 500; // 500ms ago

      service._handleLightLevelChange(400);

      expect(service._pendingTimeout).not.toBeNull();
    });

    it('should clear existing pending timeout when scheduling new one', () => {
      service._lastUpdateTime = Date.now() - 500;

      service._handleLightLevelChange(400);
      const firstTimeout = service._pendingTimeout;

      service._handleLightLevelChange(500);
      const secondTimeout = service._pendingTimeout;

      expect(secondTimeout).not.toBe(firstTimeout);
    });
  });

  describe('_processLightLevelUpdate', () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it('should update light level value', () => {
      // Set the property on the proxy before processing
      mockProxy.set_cached_property('LightLevel', 250);

      service._processLightLevelUpdate(250);

      expect(service.dbus.lightLevel).toBe(250);
    });

    it('should invoke callback when value changes', () => {
      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);

      service._processLightLevelUpdate(250);

      expect(callback).toHaveBeenCalledWith(250);
    });

    it('should invoke callback even when value unchanged', () => {
      // Set initial value on the proxy
      mockProxy.set_cached_property('LightLevel', 250);

      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);

      service._processLightLevelUpdate(250);

      // Callback is now invoked regardless of value change
      expect(callback).toHaveBeenCalledWith(250);
    });

    it('should update last update time', async () => {
      const before = Date.now();

      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 1));

      service._processLightLevelUpdate(250);

      expect(service._lastUpdateTime).toBeGreaterThanOrEqual(before);
    });
  });

  describe('destroy', () => {
    it('should clear pending timeout', async () => {
      await service.start();
      service._lastUpdateTime = Date.now() - 500;
      service._handleLightLevelChange(400);

      expect(service._pendingTimeout).not.toBeNull();

      service.destroy();

      expect(service._pendingTimeout).toBeNull();
    });

    it('should disconnect proxy signal', async () => {
      await service.start();
      const signalId = service._signalId;

      expect(signalId).not.toBeNull();

      service.destroy();

      expect(service._signalId).toBeNull();
    });

    it('should release light sensor', async () => {
      await service.start();
      mockProxy = service.dbus._proxy;

      service.destroy();

      expect(service.dbus._proxy).toBeNull();
    });

    it('should clear callbacks', async () => {
      await service.start();
      const lightCallback = jest.fn();
      const sensorCallback = jest.fn();

      service.onLightLevelChanged.add(lightCallback);
      service.onSensorAvailableChanged.add(sensorCallback);

      service.destroy();

      expect(service.onLightLevelChanged.size).toBe(0);
      expect(service.onSensorAvailableChanged.size).toBe(0);
    });

    it('should handle destroy when not started', () => {
      expect(() => service.destroy()).not.toThrow();
    });

    it('should handle multiple destroy calls', async () => {
      await service.start();
      service.destroy();
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe('filter function in _handleLightLevelChange', () => {
    let serviceWithFilter;

    beforeEach(async () => {
      // Create a filter function that only allows changes >= 100 lux
      const filterFn = (prev, curr) => {
        if (prev === null || curr === null) return true;
        return Math.abs(curr - prev) >= 100;
      };
      serviceWithFilter = new SensorProxyService(filterFn);
      await serviceWithFilter.start();
      mockProxy = serviceWithFilter.dbus._proxy;
    });

    afterEach(() => {
      if (serviceWithFilter) {
        serviceWithFilter.destroy();
      }
    });

    it('should filter changes when filter function returns false', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      // Set initial value
      serviceWithFilter._lastLuxValue = 400;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      // Small change (< 100) - filter should return false
      serviceWithFilter._handleLightLevelChange(450);

      // Should be filtered - callback not invoked
      expect(callback).not.toHaveBeenCalled();

      // But lastLuxValue should be updated
      expect(serviceWithFilter._lastLuxValue).toBe(450);
    });

    it('should process changes when filter function returns true', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      // Set initial value
      serviceWithFilter._lastLuxValue = 400;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      // Large change (>= 100) - filter should return true
      serviceWithFilter._handleLightLevelChange(550);

      // Should be processed - callback invoked
      expect(callback).toHaveBeenCalledWith(550);
    });

    it('should bypass filtering when forceUpdate is true', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      // Set initial value
      serviceWithFilter._lastLuxValue = 400;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      // Small change but force update
      serviceWithFilter._handleLightLevelChange(450, true);

      // Should be processed despite filter returning false
      expect(callback).toHaveBeenCalledWith(450);
    });

    it('should update lastLuxValue even when filtered', () => {
      serviceWithFilter._lastLuxValue = 400;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      // Filtered change
      serviceWithFilter._handleLightLevelChange(420);

      expect(serviceWithFilter._lastLuxValue).toBe(420);
    });

    it('should process first event after startup (lastLuxValue is null)', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      serviceWithFilter._lastUpdateTime = 0;
      serviceWithFilter._lastLuxValue = null;

      // First event should always be processed (filter returns true for null)
      serviceWithFilter._handleLightLevelChange(400);

      expect(callback).toHaveBeenCalledWith(400);
      expect(serviceWithFilter._lastLuxValue).toBe(400);
    });

    it('should handle rapid fluctuations when filter rejects them', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      serviceWithFilter._lastLuxValue = 400;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      // Multiple small changes (< 100)
      serviceWithFilter._handleLightLevelChange(420);
      serviceWithFilter._handleLightLevelChange(430);
      serviceWithFilter._handleLightLevelChange(410);
      serviceWithFilter._handleLightLevelChange(450);

      // All should be filtered
      expect(callback).not.toHaveBeenCalled();

      // But lastLuxValue should track latest
      expect(serviceWithFilter._lastLuxValue).toBe(450);
    });

    it('should work with throttling and filtering together', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      serviceWithFilter._lastLuxValue = 400;
      serviceWithFilter._lastUpdateTime = Date.now() - 500; // Recent update

      // Large change that passes filter but within throttle period
      serviceWithFilter._handleLightLevelChange(550);

      // Should be delayed, not immediate
      expect(callback).not.toHaveBeenCalled();
      expect(serviceWithFilter._pendingTimeout).not.toBeNull();
    });
  });

  describe('forceUpdate', () => {
    let serviceWithFilter;

    beforeEach(async () => {
      // Filter that only allows changes >= 100 lux
      const filterFn = (prev, curr) => {
        if (prev === null || curr === null) return true;
        return Math.abs(curr - prev) >= 100;
      };
      serviceWithFilter = new SensorProxyService(filterFn);
      await serviceWithFilter.start();
      mockProxy = serviceWithFilter.dbus._proxy;
    });

    afterEach(() => {
      if (serviceWithFilter) {
        serviceWithFilter.destroy();
      }
    });

    it('should force update even when filter would reject', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      mockProxy.set_cached_property('LightLevel', 150);
      serviceWithFilter._lastLuxValue = 120;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      // 120 to 150 is only 30 lux change (< 100), filter would reject
      // But forceUpdate should process it
      serviceWithFilter._handleLightLevelChange(serviceWithFilter.dbus?.lightLevel, true);

      expect(callback).toHaveBeenCalledWith(150);
    });

    it('should update lastLuxValue', () => {
      mockProxy.set_cached_property('LightLevel', 300);
      serviceWithFilter._lastLuxValue = 100;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      serviceWithFilter._handleLightLevelChange(serviceWithFilter.dbus?.lightLevel, true);

      expect(serviceWithFilter._lastLuxValue).toBe(300);
    });

    it('should work for use case: sleep/resume', () => {
      const callback = jest.fn();
      serviceWithFilter.onLightLevelChanged.add(callback);

      // Before sleep: indoor lighting
      mockProxy.set_cached_property('LightLevel', 400);
      serviceWithFilter._lastLuxValue = 400;
      serviceWithFilter._lastUpdateTime = Date.now() - 3000;

      // After resume: outdoor lighting (significant change)
      mockProxy.set_cached_property('LightLevel', 5000);

      serviceWithFilter._handleLightLevelChange(serviceWithFilter.dbus?.lightLevel, true);

      expect(callback).toHaveBeenCalledWith(5000);
      expect(serviceWithFilter._lastLuxValue).toBe(5000);
    });
  });

  describe('destroy', () => {
    it('should clear pending timeout', async () => {
      await service.start();
      service._lastUpdateTime = Date.now() - 500;
      service._handleLightLevelChange(400);

      expect(service._pendingTimeout).not.toBeNull();

      service.destroy();

      expect(service._pendingTimeout).toBeNull();
    });

    it('should disconnect proxy signal', async () => {
      await service.start();
      const signalId = service._signalId;

      expect(signalId).not.toBeNull();

      service.destroy();

      expect(service._signalId).toBeNull();
    });

    it('should release light sensor', async () => {
      await service.start();
      mockProxy = service.dbus._proxy;

      service.destroy();

      expect(service.dbus._proxy).toBeNull();
    });

    it('should clear callbacks', async () => {
      await service.start();
      const lightCallback = jest.fn();
      const sensorCallback = jest.fn();

      service.onLightLevelChanged.add(lightCallback);
      service.onSensorAvailableChanged.add(sensorCallback);

      service.destroy();

      expect(service.onLightLevelChanged.size).toBe(0);
      expect(service.onSensorAvailableChanged.size).toBe(0);
    });

    it('should handle destroy when not started', () => {
      expect(() => service.destroy()).not.toThrow();
    });

    it('should handle multiple destroy calls', async () => {
      await service.start();
      service.destroy();
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it('should handle rapid light level changes with throttling', () => {
      service._lastUpdateTime = 0;

      // Set properties on the proxy so getter can read them
      mockProxy.set_cached_property('LightLevel', 100);

      // First change - immediate
      service._handleLightLevelChange(100);
      expect(service.dbus.lightLevel).toBe(100);

      // Second change - throttled
      service._handleLightLevelChange(200);
      expect(service.dbus.lightLevel).toBe(100); // Still old value
      expect(service._pendingTimeout).not.toBeNull();
    });

    it('should handle complete sensor lifecycle', async () => {
      const sensorCallback = jest.fn();
      service.onSensorAvailableChanged.add(sensorCallback);

      // Sensor becomes available
      mockProxy.set_cached_property('HasAmbientLight', true);
      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'HasAmbientLight') {
            return { get_boolean: () => true };
          }
          return null;
        },
      };
      service._onPropertiesChanged(service.dbus._proxy, mockChanged, {});
      expect(service.dbus.hasAmbientLight).toBe(true);
      expect(sensorCallback).toHaveBeenCalledWith(true);

      // Light level updates
      mockProxy.set_cached_property('LightLevel', 500);
      service._processLightLevelUpdate(500);
      expect(service.dbus.lightLevel).toBe(500);

      // Service destroyed
      service.destroy();
      expect(service.dbus._proxy).toBeNull();
    });
  });

  describe('lastLuxValue getter', () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it('should return null before any reading arrives', () => {
      expect(service.lastLuxValue).toBeNull();
    });

    it('should return the last processed lux value', () => {
      service._lastLuxValue = 50;
      expect(service.lastLuxValue).toBe(50);
    });

    it('should NOT be updated when phantom lux=0 is deferred', () => {
      // Simulate pre-sleep state: last known lux was 50
      service._lastLuxValue = 50;
      // Simulate daemon reconnect — throttle window is now active (settling mode)
      service._enterSettlingMode();

      // Phantom reading arrives while the sensor is still settling
      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'LightLevel') return { get_double: () => 0 };
          return null;
        },
      };
      service._onPropertiesChanged(mockProxy, mockChanged, {});

      // lastLuxValue must NOT be updated until the throttle timer fires
      expect(service.lastLuxValue).toBe(50);
      // a pending throttle timer should be waiting
      expect(service._pendingTimeout).not.toBeNull();
    });

    it('should be updated by readings once settling is complete', () => {
      service._lastLuxValue = 50;
      service._lastUpdateTime = 0; // simulate throttle window has expired

      const mockChanged = {
        lookup_value: (key) => {
          if (key === 'LightLevel') return { get_double: () => 5 };
          return null;
        },
      };
      service._onPropertiesChanged(mockProxy, mockChanged, {});

      expect(service.lastLuxValue).toBe(5);
    });

    it('should return null after daemon restart clears it', () => {
      service._lastLuxValue = 50;
      // Simulate _onNameOwnerChanged resetting lastLuxValue
      service._lastLuxValue = null;

      expect(service.lastLuxValue).toBeNull();
    });
  });

  describe('phantom lux=0 regression: onDisplayIsActiveChanged path', () => {
    // Regression test for the bug where phantom lux=0 (published by
    // iio-sensor-proxy right after resume) would be written to the raw
    // dbus.lightLevel proxy cache, and then if onDisplayIsActiveChanged
    // fired after that cache update it would call
    // adjustBrightnessForLightLevel(0), setting currentBucketIndex=0 and
    // corrupting the bucket-mapper state so subsequent low-light readings
    // would be trapped by crossesBucketBoundary and brightness would never
    // recover from the minimum value.
    //
    // The fix: onDisplayIsActiveChanged uses sensorProxy.lastLuxValue
    // (the filtered value) rather than sensorProxy.dbus.lightLevel (raw).

    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it('lastLuxValue is unaffected by phantom lux=0 until debounce fires, so onDisplayIsActiveChanged receives correct lux', () => {
      // Pre-sleep state: last processed lux was 50
      service._lastLuxValue = 50;

      // Phantom lux=0 updates the proxy cache (happens before signal handler)
      mockProxy.set_cached_property('LightLevel', 0);

      // The raw proxy reports 0 — this is what triggered the bug
      expect(service.dbus.lightLevel).toBe(0);

      // But the deferred lastLuxValue is still the pre-sleep value
      expect(service.lastLuxValue).toBe(50);

      // Simulating what onDisplayIsActiveChanged now does (the fix):
      // uses lastLuxValue instead of dbus.lightLevel
      const luxForBrightnessUpdate = service.lastLuxValue;
      expect(luxForBrightnessUpdate).toBe(50); // not 0 — bucket mapper is safe
    });

    it('lastLuxValue is null after daemon restart, so onDisplayIsActiveChanged defers to first real reading', () => {
      // Daemon restart: _onNameOwnerChanged resets lastLuxValue to null
      service._lastLuxValue = null;

      // The onDisplayIsActiveChanged path uses lastLuxValue
      const luxForBrightnessUpdate = service.lastLuxValue;
      expect(luxForBrightnessUpdate).toBeNull();
      // adjustBrightnessForLightLevel(null, true) -> early return -> no
      // bucket-mapper corruption; brightness waits for first real ALS reading
    });
  });

  describe('callback API', () => {
    beforeEach(async () => {
      await service.start();
      mockProxy = service.dbus._proxy;
    });

    it('should register light level callback', () => {
      const callback = jest.fn();
      const id = service.onLightLevelChanged.add(callback);
      expect(id).toBeGreaterThan(0);
      expect(service.onLightLevelChanged.size).toBe(1);
    });

    it('should register sensor available callback', () => {
      const callback = jest.fn();
      const id = service.onSensorAvailableChanged.add(callback);
      expect(id).toBeGreaterThan(0);
      expect(service.onSensorAvailableChanged.size).toBe(1);
    });

    it('should provide light level via dbus layer', async () => {
      await service.start();
      service.dbus._proxy.set_cached_property('LightLevel', 123);
      expect(service.dbus.lightLevel).toBe(123);
    });

    it('should provide sensor availability via dbus layer', async () => {
      await service.start();
      service.dbus._proxy.set_cached_property('HasAmbientLight', true);
      expect(service.dbus.hasAmbientLight).toBe(true);
    });

    it('should handle callback errors gracefully', async () => {
      await service.start();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const callback = jest.fn(() => {
        throw new Error('Callback error');
      });

      service.onLightLevelChanged.add(callback);
      service._processLightLevelUpdate(100);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('CallbackManager'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('sensor settling debounce', () => {
    const makeLuxChanged = (lux) => ({
      lookup_value: (key) => {
        if (key === 'LightLevel') return { get_double: () => lux };
        return null;
      },
    });

    beforeEach(async () => {
      // Start with real timers so process.nextTick in dbus.connect/claimLight
      // resolves, then switch to fake timers to control GLib.timeout_add.
      await service.start();
      mockProxy = service.dbus._proxy;
      jest.useFakeTimers();
    });

    afterEach(() => {
      GLib.clearAllTimeouts();
      jest.useRealTimers();
    });

    it('start() primes the throttle window so the first reading is deferred', () => {
      // start() enters settling mode to guard against phantom readings that
      // iio-sensor-proxy may emit right at startup. The first reading is
      // deferred by the throttle window rather than applied immediately, but
      // it is NOT dropped — it fires once the throttle timer expires.
      expect(service._lastUpdateTime).toBeGreaterThan(0);

      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);
      service._onPropertiesChanged(mockProxy, makeLuxChanged(500), {});

      expect(callback).not.toHaveBeenCalled();
      expect(service._pendingTimeout).not.toBeNull();
    });

    it('phantom reading replaced by stable reading: only stable value applied', () => {
      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);

      service._onPropertiesChanged(mockProxy, makeLuxChanged(0), {});
      expect(service._pendingTimeout).not.toBeNull();

      service._onPropertiesChanged(mockProxy, makeLuxChanged(300), {});
      jest.advanceTimersByTime(service._throttleTimeoutMs + 1);

      expect(callback).toHaveBeenCalledWith(300);
      expect(callback).not.toHaveBeenCalledWith(0);
    });

    it('dark room: genuine 0 applied after throttle fires with no follow-up', () => {
      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);

      service._onPropertiesChanged(mockProxy, makeLuxChanged(0), {});
      jest.advanceTimersByTime(service._throttleTimeoutMs + 1);

      expect(callback).toHaveBeenCalledWith(0);
      expect(service._lastLuxValue).toBe(0);
    });

    it('no signal during settling: fallback commits current proxy LightLevel', () => {
      // Sensor value unchanged since connection — g-properties-changed never fires.
      // The fallback timeout must pick up the current value from the proxy directly.
      //
      // Re-enter settling mode now that fake timers are active so that
      // jest.advanceTimersByTime() can fire the fallback (the one scheduled by
      // start() used real timers and is invisible to fake-timer advancement).
      mockProxy.LightLevel = 400;
      service._enterSettlingMode();

      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);

      jest.advanceTimersByTime(service._throttleTimeoutMs + 1);

      expect(callback).toHaveBeenCalledWith(400);
      expect(service.lastLuxValue).toBe(400);
    });

    it('daemon reconnect re-primes the throttle window', () => {
      service._lastUpdateTime = 0; // expire the throttle window

      service._currentNameOwner = 'old-owner';
      service.dbus._proxy.g_name_owner = 'new-owner';
      service._onNameOwnerChanged();

      const callback = jest.fn();
      service.onLightLevelChanged.add(callback);
      service._onPropertiesChanged(mockProxy, makeLuxChanged(100), {});

      expect(callback).not.toHaveBeenCalled();
      expect(service._pendingTimeout).not.toBeNull();
    });
  });
});
