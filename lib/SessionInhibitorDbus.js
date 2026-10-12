import Gio from 'gi://Gio';
import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';
import { CallbackManager } from './CallbackManager.js';

const BUS_NAME = 'org.gnome.SessionManager';
const OBJECT_PATH = '/org/gnome/SessionManager';
const INHIBIT_IDLE = 8;

// Caffeine holds an idle inhibitor regardless of video playback.
const DEFAULT_IGNORED_APP_IDS = ['caffeine-gnome-extension'];

// Shell's bundled SessionManager XML lacks GetInhibitors and InhibitedActions.
const SESSION_MANAGER_XML = `<node>
<interface name="org.gnome.SessionManager">
    <method name="GetInhibitors">
        <arg type="ao" direction="out"/>
    </method>
    <property name="InhibitedActions" type="u" access="read"/>
    <signal name="InhibitorAdded">
        <arg type="o"/>
    </signal>
    <signal name="InhibitorRemoved">
        <arg type="o"/>
    </signal>
</interface>
</node>`;

/**
 * Tracks whether any application holds a session idle inhibitor,
 * which media players and browsers do while a video is playing.
 */
export class SessionInhibitorDbus {
  constructor(ignoredAppIds = DEFAULT_IGNORED_APP_IDS) {
    this._ignoredAppIds = new Set(ignoredAppIds);
    this._proxy = null;
    this._InhibitorProxy = null;
    this._signalIds = [];
    this._generation = 0;
    this.idleInhibited = false;
    this.onIdleInhibitedChanged = new CallbackManager();
  }

  async connect() {
    const SessionManagerProxy = Gio.DBusProxy.makeProxyWrapper(SESSION_MANAGER_XML);
    this._InhibitorProxy = Gio.DBusProxy.makeProxyWrapper(
      FileUtils.loadInterfaceXML('org.gnome.SessionManager.Inhibitor')
    );

    this._proxy = await SessionManagerProxy.newAsync(Gio.DBus.session, BUS_NAME, OBJECT_PATH);

    const refresh = () => this._refresh();
    this._signalIds.push(this._proxy.connect('g-properties-changed', refresh));
    this._signalIds.push(this._proxy.connectSignal('InhibitorAdded', refresh));
    this._signalIds.push(this._proxy.connectSignal('InhibitorRemoved', refresh));

    await this._refresh();
  }

  async _refresh() {
    const generation = ++this._generation;
    const inhibited =
      (this._proxy.InhibitedActions & INHIBIT_IDLE) !== 0 &&
      (await this._hasRelevantIdleInhibitor());

    // A newer refresh started while awaiting, or we were destroyed.
    if (generation !== this._generation || !this._proxy) {
      return;
    }

    if (inhibited !== this.idleInhibited) {
      this.idleInhibited = inhibited;
      this.onIdleInhibitedChanged.invoke(inhibited);
    }
  }

  async _hasRelevantIdleInhibitor() {
    let paths;
    try {
      [paths] = await this._proxy.GetInhibitorsAsync();
    } catch (error) {
      // The bitmask already says an idle inhibitor exists; can't tell whose it is.
      console.error('[SessionInhibitorDbus] GetInhibitors failed:', error);
      return true;
    }

    const results = await Promise.all(paths.map((path) => this._isRelevantIdleInhibitor(path)));
    return results.some(Boolean);
  }

  async _isRelevantIdleInhibitor(path) {
    try {
      const inhibitor = await this._InhibitorProxy.newAsync(Gio.DBus.session, BUS_NAME, path);
      const [[appId], [flags]] = await Promise.all([
        inhibitor.GetAppIdAsync(),
        inhibitor.GetFlagsAsync(),
      ]);
      return (flags & INHIBIT_IDLE) !== 0 && !this._ignoredAppIds.has(appId);
    } catch {
      // Inhibitor was released between listing and querying.
      return false;
    }
  }

  destroy() {
    this._generation++;
    this.onIdleInhibitedChanged.clear();
    for (const id of this._signalIds) {
      this._proxy?.disconnect(id);
    }
    this._signalIds = [];
    this._proxy = null;
    this._InhibitorProxy = null;
  }
}
