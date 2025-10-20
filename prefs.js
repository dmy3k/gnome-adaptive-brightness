import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Preferences window for Adaptive Brightness extension
 * Follows GNOME Human Interface Guidelines
 */
export default class AdaptiveBrightnessPreferences extends ExtensionPreferences {
  /**
   * Fill the preferences window with settings
   * @param {Adw.PreferencesWindow} window - The preferences window
   */
  fillPreferencesWindow(window) {
    // Get the settings object
    const settings = this.getSettings();

    // Create a preferences page
    const page = new Adw.PreferencesPage({
      title: 'General',
      icon_name: 'preferences-system-symbolic',
    });
    window.add(page);

    // Create a preferences group for keyboard backlight
    const keyboardGroup = new Adw.PreferencesGroup({
      title: 'Keyboard Backlight',
      description: 'Automatic keyboard backlight control based on ambient light',
    });
    page.add(keyboardGroup);

    // Create a switch row for auto keyboard backlight
    const autoKeyboardRow = new Adw.SwitchRow({
      title: 'Automatic Keyboard Backlight',
      subtitle: 'Enable keyboard backlight in low light conditions',
      icon_name: 'keyboard-brightness-symbolic',
    });
    keyboardGroup.add(autoKeyboardRow);

    // Bind the switch to the setting
    settings.bind(
      'auto-keyboard-backlight',
      autoKeyboardRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    );
  }
}
