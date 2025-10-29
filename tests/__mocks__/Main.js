export class MessageTray {
  constructor() {
    this._sources = [];
  }

  add(source) {
    this._sources.push(source);
  }
}

// Mock BrightnessScale for GNOME 49+
export class BrightnessScale {
  constructor(name, value = 1.0, nSteps = 20) {
    this._name = name;
    this._value = value;
    this._locked = false;
    this._nSteps = nSteps;
    this._callbacks = new Map();
    this._nextCallbackId = 1;
  }

  get name() {
    return this._name;
  }

  get value() {
    return this._value;
  }

  set value(val) {
    if (Math.abs(val - this._value) < 0.001) return;
    this._value = Math.max(0, Math.min(1, val));
    this._notifyValueChanged();
  }

  get locked() {
    return this._locked;
  }

  set locked(val) {
    if (this._locked === val) return;
    this._locked = val;
  }

  get nSteps() {
    return this._nSteps;
  }

  stepUp() {
    this.value = Math.min(1.0, this._value + 1.0 / this._nSteps);
  }

  stepDown() {
    this.value = Math.max(0.0, this._value - 1.0 / this._nSteps);
  }

  connect(signal, callback) {
    if (signal === 'notify::value' || signal === 'backlights-changed') {
      const id = this._nextCallbackId++;
      this._callbacks.set(id, { signal, callback });
      return id;
    }
    return 0;
  }

  disconnect(id) {
    this._callbacks.delete(id);
  }

  _notifyValueChanged() {
    for (const { signal, callback } of this._callbacks.values()) {
      if (signal === 'notify::value' || signal === 'backlights-changed') {
        callback();
      }
    }
  }
}

// Mock BrightnessManager for GNOME 49+
export class BrightnessManager {
  constructor() {
    this._globalScale = new BrightnessScale('Brightness', 1.0, 20);
    this._monitorScales = new Map();
    // Add a default monitor scale for testing
    this._monitorScales.set('eDP-1', new BrightnessScale('eDP-1', 1.0, 20));
    this._dimmingEnabled = false;
    this._dimmingTarget = 0.3; // 30% from idle-brightness setting
    this._abTarget = -1.0;
    this._changedCallbacks = new Map();
    this._nextCallbackId = 1;
    this._displayOff = false; // Track if display is simulated as off
  }

  get globalScale() {
    // Return null when display is off (GNOME 49 behavior)
    return this._displayOff ? null : this._globalScale;
  }

  get scales() {
    // Return empty array when display is off (GNOME 49 behavior)
    return this._displayOff ? [] : [...this._monitorScales.values()];
  }

  get dimming() {
    return this._dimmingEnabled;
  }

  set dimming(enable) {
    this._dimmingEnabled = enable;
  }

  get autoBrightnessTarget() {
    return this._abTarget;
  }

  set autoBrightnessTarget(target) {
    this._abTarget = target;
    // When auto brightness is set, update the global scale (if display is on)
    if (target >= 0 && !this._displayOff && this._globalScale) {
      this._globalScale.value = target;
    }
  }

  connect(signal, callback) {
    if (signal === 'changed') {
      const id = this._nextCallbackId++;
      this._changedCallbacks.set(id, callback);
      return id;
    }
    return 0;
  }

  disconnect(id) {
    this._changedCallbacks.delete(id);
  }

  emit(signal) {
    if (signal === 'changed') {
      for (const callback of this._changedCallbacks.values()) {
        callback();
      }
    }
  }

  // Test helper: Simulate display being turned off/on
  setDisplayOff(isOff) {
    this._displayOff = isOff;
    this.emit('changed');
  }
}

export const messageTray = new MessageTray();

// Export brightnessManager instance (can be set to null to test legacy path)
export let brightnessManager = new BrightnessManager();

// Helper to reset brightnessManager for testing
export function resetBrightnessManager(enabled = true) {
  if (enabled) {
    brightnessManager = new BrightnessManager();
  } else {
    brightnessManager = null;
  }
}

export default {
  messageTray,
  brightnessManager,
};
