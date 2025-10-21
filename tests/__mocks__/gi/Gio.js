class DBusProxy {
  constructor() {
    this._properties = new Map();
    this._signals = new Map();
    this._signalIdCounter = 1;
  }

  static new(bus, flags, info, busName, objectPath, iface, cancellable, callback) {
    const proxy = new DBusProxy();
    proxy._busName = busName;
    proxy._objectPath = objectPath;
    proxy._busType = bus?._busType; // Store bus type from the bus object
    process.nextTick(() =>
      callback(null, {
        __asyncResult: true,
        __proxy: proxy,
      })
    );
  }

  static new_finish(result) {
    if (result.__error) throw result.__error;
    return result.__proxy;
  }

  /**
   * Mock implementation of makeProxyWrapper
   * Creates a wrapper class that mimics GNOME Shell's proxy wrapper pattern
   */
  static makeProxyWrapper(interfaceXml) {
    // Parse the interface XML to extract method names and properties
    const methodMatches = interfaceXml.matchAll(/<method name="([^"]+)"/g);
    const methods = Array.from(methodMatches, (m) => m[1]);

    const propertyMatches = interfaceXml.matchAll(/<property name="([^"]+)"/g);
    const properties = Array.from(propertyMatches, (m) => m[1]);

    const signalMatches = interfaceXml.matchAll(/<signal name="([^"]+)"/g);
    const signals = Array.from(signalMatches, (m) => m[1]);

    // Return a constructor function that creates proxy instances
    return class ProxyWrapper extends DBusProxy {
      constructor(bus, busName, objectPath, callback) {
        super();
        this._busName = busName;
        this._objectPath = objectPath;
        this._busType = bus?._busType;

        // Add dynamic properties with getters/setters
        properties.forEach((propName) => {
          Object.defineProperty(this, propName, {
            get() {
              return this._properties.get(propName);
            },
            set(value) {
              this._properties.set(propName, value);
            },
            enumerable: true,
            configurable: true,
          });
        });

        // Add async method wrappers for each method in the interface
        methods.forEach((methodName) => {
          const asyncMethodName = `${methodName}Async`;
          this[asyncMethodName] = (callback) => {
            // Call the callback asynchronously with test-defined return value
            // Real GJS signature: callback(result, error)
            process.nextTick(() => {
              const returnValue = this._mockMethodReturnValue?.[methodName] ?? null;
              const error = this._mockMethodError?.[methodName] ?? null;
              if (callback) {
                callback(returnValue, error);
              }
            });
          };
        });

        // Add signal support for makeProxyWrapper signals
        this.connectSignal = (signalName, callback) => {
          return this.connect('g-signal', (proxy, sender, sigName, params) => {
            if (sigName === signalName) {
              callback(proxy, sender, params);
            }
          });
        };

        // Store mock return values and errors
        this._mockMethodReturnValue = {};
        this._mockMethodError = {};

        // Add helper for tests to set return values
        this._setMockMethodReturnValue = (methodName, value) => {
          this._mockMethodReturnValue[methodName] = value;
        };

        // Add helper for tests to set errors
        this._setMockMethodError = (methodName, error) => {
          this._mockMethodError[methodName] = error;
        };

        // Call the async callback like real GIO does
        process.nextTick(() => {
          if (callback) {
            callback(this, null);
          }
        });
      }
    };
  }

  get_cached_property(name) {
    const value = this._properties.get(name);
    if (value === undefined) return null;
    return {
      get_int32: () => value,
      get_double: () => value,
      get_boolean: () => value,
    };
  }

  set_cached_property(name, value) {
    this._properties.set(name, value);
  }

  connect(signalName, callback) {
    const signalId = this._signalIdCounter++;
    if (!this._signals.has(signalName)) {
      this._signals.set(signalName, new Map());
    }
    this._signals.get(signalName).set(signalId, callback);
    return signalId;
  }

  connectSignal(signalName, callback) {
    // For backward compatibility, map to g-signal connection
    return this.connect('g-signal', (proxy, sender, sigName, params) => {
      if (sigName === signalName) {
        callback(proxy, sender, params);
      }
    });
  }

  disconnect(signalId) {
    for (const [signalName, handlers] of this._signals.entries()) {
      if (handlers.has(signalId)) {
        handlers.delete(signalId);
        return;
      }
    }
  }

  disconnectSignal(signalId) {
    // Alias for disconnect
    this.disconnect(signalId);
  }

  emit(signalName, ...args) {
    const handlers = this._signals.get(signalName);
    if (handlers) {
      handlers.forEach((callback) => {
        try {
          callback(this, ...args);
        } catch (error) {
          // Silently catch errors to match GJS behavior
          // In real GJS, signal handler errors don't crash the system
        }
      });
    }
  }

  emitSignal(signalName, ...args) {
    // Emit DBus signal using g-signal event (GJS standard)
    // Real GJS signature: (proxy, sender, signalName, parameters)
    // where parameters is a GVariant
    const parameters = {
      deep_unpack: () => args,
      unpack: () => args[0],
    };
    this.emit('g-signal', null, signalName, parameters);
  }

  call(method, params, flags, timeout, cancellable, callback) {
    process.nextTick(() => {
      callback(
        {
          call_finish: (result) => {
            if (result.__error) throw result.__error;
            // Return a GVariant-like object with deep_unpack method
            return {
              deep_unpack: () => result.__returnValue || 0,
              unpack: () => result.__returnValue || 0,
            };
          },
        },
        {
          __asyncResult: true,
          __returnValue: 0, // Default return value, can be overridden in tests
        }
      );
    });
  }
}

class Settings {
  constructor({ schema }) {
    this._schema = schema;
    this._settings = new Map();
    this._signals = new Map();
    this._signalIdCounter = 1;

    // Default values
    this._settings.set('idle-brightness', 30);
    this._settings.set('ambient-enabled', false);
  }

  get_int(key) {
    return this._settings.get(key);
  }

  get_boolean(key) {
    return this._settings.get(key);
  }

  set_int(key, value) {
    this._settings.set(key, value);
    this.emit('changed', key);
    this.emit(`changed::${key}`);
  }

  set_boolean(key, value) {
    this._settings.set(key, value);
    this.emit('changed', key);
    this.emit(`changed::${key}`);
  }

  connect(signalName, callback) {
    const signalId = this._signalIdCounter++;
    if (!this._signals.has(signalName)) {
      this._signals.set(signalName, new Map());
    }
    this._signals.get(signalName).set(signalId, callback);
    return signalId;
  }

  disconnect(signalId) {
    for (const [signalName, handlers] of this._signals.entries()) {
      if (handlers.has(signalId)) {
        handlers.delete(signalId);
        return;
      }
    }
  }

  emit(signalName, ...args) {
    const handlers = this._signals.get(signalName);
    if (handlers) {
      handlers.forEach((callback) => callback(this, ...args));
    }
  }
}

export const BusType = { SESSION: 0, SYSTEM: 1 };
export const DBusProxyFlags = { NONE: 0 };
export const DBusCallFlags = { NONE: 0 };
export const bus_get_sync = (busType) => ({
  __isMockBus: true,
  _busType: busType,
});

// Mock DBus object with session property
export const DBus = {
  session: {
    __isMockBus: true,
    _busType: BusType.SESSION,
  },
  system: {
    __isMockBus: true,
    _busType: BusType.SYSTEM,
  },
};

export { DBusProxy, Settings };

export default {
  BusType,
  DBusProxyFlags,
  DBusCallFlags,
  bus_get_sync,
  DBus,
  DBusProxy,
  Settings,
};
