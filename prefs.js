import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AdaptiveBrightnessPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    // Create a preferences page
    const page = new Adw.PreferencesPage({
      title: 'General',
      icon_name: 'preferences-system-symbolic',
    });
    window.add(page);

    // Create a brightness preference group with explanation
    const brightnessGroup = new Adw.PreferencesGroup({
      title: 'Brightness Adjustment',
      description:
        'Brightness adapts automatically to ambient light. Manual adjustments are learned and applied across all light levels. To reset, use the "Reset" button in the notification.',
    });
    page.add(brightnessGroup);

    // Create a keyboard backlight group
    const keyboardGroup = new Adw.PreferencesGroup({
      title: 'Keyboard Backlight',
    });
    page.add(keyboardGroup);

    // Create a switch row for auto keyboard backlight
    const autoKeyboardRow = new Adw.SwitchRow({
      title: 'Automatic Keyboard Backlight',
      subtitle: 'Turn on keyboard backlight in low light conditions',
    });
    keyboardGroup.add(autoKeyboardRow);

    // Bind the switch to the setting
    settings.bind(
      'auto-keyboard-backlight',
      autoKeyboardRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    );

    // Create a spin row for idle timeout
    const idleTimeoutRow = new Adw.SpinRow({
      title: 'Idle Timeout',
      subtitle: 'Turn off keyboard backlight after inactivity (seconds)',
      adjustment: new Gtk.Adjustment({
        lower: 5,
        upper: 60,
        step_increment: 5,
        page_increment: 10,
      }),
    });
    keyboardGroup.add(idleTimeoutRow);

    // Bind the spin row to the setting
    settings.bind('keyboard-idle-timeout', idleTimeoutRow, 'value', Gio.SettingsBindFlags.DEFAULT);
  }
}
