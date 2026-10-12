import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { VideoPlaybackMonitor } from '../lib/VideoPlaybackMonitor.js';
import { CallbackManager } from '../lib/CallbackManager.js';

function createDisplay() {
  const handlers = new Map();
  let nextId = 1;
  return {
    fullscreenMonitors: new Set(),
    connect: jest.fn((signal, cb) => {
      handlers.set(nextId, { signal, cb });
      return nextId++;
    }),
    disconnect: jest.fn((id) => handlers.delete(id)),
    get_monitor_in_fullscreen(index) {
      return this.fullscreenMonitors.has(index);
    },
    emit(signal) {
      for (const h of handlers.values()) if (h.signal === signal) h.cb();
    },
    get handlerCount() {
      return handlers.size;
    },
  };
}

function createSettings(requireInhibitor = true) {
  const handlers = new Map();
  let nextId = 1;
  const values = { 'fullscreen-require-inhibitor': requireInhibitor };
  return {
    get_boolean: (key) => values[key],
    set(key, value) {
      values[key] = value;
      for (const h of handlers.values()) if (h.signal === `changed::${key}`) h.cb();
    },
    connect: (signal, cb) => {
      handlers.set(nextId, { signal, cb });
      return nextId++;
    },
    disconnect: (id) => handlers.delete(id),
  };
}

function createInhibitor({ fail = false } = {}) {
  return {
    idleInhibited: false,
    onIdleInhibitedChanged: new CallbackManager(),
    connect: jest.fn(() => (fail ? Promise.reject(new Error('no bus')) : Promise.resolve())),
    destroy: jest.fn(),
    setInhibited(value) {
      this.idleInhibited = value;
      this.onIdleInhibitedChanged.invoke(value);
    },
  };
}

describe('VideoPlaybackMonitor', () => {
  let display;
  let settings;
  let inhibitor;
  let monitor;
  let changes;

  async function startMonitor() {
    monitor = new VideoPlaybackMonitor(settings, inhibitor);
    changes = [];
    monitor.onActiveChanged.add((v) => changes.push(v));
    await monitor.start();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    display = createDisplay();
    // In Node `global` is globalThis, so exposing `display` mimics Shell's global.display.
    globalThis.display = display;
    Main.layoutManager.primaryIndex = 0;
    settings = createSettings();
    inhibitor = createInhibitor();
  });

  afterEach(() => {
    monitor?.destroy();
    jest.useRealTimers();
    delete globalThis.display;
  });

  it('is inactive without fullscreen', async () => {
    await startMonitor();
    expect(monitor.active).toBe(false);
  });

  it('requires an idle inhibitor in addition to fullscreen by default', async () => {
    await startMonitor();

    display.fullscreenMonitors.add(0);
    display.emit('in-fullscreen-changed');
    jest.advanceTimersByTime(300);
    expect(monitor.active).toBe(false);

    inhibitor.setInhibited(true);
    jest.advanceTimersByTime(300);
    expect(monitor.active).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('deactivates when the inhibitor is released', async () => {
    display.fullscreenMonitors.add(0);
    inhibitor.idleInhibited = true;
    await startMonitor();
    expect(monitor.active).toBe(true);

    inhibitor.setInhibited(false);
    jest.advanceTimersByTime(300);
    expect(monitor.active).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('is inactive when only an inhibitor is present', async () => {
    inhibitor.idleInhibited = true;
    await startMonitor();
    expect(monitor.active).toBe(false);
  });

  it('only considers the primary monitor', async () => {
    inhibitor.idleInhibited = true;
    display.fullscreenMonitors.add(1);
    await startMonitor();
    expect(monitor.active).toBe(false);

    Main.layoutManager.primaryIndex = 1;
    Main.layoutManager.emit('monitors-changed');
    jest.advanceTimersByTime(300);
    expect(monitor.active).toBe(true);
  });

  it('counts any fullscreen when the inhibitor requirement is off', async () => {
    settings = createSettings(false);
    display.fullscreenMonitors.add(0);
    await startMonitor();
    expect(monitor.active).toBe(true);
  });

  it('re-evaluates when the require-inhibitor setting changes', async () => {
    display.fullscreenMonitors.add(0);
    await startMonitor();
    expect(monitor.active).toBe(false);

    settings.set('fullscreen-require-inhibitor', false);
    jest.advanceTimersByTime(300);
    expect(monitor.active).toBe(true);
  });

  it('falls back to fullscreen-only when the session manager is unavailable', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    inhibitor = createInhibitor({ fail: true });
    display.fullscreenMonitors.add(0);
    await startMonitor();
    expect(monitor.active).toBe(true);
  });

  it('debounces brief fullscreen toggles', async () => {
    inhibitor.idleInhibited = true;
    await startMonitor();

    display.fullscreenMonitors.add(0);
    display.emit('in-fullscreen-changed');
    jest.advanceTimersByTime(200);
    display.fullscreenMonitors.delete(0);
    display.emit('in-fullscreen-changed');
    jest.advanceTimersByTime(300);

    expect(monitor.active).toBe(false);
    expect(changes).toEqual([]);
  });

  it('disconnects everything on destroy', async () => {
    await startMonitor();
    display.fullscreenMonitors.add(0);
    inhibitor.idleInhibited = true;
    display.emit('in-fullscreen-changed');

    monitor.destroy();
    jest.advanceTimersByTime(1000);

    expect(display.handlerCount).toBe(0);
    expect(inhibitor.destroy).toHaveBeenCalled();
    expect(changes).toEqual([]);
  });
});
