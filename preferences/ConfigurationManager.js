import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

export class ConfigurationManager {
  constructor(settings, refreshBucketsCallback, gettext = (x) => x) {
    this.settings = settings;
    this.refreshBuckets = refreshBucketsCallback;
    this._ = gettext;
  }

  exportConfiguration(window) {
    const config = {
      'brightness-buckets': [],
      'keyboard-backlight-levels': [],
      'keyboard-idle-timeout': this.settings.get_uint('keyboard-idle-timeout'),
    };

    const bucketsVariant = this.settings.get_value('brightness-buckets');
    for (let i = 0; i < bucketsVariant.n_children(); i++) {
      const tuple = bucketsVariant.get_child_value(i);
      config['brightness-buckets'].push([
        tuple.get_child_value(0).get_uint32(),
        tuple.get_child_value(1).get_uint32(),
        tuple.get_child_value(2).get_double(),
      ]);
    }

    const keyboardVariant = this.settings.get_value('keyboard-backlight-levels');
    for (let i = 0; i < keyboardVariant.n_children(); i++) {
      config['keyboard-backlight-levels'].push(keyboardVariant.get_child_value(i).get_uint32());
    }

    const dialog = new Gtk.FileChooserDialog({
      title: this._('Export Configuration'),
      action: Gtk.FileChooserAction.SAVE,
      transient_for: window,
      modal: true,
    });

    dialog.add_button(this._('Cancel'), Gtk.ResponseType.CANCEL);
    dialog.add_button(this._('Export'), Gtk.ResponseType.ACCEPT);

    dialog.set_current_name('adaptive-brightness-config.json');

    const filter = new Gtk.FileFilter();
    filter.set_name(this._('JSON files'));
    filter.add_mime_type('application/json');
    filter.add_pattern('*.json');
    dialog.add_filter(filter);

    dialog.connect('response', (dialog, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        const file = dialog.get_file();
        const path = file.get_path();

        try {
          const jsonStr = JSON.stringify(config);
          GLib.file_set_contents(path, jsonStr);
        } catch (e) {
          this._showErrorDialog(
            window,
            this._('Export Error'),
            this._('Failed to export: %s').format(e.message)
          );
        }
      }
      dialog.destroy();
    });

    dialog.show();
  }

  importConfiguration(window) {
    const dialog = new Gtk.FileChooserDialog({
      title: this._('Import Configuration'),
      action: Gtk.FileChooserAction.OPEN,
      transient_for: window,
      modal: true,
    });

    dialog.add_button(this._('Cancel'), Gtk.ResponseType.CANCEL);
    dialog.add_button(this._('Import'), Gtk.ResponseType.ACCEPT);

    const filter = new Gtk.FileFilter();
    filter.set_name(this._('JSON files'));
    filter.add_mime_type('application/json');
    filter.add_pattern('*.json');
    dialog.add_filter(filter);

    dialog.connect('response', (dialog, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        const file = dialog.get_file();
        const path = file.get_path();

        try {
          const [success, contents] = GLib.file_get_contents(path);
          if (!success) {
            this._showErrorDialog(
              window,
              this._('Import Failed'),
              this._('Failed to read the selected file.')
            );
            dialog.destroy();
            return;
          }

          const jsonStr = new TextDecoder().decode(contents);
          const config = JSON.parse(jsonStr);

          if (!this._validateConfiguration(config, window)) {
            dialog.destroy();
            return;
          }

          const bucketsVariant = new GLib.Variant('a(uud)', config['brightness-buckets']);
          this.settings.set_value('brightness-buckets', bucketsVariant);

          if (
            config['keyboard-backlight-levels'] &&
            Array.isArray(config['keyboard-backlight-levels'])
          ) {
            const keyboardVariant = new GLib.Variant('au', config['keyboard-backlight-levels']);
            this.settings.set_value('keyboard-backlight-levels', keyboardVariant);
          }

          if (typeof config['keyboard-idle-timeout'] === 'number') {
            this.settings.set_uint('keyboard-idle-timeout', config['keyboard-idle-timeout']);
          }

          this.refreshBuckets();
        } catch (e) {
          this._showErrorDialog(
            window,
            this._('Import Error'),
            this._('Failed to import configuration: %s').format(e.message)
          );
        }
      }
      dialog.destroy();
    });

    dialog.show();
  }

  _validateConfiguration(config, window) {
    if (!config['brightness-buckets'] || !Array.isArray(config['brightness-buckets'])) {
      this._showErrorDialog(
        window,
        this._('Invalid Configuration'),
        this._('Missing or invalid brightness-buckets array.')
      );
      return false;
    }

    if (config['brightness-buckets'].length < 5 || config['brightness-buckets'].length > 20) {
      this._showErrorDialog(
        window,
        this._('Invalid Bucket Count'),
        this._('Configuration has %d buckets. Must be between 5 and 20.').format(
          config['brightness-buckets'].length
        )
      );
      return false;
    }

    for (let i = 0; i < config['brightness-buckets'].length; i++) {
      const bucket = config['brightness-buckets'][i];

      if (!Array.isArray(bucket) || bucket.length !== 3) {
        this._showErrorDialog(
          window,
          this._('Invalid Bucket Format'),
          this._('Bucket %d has invalid format. Expected [min, max, brightness] array.').format(
            i + 1
          )
        );
        return false;
      }

      const [min, max, brightness] = bucket;

      if (typeof min !== 'number' || typeof max !== 'number' || typeof brightness !== 'number') {
        this._showErrorDialog(
          window,
          this._('Invalid Bucket Values'),
          this._('Bucket %d contains non-numeric values.').format(i + 1)
        );
        return false;
      }

      if (min < 0 || max > 10000 || min >= max) {
        this._showErrorDialog(
          window,
          this._('Invalid Lux Range'),
          this._('Bucket %d: min=%d, max=%d. Must have 0 ≤ min < max ≤ 10000.').format(
            i + 1,
            min,
            max
          )
        );
        return false;
      }

      if (brightness < 0 || brightness > 1) {
        this._showErrorDialog(
          window,
          this._('Invalid Brightness'),
          this._('Bucket %d: brightness=%f. Must be between 0 and 1.').format(i + 1, brightness)
        );
        return false;
      }

      if (i > 0) {
        const prevBucket = config['brightness-buckets'][i - 1];
        const prevMax = prevBucket[1];

        if (min <= prevBucket[0]) {
          this._showErrorDialog(
            window,
            this._('Invalid Bucket Order'),
            this._('Bucket %d: min values must be strictly increasing.').format(i + 1)
          );
          return false;
        }

        if (max <= prevMax) {
          this._showErrorDialog(
            window,
            this._('Invalid Bucket Order'),
            this._('Bucket %d: max values must be strictly increasing.').format(i + 1)
          );
          return false;
        }

        if (min > prevMax) {
          this._showErrorDialog(
            window,
            this._('Bucket Gap Detected'),
            this._(
              "Bucket %d: min (%d) creates a gap with previous bucket's max (%d). Buckets must overlap or be continuous."
            ).format(i + 1, min, prevMax)
          );
          return false;
        }

        const prevRange = prevMax - prevBucket[0];
        const overlapStart = Math.max(min, prevBucket[0]);
        const overlapEnd = Math.min(max, prevMax);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > prevRange * 0.9) {
          this._showErrorDialog(
            window,
            this._('Excessive Overlap'),
            this._('Bucket %d overlaps too much (>90%%) with previous bucket.').format(i + 1)
          );
          return false;
        }
      }
    }

    if (config['keyboard-backlight-levels']) {
      if (!Array.isArray(config['keyboard-backlight-levels'])) {
        this._showErrorDialog(
          window,
          this._('Invalid Keyboard Settings'),
          this._('keyboard-backlight-levels must be an array.')
        );
        return false;
      }

      if (config['keyboard-backlight-levels'].length !== config['brightness-buckets'].length) {
        this._showErrorDialog(
          window,
          this._('Mismatched Settings'),
          this._('Keyboard backlight levels count must match bucket count.')
        );
        return false;
      }

      for (let i = 0; i < config['keyboard-backlight-levels'].length; i++) {
        const level = config['keyboard-backlight-levels'][i];
        if (!Number.isInteger(level) || level < 0 || level > 10) {
          this._showErrorDialog(
            window,
            this._('Invalid Keyboard Level'),
            this._('Level %d: %d. Must be integer between 0 and 10.').format(i + 1, level)
          );
          return false;
        }
      }
    }

    if (config['keyboard-idle-timeout'] !== undefined) {
      if (
        typeof config['keyboard-idle-timeout'] !== 'number' ||
        config['keyboard-idle-timeout'] < 5 ||
        config['keyboard-idle-timeout'] > 60
      ) {
        this._showErrorDialog(
          window,
          this._('Invalid Timeout'),
          this._('Keyboard idle timeout must be between 5 and 60 seconds.')
        );
        return false;
      }
    }

    return true;
  }

  _showErrorDialog(parent, title, message) {
    const errorDialog = new Adw.MessageDialog({
      transient_for: parent,
      modal: true,
      heading: title,
      body: message,
    });

    errorDialog.add_response(this._('OK'), this._('OK'));
    errorDialog.set_default_response(this._('OK'));
    errorDialog.set_close_response(this._('OK'));

    errorDialog.show();
  }
}
