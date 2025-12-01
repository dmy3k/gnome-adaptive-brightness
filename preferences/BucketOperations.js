import { BucketMapper } from '../lib/BucketMapper.js';

const PRESET_BUCKETS = [
  { min: 0, max: 20, brightness: 0.15 },
  { min: 5, max: 200, brightness: 0.25 },
  { min: 50, max: 650, brightness: 0.5 },
  { min: 350, max: 2000, brightness: 0.75 },
  { min: 1000, max: 10000, brightness: 1.0 },
];

export class BucketOperations {
  constructor(settings) {
    this.settings = settings;
  }

  generateBucketName(minLux, maxLux, brightness = 0.5) {
    // Use evocative time-of-day and scenario-based names
    if (maxLux <= 10) return brightness < 0.3 ? 'Deep Sleep' : 'Night Reading';
    if (maxLux <= 50) return brightness < 0.4 ? 'Moonlight' : 'Dawn/Dusk';
    if (maxLux <= 200) return brightness < 0.5 ? 'Early Morning' : 'Cloudy Day';
    if (maxLux <= 500) return brightness < 0.6 ? 'Shaded Room' : 'Office Space';
    if (maxLux <= 1000) return brightness < 0.7 ? 'Well-Lit Room' : 'Bright Office';
    if (maxLux <= 2500) return brightness < 0.8 ? 'Window Seat' : 'Near Window';
    if (maxLux <= 5000) return brightness < 0.9 ? 'Overcast Outside' : 'Indirect Sunlight';
    return brightness < 0.95 ? 'Sunny Day' : 'Direct Sunlight';
  }

  generateBucketPreset() {
    return PRESET_BUCKETS.map((b) => ({
      ...b,
      name: this.generateBucketName(b.min, b.max, b.brightness),
    }));
  }

  applyBucketPreset(updateCallback) {
    const buckets = this.generateBucketPreset();
    this.saveBucketsToSettings(buckets);
    this.syncKeyboardBacklightLevels(buckets.length);

    if (updateCallback) {
      updateCallback(new BucketMapper(buckets));
    }

    return buckets;
  }

  resetBuckets(updateCallback) {
    return this.applyBucketPreset(updateCallback);
  }

  saveBucketsToSettings(buckets) {
    const GLib = imports.gi.GLib;
    const tuples = buckets.map((b) => [b.min, b.max, b.brightness]);
    const variant = new GLib.Variant('a(uud)', tuples);
    this.settings.set_value('brightness-buckets', variant);
  }

  syncKeyboardBacklightLevels(newBucketCount) {
    const GLib = imports.gi.GLib;

    const keyboardLevelsVariant = this.settings.get_value('keyboard-backlight-levels');
    const levels = [];
    for (let i = 0; i < keyboardLevelsVariant.n_children(); i++) {
      levels.push(keyboardLevelsVariant.get_child_value(i).get_uint32());
    }

    while (levels.length < newBucketCount) {
      levels.push(0);
    }
    while (levels.length > newBucketCount) {
      levels.pop();
    }

    const variant = new GLib.Variant('au', levels);
    this.settings.set_value('keyboard-backlight-levels', variant);
  }

  loadBucketsFromSettings() {
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
    return buckets;
  }
}
