import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export class KeyboardBacklightTab {
  constructor(settings, generateBucketNameCallback) {
    this.settings = settings;
    this.generateBucketName = generateBucketNameCallback;
    this.keyboardGroup = null;
    this.keyboardDropdowns = [];
    this.kbdBrightnessProxy = null;
  }

  setKeyboardBrightnessProxy(proxy) {
    this.kbdBrightnessProxy = proxy;
  }

  createPage(window, buckets) {
    const page = new Adw.PreferencesPage({
      title: 'Keyboard',
      icon_name: 'input-keyboard-symbolic',
    });
    window.add(page);

    this.keyboardGroup = new Adw.PreferencesGroup({
      title: 'Automatic Keyboard Backlight',
      description:
        'Select keyboard backlight level for each brightness range. Set to "Off" to disable backlight for that range.',
    });
    page.add(this.keyboardGroup);

    this.rebuildKeyboardRows(buckets);

    const timeoutGroup = new Adw.PreferencesGroup({});
    page.add(timeoutGroup);

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
    timeoutGroup.add(idleTimeoutRow);

    this.settings.bind(
      'keyboard-idle-timeout',
      idleTimeoutRow,
      'value',
      Gio.SettingsBindFlags.DEFAULT
    );

    return page;
  }

  rebuildKeyboardRows(buckets) {
    if (!this.keyboardGroup) return;

    if (this.keyboardDropdowns) {
      this.keyboardDropdowns.forEach((item) => {
        this.keyboardGroup.remove(item.comboRow);
      });
    }

    const keyboardLevelsVariant = this.settings.get_value('keyboard-backlight-levels');
    const backlightLevels = [];
    for (let i = 0; i < keyboardLevelsVariant.n_children(); i++) {
      backlightLevels.push(keyboardLevelsVariant.get_child_value(i).get_uint32());
    }

    const availableLevels = this.kbdBrightnessProxy?.Steps;

    this.keyboardDropdowns = [];
    buckets.forEach((bucket, index) => {
      const currentLevel = backlightLevels[index] ?? 0;

      const comboRow = new Adw.ComboRow({
        title: bucket.name,
      });

      const model = new Gtk.StringList();
      for (let level = 1; level <= availableLevels; level++) {
        if (level === 1) {
          model.append('Off');
        } else if (availableLevels === 2) {
          model.append('On');
        } else if (availableLevels === 3) {
          model.append(level === 2 ? 'Low' : 'High');
        } else {
          if (level === 2) {
            model.append('Low');
          } else if (level === availableLevels) {
            model.append('High');
          } else {
            model.append(`Medium${availableLevels > 3 ? ' ' + level : ''}`);
          }
        }
      }

      comboRow.set_model(model);
      comboRow.set_selected(currentLevel);

      comboRow.connect('notify::selected', () => {
        this.saveKeyboardBacklightLevels();
      });

      this.keyboardDropdowns.push({ comboRow, bucketIndex: index });
      this.keyboardGroup.add(comboRow);
    });
  }

  updateKeyboardTab() {
    const bucketsVariant = this.settings.get_value('brightness-buckets');
    const buckets = [];
    for (let i = 0; i < bucketsVariant.n_children(); i++) {
      const tuple = bucketsVariant.get_child_value(i);
      const min = tuple.get_child_value(0).get_uint32();
      const max = tuple.get_child_value(1).get_uint32();
      const brightness = tuple.get_child_value(2).get_double();
      buckets.push({
        name: this.generateBucketName(min, max, brightness),
        min: min,
        max: max,
        brightness: brightness,
      });
    }

    this.rebuildKeyboardRows(buckets);
  }

  saveKeyboardBacklightLevels() {
    const levels = this.keyboardDropdowns.map((item) => item.comboRow.get_selected());

    const variant = new GLib.Variant('au', levels);
    this.settings.set_value('keyboard-backlight-levels', variant);
  }
}
