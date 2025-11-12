import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

/**
 * Service for managing desktop notifications
 */
export class NotificationService {
  constructor() {
    this._source = null;
    this._currentNotification = null;
  }

  /**
   * Show a notification with optional action, replacing any previous notification
   * @param {string} title - Notification title
   * @param {string} body - Notification body text
   * @param {Object} options - Options object
   * @param {boolean} options.transient - Whether notification should auto-dismiss (default: true)
   * @param {Function} options.onActivate - Callback when notification is clicked
   * @param {Function} options.onDestroy - Callback when notification is destroyed/dismissed
   * @param {Object} options.action - Action button configuration
   * @param {string} options.action.label - Action button label
   * @param {Function} options.action.callback - Action button callback
   */
  showNotification(title, body, options = {}) {
    try {
      // Destroy previous notification if it exists
      if (this._currentNotification) {
        this._currentNotification.destroy();
        this._currentNotification = null;
      }

      // Create or recreate source if needed
      if (!this._source || this._source._delegate?.isDestroyed) {
        if (this._source) {
          this._source.destroy();
        }

        this._source = new MessageTray.Source({
          title: 'Adaptive Brightness',
          iconName: 'display-brightness-symbolic',
        });

        // Handle source destruction by GNOME
        this._source.connect('destroy', () => {
          this._source = null;
          this._currentNotification = null;
        });

        Main.messageTray.add(this._source);
      }

      // Create new notification
      this._currentNotification = new MessageTray.Notification({
        source: this._source,
        title: title,
        body: body,
      });

      this._currentNotification.urgency = options.transient
        ? MessageTray.Urgency.LOW
        : MessageTray.Urgency.NORMAL;

      // Make notification transient (auto-dismiss) by default
      this._currentNotification.isTransient = options.transient !== false;

      // Add activation callback if provided
      if (options.onActivate) {
        this._currentNotification.connect('activated', () => {
          try {
            options.onActivate();
          } catch (e) {
            console.error('Failed to execute activation callback:', e);
          }
        });
      }

      // Add action if provided
      if (options.action) {
        this._currentNotification.addAction(options.action.label, () => {
          try {
            options.action.callback();
          } catch (e) {
            console.error('Failed to execute action callback:', e);
          }
        });
      }

      // Clean up reference when notification is destroyed
      this._currentNotification.connect('destroy', () => {
        // Call onDestroy callback if provided
        if (options.onDestroy) {
          try {
            options.onDestroy();
          } catch (e) {
            console.error('Failed to execute destroy callback:', e);
          }
        }
        this._currentNotification = null;
      });

      this._source.addNotification(this._currentNotification);
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  }

  clearNotification() {
    if (this._currentNotification) {
      try {
        this._currentNotification.destroy();
      } catch (e) {
        // Notification may already be destroyed
      }
      this._currentNotification = null;
    }
  }

  destroy() {
    this.clearNotification();

    if (this._source) {
      try {
        this._source.destroy();
      } catch (e) {
        // Source may already be destroyed by GNOME
      }
      this._source = null;
    }
  }
}
