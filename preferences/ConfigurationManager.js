import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

export class ConfigurationManager {
  constructor(settings, refreshBucketsCallback) {
    this.settings = settings;
    this.refreshBuckets = refreshBucketsCallback;
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
      title: 'Export Configuration',
      action: Gtk.FileChooserAction.SAVE,
      transient_for: window,
      modal: true,
    });

    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Export', Gtk.ResponseType.ACCEPT);

    dialog.set_current_name('adaptive-brightness-config.json');

    const filter = new Gtk.FileFilter();
    filter.set_name('JSON files');
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
          this._showErrorDialog(window, 'Export Error', `Failed to export: ${e.message}`);
        }
      }
      dialog.destroy();
    });

    dialog.show();
  }

  importConfiguration(window) {
    const dialog = new Gtk.FileChooserDialog({
      title: 'Import Configuration',
      action: Gtk.FileChooserAction.OPEN,
      transient_for: window,
      modal: true,
    });

    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Import', Gtk.ResponseType.ACCEPT);

    const filter = new Gtk.FileFilter();
    filter.set_name('JSON files');
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
            this._showErrorDialog(window, 'Import Failed', 'Failed to read the selected file.');
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
            'Import Error',
            `Failed to import configuration: ${e.message}`
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
        'Invalid Configuration',
        'Missing or invalid brightness-buckets array.'
      );
      return false;
    }

    if (config['brightness-buckets'].length < 5 || config['brightness-buckets'].length > 20) {
      this._showErrorDialog(
        window,
        'Invalid Bucket Count',
        `Configuration has ${config['brightness-buckets'].length} buckets. Must be between 5 and 20.`
      );
      return false;
    }

    for (let i = 0; i < config['brightness-buckets'].length; i++) {
      const bucket = config['brightness-buckets'][i];

      if (!Array.isArray(bucket) || bucket.length !== 3) {
        this._showErrorDialog(
          window,
          'Invalid Bucket Format',
          `Bucket ${i + 1} has invalid format. Expected [min, max, brightness] array.`
        );
        return false;
      }

      const [min, max, brightness] = bucket;

      if (typeof min !== 'number' || typeof max !== 'number' || typeof brightness !== 'number') {
        this._showErrorDialog(
          window,
          'Invalid Bucket Values',
          `Bucket ${i + 1} contains non-numeric values.`
        );
        return false;
      }

      if (min < 0 || max > 10000 || min >= max) {
        this._showErrorDialog(
          window,
          'Invalid Lux Range',
          `Bucket ${i + 1}: min=${min}, max=${max}. Must have 0 ≤ min < max ≤ 10000.`
        );
        return false;
      }

      if (brightness < 0 || brightness > 1) {
        this._showErrorDialog(
          window,
          'Invalid Brightness',
          `Bucket ${i + 1}: brightness=${brightness}. Must be between 0 and 1.`
        );
        return false;
      }

      if (i > 0) {
        const prevBucket = config['brightness-buckets'][i - 1];
        const prevMax = prevBucket[1];

        if (min <= prevBucket[0]) {
          this._showErrorDialog(
            window,
            'Invalid Bucket Order',
            `Bucket ${i + 1}: min values must be strictly increasing.`
          );
          return false;
        }

        if (max <= prevMax) {
          this._showErrorDialog(
            window,
            'Invalid Bucket Order',
            `Bucket ${i + 1}: max values must be strictly increasing.`
          );
          return false;
        }

        if (min > prevMax) {
          this._showErrorDialog(
            window,
            'Bucket Gap Detected',
            `Bucket ${
              i + 1
            }: min (${min}) creates a gap with previous bucket's max (${prevMax}). Buckets must overlap or be continuous.`
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
            'Excessive Overlap',
            `Bucket ${i + 1} overlaps too much (>90%) with previous bucket.`
          );
          return false;
        }
      }
    }

    if (config['keyboard-backlight-levels']) {
      if (!Array.isArray(config['keyboard-backlight-levels'])) {
        this._showErrorDialog(
          window,
          'Invalid Keyboard Settings',
          'keyboard-backlight-levels must be an array.'
        );
        return false;
      }

      if (config['keyboard-backlight-levels'].length !== config['brightness-buckets'].length) {
        this._showErrorDialog(
          window,
          'Mismatched Settings',
          'Keyboard backlight levels count must match bucket count.'
        );
        return false;
      }

      for (let i = 0; i < config['keyboard-backlight-levels'].length; i++) {
        const level = config['keyboard-backlight-levels'][i];
        if (!Number.isInteger(level) || level < 0 || level > 10) {
          this._showErrorDialog(
            window,
            'Invalid Keyboard Level',
            `Level ${i + 1}: ${level}. Must be integer between 0 and 10.`
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
          'Invalid Timeout',
          'Keyboard idle timeout must be between 5 and 60 seconds.'
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

    errorDialog.add_response('ok', 'OK');
    errorDialog.set_default_response('ok');
    errorDialog.set_close_response('ok');

    errorDialog.show();
  }
}
