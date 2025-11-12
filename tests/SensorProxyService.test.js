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
});
