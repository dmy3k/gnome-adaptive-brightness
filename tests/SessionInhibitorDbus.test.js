import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SessionInhibitorDbus } from '../lib/SessionInhibitorDbus.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeInhibitorProxyClass(table) {
  return class FakeInhibitorProxy {
    static async newAsync(bus, name, path) {
      if (!table[path]) throw new Error('gone');
      return new FakeInhibitorProxy(table[path]);
    }
    constructor(info) {
      this._info = info;
    }
    async GetAppIdAsync() {
      return [this._info.appId];
    }
    async GetFlagsAsync() {
      return [this._info.flags];
    }
  };
}

describe('SessionInhibitorDbus', () => {
  let dbus;
  let changes;

  async function setInhibitors(actions, paths, table) {
    dbus._InhibitorProxy = fakeInhibitorProxyClass(table);
    dbus._proxy._setMockMethodReturnValue('GetInhibitors', [paths]);
    dbus._proxy.InhibitedActions = actions;
    dbus._proxy.emit('g-properties-changed');
    await flush();
  }

  beforeEach(async () => {
    dbus = new SessionInhibitorDbus();
    changes = [];
    await dbus.connect();
    dbus.onIdleInhibitedChanged.add((v) => changes.push(v));
  });

  afterEach(() => {
    dbus.destroy();
    jest.restoreAllMocks();
  });

  it('starts as not inhibited', () => {
    expect(dbus.idleInhibited).toBe(false);
  });

  it('reports idle inhibited when an app holds an idle inhibitor', async () => {
    await setInhibitors(8, ['/i/1'], { '/i/1': { appId: 'firefox', flags: 8 } });

    expect(dbus.idleInhibited).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('reports not inhibited when InhibitedActions has no idle bit', async () => {
    await setInhibitors(4, ['/i/1'], { '/i/1': { appId: 'firefox', flags: 4 } });

    expect(dbus.idleInhibited).toBe(false);
    expect(changes).toEqual([]);
  });

  it('ignores Caffeine inhibitors', async () => {
    await setInhibitors(8, ['/i/1'], {
      '/i/1': { appId: 'caffeine-gnome-extension', flags: 8 },
    });

    expect(dbus.idleInhibited).toBe(false);
  });

  it('counts a real inhibitor alongside an ignored one', async () => {
    await setInhibitors(8, ['/i/1', '/i/2'], {
      '/i/1': { appId: 'caffeine-gnome-extension', flags: 8 },
      '/i/2': { appId: 'mutter', flags: 8 },
    });

    expect(dbus.idleInhibited).toBe(true);
  });

  it('treats an inhibitor released mid-query as absent', async () => {
    await setInhibitors(8, ['/i/gone'], {});

    expect(dbus.idleInhibited).toBe(false);
  });

  it('falls back to the bitmask when GetInhibitors fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    dbus._proxy._setMockMethodError('GetInhibitors', new Error('boom'));
    dbus._proxy.InhibitedActions = 8;
    dbus._proxy.emit('g-properties-changed');
    await flush();

    expect(dbus.idleInhibited).toBe(true);
  });

  it('clears when the inhibitor is removed', async () => {
    await setInhibitors(8, ['/i/1'], { '/i/1': { appId: 'mpv', flags: 8 } });
    await setInhibitors(0, [], {});

    expect(dbus.idleInhibited).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('refreshes on InhibitorAdded signal', async () => {
    dbus._InhibitorProxy = fakeInhibitorProxyClass({ '/i/1': { appId: 'mpv', flags: 8 } });
    dbus._proxy._setMockMethodReturnValue('GetInhibitors', [['/i/1']]);
    dbus._proxy.InhibitedActions = 8;
    dbus._proxy.emitSignal('InhibitorAdded', '/i/1');
    await flush();

    expect(dbus.idleInhibited).toBe(true);
  });

  it('stops notifying after destroy', async () => {
    const proxy = dbus._proxy;
    dbus.destroy();
    proxy.emit('g-properties-changed');
    await flush();

    expect(changes).toEqual([]);
  });
});
