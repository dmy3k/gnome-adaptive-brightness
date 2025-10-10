export const PRIORITY_LOW = 200;
export const SOURCE_REMOVE = false;
export const SOURCE_CONTINUE = true;

const activeTimeouts = new Map();
let timeoutIdCounter = 1;

export function timeout_add(priority, interval, callback) {
  const id = timeoutIdCounter++;
  const timeoutHandle = setTimeout(() => {
    activeTimeouts.delete(id);
    const result = callback();
    if (result === SOURCE_CONTINUE) {
      // Re-schedule if SOURCE_CONTINUE is returned
      const newId = timeout_add(priority, interval, callback);
      activeTimeouts.set(id, activeTimeouts.get(newId));
      activeTimeouts.delete(newId);
    }
  }, interval);
  activeTimeouts.set(id, timeoutHandle);
  return id;
}

export function timeout_add_seconds(priority, intervalSeconds, callback) {
  return timeout_add(priority, intervalSeconds * 1000, callback);
}

export function source_remove(id) {
  const handle = activeTimeouts.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    activeTimeouts.delete(id);
    return true;
  }
  return false;
}

export function clearAllTimeouts() {
  for (const [id, handle] of activeTimeouts.entries()) {
    clearTimeout(handle);
  }
  activeTimeouts.clear();
}

export class Variant {
  constructor(format, value) {
    this._format = format;
    this._value = value;
  }

  get_int32() {
    return typeof this._value === "number"
      ? this._value
      : parseInt(this._value);
  }

  lookup_value(key, type) {
    if (this._format === "a{sv}" || typeof this._value === "object") {
      if (this._value && key in this._value) {
        const value = this._value[key];
        return new Variant("i", value);
      }
    }
    return null;
  }
}

export default {
  PRIORITY_LOW,
  SOURCE_REMOVE,
  SOURCE_CONTINUE,
  timeout_add,
  timeout_add_seconds,
  source_remove,
  clearAllTimeouts,
  Variant,
};
