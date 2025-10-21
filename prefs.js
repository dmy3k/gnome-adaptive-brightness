import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
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

    // Create a single preferences group for all settings
    const generalGroup = new Adw.PreferencesGroup({
      title: 'Brightness Adjustment',
      description:
        'Manually adjust brightness to set your preference. It will be learned and applied consistently across all lighting conditions',
    });
    page.add(generalGroup);

    // Create a row showing learned brightness preference with reset option
    const biasRatio = settings.get_double('brightness-bias-ratio');
    const biasRow = new Adw.ActionRow({
      title: 'Learned Brightness Preference',
      subtitle: this._getBiasSubtitle(biasRatio),
    });

    const resetButton = new Gtk.Button({
      label: 'Reset',
      valign: Gtk.Align.CENTER,
    });
    resetButton.add_css_class('destructive-action');

    resetButton.connect('clicked', () => {
      settings.set_double('brightness-bias-ratio', 1.0);
    });

    // Update subtitle when bias ratio changes
    settings.connect('changed::brightness-bias-ratio', () => {
      const newBiasRatio = settings.get_double('brightness-bias-ratio');
      biasRow.subtitle = this._getBiasSubtitle(newBiasRatio);
    });

    biasRow.add_suffix(resetButton);
    biasRow.activatable_widget = resetButton;
    generalGroup.add(biasRow);

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

  _getBiasSubtitle(biasRatio) {
    const ratio = biasRatio.toFixed(2);
    if (Math.abs(biasRatio - 1.0) < 0.01) {
      return `Neutral (${ratio}×) — Manually adjust brightness to learn your preference`;
    } else if (biasRatio < 1.0) {
      return `${ratio}× preference — Consistently dimmer across all light levels`;
    } else {
      return `${ratio}× preference — Consistently brighter across all light levels`;
    }
  }
}
