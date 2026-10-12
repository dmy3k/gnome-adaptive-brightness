import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { CallbackManager } from './CallbackManager.js';
import { SessionInhibitorDbus } from './SessionInhibitorDbus.js';

// Absorbs apps that briefly toggle fullscreen or release the inhibitor between videos.
const DEBOUNCE_MS = 300;

/**
 * Detects fullscreen video: a fullscreen window on the primary monitor,
 * optionally combined with a session idle inhibitor being held.
 */
export class VideoPlaybackMonitor {
  constructor(settings, inhibitor = new SessionInhibitorDbus()) {
    this._settings = settings;
    this._inhibitor = inhibitor;
    this._inhibitorAvailable = false;
    this._fullscreenSignalId = null;
    this._monitorsSignalId = null;
    this._settingSignalId = null;
    this._inhibitorCallbackId = null;
    this._debounceId = null;
    this.active = false;
    this.onActiveChanged = new CallbackManager();
  }

  /** Never rejects: the feature is optional and must not block the extension. */
  async start() {
    this._fullscreenSignalId = global.display.connect('in-fullscreen-changed', () =>
      this._scheduleEvaluate()
    );
    this._monitorsSignalId = Main.layoutManager.connect('monitors-changed', () =>
      this._scheduleEvaluate()
    );
    this._settingSignalId = this._settings.connect('changed::fullscreen-require-inhibitor', () =>
      this._scheduleEvaluate()
    );

    try {
      await this._inhibitor.connect();
      this._inhibitorAvailable = true;
      this._inhibitorCallbackId = this._inhibitor.onIdleInhibitedChanged.add(() =>
        this._scheduleEvaluate()
      );
    } catch (error) {
      console.error('[VideoPlaybackMonitor] Session inhibitors unavailable:', error);
    }

    this._evaluate();
  }

  _isFullscreen() {
    return global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex);
  }

  _isVideoPlaying() {
    if (!this._isFullscreen()) {
      return false;
    }
    // Without a session manager the inhibitor can't be required.
    if (!this._inhibitorAvailable || !this._settings.get_boolean('fullscreen-require-inhibitor')) {
      return true;
    }
    return this._inhibitor.idleInhibited;
  }

  _scheduleEvaluate() {
    this._cancelDebounce();
    this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
      this._debounceId = null;
      this._evaluate();
      return GLib.SOURCE_REMOVE;
    });
  }

  _evaluate() {
    const active = this._isVideoPlaying();
    if (active !== this.active) {
      this.active = active;
      this.onActiveChanged.invoke(active);
    }
  }

  _cancelDebounce() {
    if (this._debounceId !== null) {
      GLib.source_remove(this._debounceId);
      this._debounceId = null;
    }
  }

  destroy() {
    this._cancelDebounce();

    if (this._fullscreenSignalId !== null) {
      global.display?.disconnect(this._fullscreenSignalId);
      this._fullscreenSignalId = null;
    }
    if (this._monitorsSignalId !== null) {
      Main.layoutManager?.disconnect(this._monitorsSignalId);
      this._monitorsSignalId = null;
    }
    if (this._settingSignalId !== null) {
      this._settings?.disconnect(this._settingSignalId);
      this._settingSignalId = null;
    }
    if (this._inhibitorCallbackId !== null) {
      this._inhibitor.onIdleInhibitedChanged.remove(this._inhibitorCallbackId);
      this._inhibitorCallbackId = null;
    }

    this._inhibitor.destroy();
    this.onActiveChanged.clear();
    this._settings = null;
    this.active = false;
  }
}
