import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

const INVALID_LIST_POSITION = 0xffffffff;

export class FullscreenVideoGroup {
  constructor(settings, generateBucketNameCallback, gettext = (x) => x) {
    this.settings = settings;
    this.generateBucketName = generateBucketNameCallback;
    this._ = gettext;
    this.group = null;
    this.bucketRow = null;
    this._selectedHandlerId = null;
  }

  createGroup() {
    this.group = new Adw.PreferencesGroup({
      title: this._('Fullscreen Video'),
      description: this._(
        'Use a fixed brightness level while a video is playing fullscreen on the primary monitor.'
      ),
    });

    this.bucketRow = new Adw.ComboRow({
      title: this._('Brightness Level'),
      subtitle: this._('Automatic adjustment resumes when fullscreen ends'),
    });
    this.group.add(this.bucketRow);

    const inhibitorRow = new Adw.SwitchRow({
      title: this._('Require Active Playback'),
      subtitle: this._(
        'Only when an app prevents the screen from idling, as players and browsers do while playing. Turn off to apply to any fullscreen window.'
      ),
    });
    this.group.add(inhibitorRow);
    this.settings.bind(
      'fullscreen-require-inhibitor',
      inhibitorRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    );

    this.rebuild();
    return this.group;
  }

  rebuild() {
    if (!this.bucketRow) return;

    if (this._selectedHandlerId !== null) {
      this.bucketRow.disconnect(this._selectedHandlerId);
      this._selectedHandlerId = null;
    }

    const bucketsVariant = this.settings.get_value('brightness-buckets');
    const model = new Gtk.StringList();
    model.append(this._('Disabled'));
    for (let i = 0; i < bucketsVariant.n_children(); i++) {
      const tuple = bucketsVariant.get_child_value(i);
      const brightness = tuple.get_child_value(2).get_double();
      model.append(`${Math.round(brightness * 100)}%`);
    }
    this.bucketRow.set_model(model);

    // Index outside the bucket list is treated as disabled by the extension.
    const index = this.settings.get_int('fullscreen-brightness-bucket');
    const selected = index >= 0 && index < bucketsVariant.n_children() ? index + 1 : 0;
    this.bucketRow.set_selected(selected);

    this._selectedHandlerId = this.bucketRow.connect('notify::selected', () => {
      const position = this.bucketRow.get_selected();
      // Emitted with an invalid position while the model is being replaced or disposed.
      if (position === INVALID_LIST_POSITION) return;
      this.settings.set_int('fullscreen-brightness-bucket', position - 1);
    });
  }

  destroy() {
    if (this._selectedHandlerId !== null) {
      this.bucketRow?.disconnect(this._selectedHandlerId);
      this._selectedHandlerId = null;
    }
  }
}
