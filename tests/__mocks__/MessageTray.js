export class Source {
  constructor({ title, iconName }) {
    this.title = title;
    this.iconName = iconName;
    this.isDestroyed = false;
    this._delegate = this;
    this._signals = new Map();
    this._signalIdCounter = 1;
  }

  connect(signalName, callback) {
    const signalId = this._signalIdCounter++;
    if (!this._signals.has(signalName)) {
      this._signals.set(signalName, new Map());
    }
    this._signals.get(signalName).set(signalId, callback);
    return signalId;
  }

  emit(signalName, ...args) {
    const handlers = this._signals.get(signalName);
    if (handlers) {
      handlers.forEach((callback) => callback(...args));
    }
  }

  addNotification(notification) {
    // Mock implementation
  }

  destroy() {
    this.isDestroyed = true;
    this.emit("destroy");
  }
}

export class Notification {
  constructor({ source, title, body }) {
    this.source = source;
    this.title = title;
    this.body = body;
    this.urgency = Urgency.NORMAL;
    this.isTransient = true;
    this._actions = [];
    this._signals = new Map();
    this._signalIdCounter = 1;
  }

  connect(signalName, callback) {
    const signalId = this._signalIdCounter++;
    if (!this._signals.has(signalName)) {
      this._signals.set(signalName, new Map());
    }
    this._signals.get(signalName).set(signalId, callback);
    return signalId;
  }

  emit(signalName, ...args) {
    const handlers = this._signals.get(signalName);
    if (handlers) {
      handlers.forEach((callback) => callback(...args));
    }
  }

  addAction(label, callback) {
    this._actions.push({ label, callback });
  }

  activate() {
    this.emit("activated");
  }

  destroy() {
    this.emit("destroy");
  }
}

export const Urgency = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export default {
  Source,
  Notification,
  Urgency,
};
