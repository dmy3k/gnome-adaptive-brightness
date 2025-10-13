/**
 * Mock for GNOME Shell's LoginManager
 */

class MockLoginManager {
  constructor() {
    this._signals = new Map();
    this._nextSignalId = 1;
    this._preparingForSleep = false;
  }

  connect(signalName, callback) {
    const id = this._nextSignalId++;
    this._signals.set(id, { signalName, callback });
    return id;
  }

  disconnect(signalId) {
    this._signals.delete(signalId);
  }

  // Simulate emitting prepare-for-sleep signal
  _emitPrepareForSleep(aboutToSuspend) {
    this._preparingForSleep = aboutToSuspend;
    for (const [id, signal] of this._signals.entries()) {
      if (signal.signalName === "prepare-for-sleep") {
        signal.callback(this, aboutToSuspend);
      }
    }
  }

  get preparingForSleep() {
    return this._preparingForSleep;
  }

  async canSuspend() {
    return { canSuspend: true, needsAuth: false };
  }

  suspend() {
    this._emitPrepareForSleep(true);
    // Simulate async wake
    setTimeout(() => this._emitPrepareForSleep(false), 10);
  }
}

let _loginManager = null;

export function getLoginManager() {
  if (!_loginManager) {
    _loginManager = new MockLoginManager();
  }
  return _loginManager;
}

// Test helper to reset the singleton
export function _resetLoginManager() {
  _loginManager = null;
}

export default {
  getLoginManager,
  _resetLoginManager,
};
