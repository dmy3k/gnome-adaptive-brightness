class DBusProxy {
  constructor() {
    this._properties = new Map();
    this._signals = new Map();
    this._signalIdCounter = 1;
  }

  static new(
    bus,
    flags,
    info,
    busName,
    objectPath,
    iface,
    cancellable,
    callback
  ) {
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
    return this.connect("g-signal", (proxy, sender, sigName, params) => {
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
    this.emit("g-signal", null, signalName, parameters);
  }

  call(method, params, flags, timeout, cancellable, callback) {
    process.nextTick(() => {
      callback(
        {
          call_finish: (result) => {
            if (result.__error) throw result.__error;
            return result.__success;
          },
        },
        {
          __asyncResult: true,
          __success: true,
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
    this._settings.set("idle-brightness", 30);
    this._settings.set("ambient-enabled", false);
  }

  get_int(key) {
    return this._settings.get(key);
  }

  get_boolean(key) {
    return this._settings.get(key);
  }

  set_int(key, value) {
    this._settings.set(key, value);
    this.emit("changed", key);
    this.emit(`changed::${key}`);
  }

  set_boolean(key, value) {
    this._settings.set(key, value);
    this.emit("changed", key);
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
export { DBusProxy, Settings };

export default {
  BusType,
  DBusProxyFlags,
  DBusCallFlags,
  bus_get_sync,
  DBusProxy,
  Settings,
};
