import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { SensorProxyDbus } from './lib/SensorProxyDbus.js';
import { BucketMapper } from './lib/BucketMapper.js';

export default class AdaptiveBrightnessPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    // Bucket names for UI display
    this.bucketNames = [
      'Night',
      'Very Dark to Dim Indoor',
      'Dim to Normal Indoor',
      'Normal to Bright Indoor',
      'Bright Indoor to Outdoor',
    ];

    // Initialize sensor proxy for live preview
    this.sensorProxy = new SensorProxyDbus();
    this._initSensorProxy();

    // Initialize bucket mapper for hysteresis logic
    this.bucketMapper = null;

    // Clean up on window close
    window.connect('close-request', () => {
      this._cleanupSensorProxy();
      return false;
    });

    // Read buckets from GSettings (shared across pages)
    const bucketsVariant = settings.get_value('brightness-buckets');
    const buckets = [];
    for (let i = 0; i < bucketsVariant.n_children(); i++) {
      const tuple = bucketsVariant.get_child_value(i);
      buckets.push({
        name: this.bucketNames[i] || `Bucket ${i + 1}`,
        min: tuple.get_child_value(0).get_uint32(),
        max: tuple.get_child_value(1).get_uint32(),
        brightness: tuple.get_child_value(2).get_double(),
      });
    }

    // Initialize bucket mapper with current buckets for hysteresis
    this.bucketMapper = new BucketMapper(buckets);

    // Create Calibration page (first/default)
    this._createCalibrationPage(window, settings, buckets);

    // Create Preview page
    this._createInspectorPage(window, settings, buckets);

    // Create Keyboard Backlight page
    this._createKeyboardBacklightPage(window, settings, buckets);
  }

  _createInspectorPage(window, settings, buckets) {
    const page = new Adw.PreferencesPage({
      title: 'Preview',
      icon_name: 'view-reveal-symbolic',
    });
    window.add(page);

    // Create a graph preview group at the top
    const graphGroup = new Adw.PreferencesGroup({
      title: 'Brightness Response Curve',
      description: 'Visual representation of how brightness responds to ambient light levels.',
    });
    page.add(graphGroup);

    // Add curve preview graph
    this.curvePreview = this._createCurvePreview();
    graphGroup.add(this.curvePreview);
  }

  _createCalibrationPage(window, settings, buckets) {
    const page = new Adw.PreferencesPage({
      title: 'Calibration',
      icon_name: 'preferences-desktop-display-symbolic',
    });
    window.add(page);

    // Create a brightness curves group
    const curvesGroup = new Adw.PreferencesGroup({
      title: 'Brightness Buckets',
      description:
        'Configure the light ranges (in lux) and target brightness for each bucket.',
    });
    page.add(curvesGroup);

    // Create UI rows for each bucket
    this.bucketRows = [];
    buckets.forEach((bucket, index) => {
      const expanderRow = this._createBucketExpanderRow(bucket, index, settings);

      // Add accordion behavior - only one expander open at a time
      expanderRow.connect('notify::expanded', () => {
        if (expanderRow.expanded) {
          // Close all other expanders when this one opens
          this.bucketRows.forEach((otherRow) => {
            if (otherRow !== expanderRow && otherRow.expanded) {
              otherRow.expanded = false;
            }
          });
        }
      });

      this.bucketRows.push(expanderRow);
      curvesGroup.add(expanderRow);
    });

    // Set initial constraints based on bucket configuration
    this._updateBucketConstraints();

    // Add reset button
    const resetButton = new Gtk.Button({
      label: 'Reset to Defaults',
      halign: Gtk.Align.CENTER,
      margin_top: 12,
      css_classes: ['pill'],
    });
    resetButton.connect('clicked', () => {
      settings.reset('brightness-buckets');

      // Reload bucket values from settings and update UI
      const bucketsVariant = settings.get_value('brightness-buckets');
      for (let i = 0; i < bucketsVariant.n_children() && i < this.bucketRows.length; i++) {
        const tuple = bucketsVariant.get_child_value(i);
        const row = this.bucketRows[i];

        const min = tuple.get_child_value(0).get_uint32();
        const max = tuple.get_child_value(1).get_uint32();
        const brightness = tuple.get_child_value(2).get_double();

        // Update spin row values
        row._minLuxRow.set_value(min);
        row._maxLuxRow.set_value(max);
        row._brightnessRow.set_value(Math.round(brightness * 100));

        // Update subtitle
        row.subtitle = `${min}–${max} lux → ${Math.round(brightness * 100)}% brightness`;
      }

      // Update bucket mapper and redraw
      this._updateBucketMapper();
      this._updateBucketConstraints();
      if (this.drawingArea) {
        this.drawingArea.queue_draw();
      }
    });
    const resetBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      margin_top: 12,
    });
    resetBox.append(resetButton);
    curvesGroup.add(resetBox);
  }

  _createKeyboardBacklightPage(window, settings, buckets) {
    const page = new Adw.PreferencesPage({
      title: 'Keyboard',
      icon_name: 'input-keyboard-symbolic',
    });
    window.add(page);

    // Create a keyboard backlight group
    const keyboardGroup = new Adw.PreferencesGroup({
      title: 'Automatic Keyboard Backlight',
      description: 'Select brightness ranges where keyboard backlight should be enabled. If none selected, keyboard backlight is disabled.',
    });
    page.add(keyboardGroup);

    // Get current keyboard backlight bucket settings
    const keyboardBucketsVariant = settings.get_value('keyboard-backlight-buckets');
    const enabledBuckets = new Set();
    for (let i = 0; i < keyboardBucketsVariant.n_children(); i++) {
      enabledBuckets.add(keyboardBucketsVariant.get_child_value(i).get_uint32());
    }

    // Create checkbox rows for each bucket
    this.keyboardCheckboxes = [];
    buckets.forEach((bucket, index) => {
      const checkRow = new Adw.ActionRow({
        title: bucket.name,
        activatable: true,
      });

      const checkButton = new Gtk.CheckButton({
        active: enabledBuckets.has(index),
        valign: Gtk.Align.CENTER,
      });

      checkButton.connect('toggled', () => {
        this._saveKeyboardBacklightBuckets(settings);
      });

      checkRow.add_prefix(checkButton);
      checkRow.set_activatable_widget(checkButton);

      this.keyboardCheckboxes.push({ checkButton, bucketIndex: index });
      keyboardGroup.add(checkRow);
    });

    // Create idle timeout group
    const timeoutGroup = new Adw.PreferencesGroup({});
    page.add(timeoutGroup);

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
    timeoutGroup.add(idleTimeoutRow);

    // Bind the spin row to the setting
    settings.bind('keyboard-idle-timeout', idleTimeoutRow, 'value', Gio.SettingsBindFlags.DEFAULT);
  }

  _createBucketExpanderRow(bucket, index, settings) {
    const percentBrightness = Math.round(bucket.brightness * 100); // 0-1.0 scale -> 0-100%
    const expanderRow = new Adw.ExpanderRow({
      title: bucket.name,
      subtitle: `${bucket.min}–${bucket.max} lux → ${percentBrightness}% brightness`,
    });

    // Store references for validation
    expanderRow._bucketIndex = index;
    expanderRow._settings = settings;
    expanderRow._bucketName = bucket.name;

    // Min Lux SpinRow
    const minLuxRow = new Adw.SpinRow({
      title: 'Minimum Lux',
      subtitle: 'Lower bound of light level range',
      tooltip_text: 'Ambient light level where this brightness bucket becomes active',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10000,
        step_increment: 10,
        page_increment: 100,
        value: bucket.min,
      }),
      digits: 0,
    });
    minLuxRow.connect('changed', () => {
      this._onBucketValueChanged(expanderRow, minLuxRow, maxLuxRow, brightnessRow);
    });
    expanderRow.add_row(minLuxRow);

    // Max Lux SpinRow
    const maxLuxRow = new Adw.SpinRow({
      title: 'Maximum Lux',
      subtitle: 'Upper bound of light level range',
      tooltip_text: 'Ambient light level where this brightness bucket becomes inactive',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10000,
        step_increment: 10,
        page_increment: 100,
        value: bucket.max,
      }),
      digits: 0,
    });
    maxLuxRow.connect('changed', () => {
      this._onBucketValueChanged(expanderRow, minLuxRow, maxLuxRow, brightnessRow);
    });
    expanderRow.add_row(maxLuxRow);

    // Brightness SpinRow (0-100%, maps to 0-1.0 internally)
    const brightnessRow = new Adw.SpinRow({
      title: 'Target Brightness',
      subtitle: 'Screen brightness percentage',
      tooltip_text: 'Brightness level to apply when in this light range',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 1,
        page_increment: 5,
        value: percentBrightness,
      }),
      digits: 0,
    });
    brightnessRow.connect('changed', () => {
      this._onBucketValueChanged(expanderRow, minLuxRow, maxLuxRow, brightnessRow);
    });
    expanderRow.add_row(brightnessRow);

    // Store widget references
    expanderRow._minLuxRow = minLuxRow;
    expanderRow._maxLuxRow = maxLuxRow;
    expanderRow._brightnessRow = brightnessRow;

    return expanderRow;
  }

  _onBucketValueChanged(expanderRow, minLuxRow, maxLuxRow, brightnessRow) {
    // Update subtitle
    const minLux = minLuxRow.get_value();
    const maxLux = maxLuxRow.get_value();
    const brightness = brightnessRow.get_value();
    expanderRow.subtitle = `${minLux}–${maxLux} lux → ${brightness}% brightness`;

    // Update constraints for all buckets based on new values
    this._updateBucketConstraints();

    // Save buckets
    this._saveBuckets();

    // Update bucket mapper with new configuration
    this._updateBucketMapper();

    // Redraw curve preview
    if (this.drawingArea) {
      this.drawingArea.queue_draw();
    }
  }

  _updateBucketMapper() {
    if (!this.bucketRows) return;

    const buckets = this.bucketRows.map((row) => ({
      min: row._minLuxRow.get_value(),
      max: row._maxLuxRow.get_value(),
      brightness: row._brightnessRow.get_value() / 100,
    }));

    this.bucketMapper = new BucketMapper(buckets);
  }

  _updateBucketConstraints() {
    if (!this.bucketRows) return;

    for (let i = 0; i < this.bucketRows.length; i++) {
      const row = this.bucketRows[i];
      const minLuxRow = row._minLuxRow;
      const maxLuxRow = row._maxLuxRow;

      const currentMin = minLuxRow.get_value();
      const currentMax = maxLuxRow.get_value();

      // Determine constraints based on neighboring buckets
      let minLowerBound = 0;
      let minUpperBound = currentMax - 1; // Must be less than own max
      let maxLowerBound = currentMin + 1; // Must be greater than own min
      let maxUpperBound = 10000;

      // Previous bucket constraint: current min must be >= previous min
      if (i > 0) {
        const prevRow = this.bucketRows[i - 1];
        const prevMin = prevRow._minLuxRow.get_value();
        const prevMax = prevRow._maxLuxRow.get_value();

        // Current min must be after previous min (to ensure proper ordering)
        minLowerBound = Math.max(minLowerBound, prevMin + 1);

        // Current min must be before previous max (to ensure overlap)
        minUpperBound = Math.min(minUpperBound, prevMax - 1);

        // Current max must be after previous max (to ensure progression)
        maxLowerBound = Math.max(maxLowerBound, prevMax + 1);
      }

      // Next bucket constraint: current max must overlap next min
      if (i < this.bucketRows.length - 1) {
        const nextRow = this.bucketRows[i + 1];
        const nextMin = nextRow._minLuxRow.get_value();
        const nextMax = nextRow._maxLuxRow.get_value();

        // Current max must be after next min (to ensure overlap)
        maxLowerBound = Math.max(maxLowerBound, nextMin + 1);

        // Current max must be before next max (to ensure proper ordering)
        maxUpperBound = Math.min(maxUpperBound, nextMax - 1);

        // Current min must be before next min (to ensure proper ordering)
        minUpperBound = Math.min(minUpperBound, nextMin - 1);
      }

      // Update adjustments with new bounds
      const minAdjustment = minLuxRow.get_adjustment();
      minAdjustment.set_lower(minLowerBound);
      minAdjustment.set_upper(minUpperBound);

      const maxAdjustment = maxLuxRow.get_adjustment();
      maxAdjustment.set_lower(maxLowerBound);
      maxAdjustment.set_upper(maxUpperBound);

      // Clamp current values to new bounds if needed
      if (currentMin < minLowerBound) {
        minLuxRow.set_value(minLowerBound);
      } else if (currentMin > minUpperBound) {
        minLuxRow.set_value(minUpperBound);
      }

      if (currentMax < maxLowerBound) {
        maxLuxRow.set_value(maxLowerBound);
      } else if (currentMax > maxUpperBound) {
        maxLuxRow.set_value(maxUpperBound);
      }
    }
  }

  _validateBuckets() {
    // No longer needed - constraints prevent invalid values
    return true;
  }

  _saveBuckets() {
    const settings = this.bucketRows[0]?._settings;
    if (!settings) {
      console.error('[Prefs] No settings object in bucketRows for _saveBuckets');
      return;
    }

    // Build array of tuples for GSettings
    const GLib = imports.gi.GLib;
    const tuples = [];

    for (let i = 0; i < this.bucketRows.length; i++) {
      const row = this.bucketRows[i];
      const minLux = row._minLuxRow.get_value();
      const maxLux = row._maxLuxRow.get_value();
      const brightness = row._brightnessRow.get_value() / 100; // Convert 0-100% to 0-1.0

      tuples.push([minLux, maxLux, brightness]);
    }

    try {
      const variant = new GLib.Variant('a(uud)', tuples);
      settings.set_value('brightness-buckets', variant);
    } catch (e) {
      console.error('[Prefs] Error saving buckets:', e.message);
    }
  }

  _saveKeyboardBacklightBuckets(settings) {
    if (!settings) {
      console.error('[Prefs] No settings object provided to _saveKeyboardBacklightBuckets');
      return;
    }

    // Build array of enabled bucket indices
    const GLib = imports.gi.GLib;
    const enabledIndices = this.keyboardCheckboxes
      .filter((item) => item.checkButton.active)
      .map((item) => item.bucketIndex);

    const variant = new GLib.Variant('au', enabledIndices);
    settings.set_value('keyboard-backlight-buckets', variant);
  }

  _updateExpanderSubtitle(expanderRow, minLuxRow, maxLuxRow, brightnessRow) {
    const minLux = minLuxRow.get_value();
    const maxLux = maxLuxRow.get_value();
    const brightness = brightnessRow.get_value();
    expanderRow.subtitle = `${minLux}–${maxLux} lux → ${brightness}% brightness`;
  }

  async _initSensorProxy() {
    try {
      await this.sensorProxy.connect();

      if (!this.sensorProxy.hasAmbientLight) {
        return;
      }

      await this.sensorProxy.claimLight();

      // Initial update
      this._updateSensorDisplay();

      // Listen for changes
      this._sensorSignalId = this.sensorProxy.onPropertiesChanged(() => {
        this._updateSensorDisplay();
      });
    } catch (error) {
      console.error('Failed to initialize sensor proxy:', error);
    }
  }

  _updateSensorDisplay() {
    const currentLux = this.sensorProxy.lightLevel;

    if (currentLux === null || !this.bucketMapper) {
      this.activeBucketIndex = -1;
      if (this.drawingArea) {
        this.drawingArea.queue_draw();
      }
      return;
    }

    // Use BucketMapper with hysteresis to determine active bucket
    this.bucketMapper.mapLuxToBrightness(currentLux, true);
    this.activeBucketIndex = this.bucketMapper.currentBucketIndex;

    // Update current lux position and redraw graph
    this.currentLux = currentLux;
    if (this.drawingArea) {
      this.drawingArea.queue_draw();
    }
  }

  _findActiveBucket(luxValue) {
    for (let i = 0; i < this.bucketRows.length; i++) {
      const row = this.bucketRows[i];
      const minLux = row._minLuxRow.get_value();
      const maxLux = row._maxLuxRow.get_value();

      if (luxValue >= minLux && luxValue <= maxLux) {
        return row._bucketName;
      }
    }
    return null;
  }

  _createCurvePreview() {
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
    });

    this.drawingArea = new Gtk.DrawingArea({
      content_height: 350,
      hexpand: true,
      vexpand: true,
    });

    this.drawingArea.set_draw_func((area, cr, width, height) => {
      this._drawCurve(cr, width, height);
    });

    box.append(this.drawingArea);

    return box;
  }

  _drawCurve(cr, width, height) {
    // HIG-compliant padding
    const leftPadding = 40;
    const rightPadding = 40;
    const topPadding = 40;
    const bottomPadding = 60;
    const graphWidth = width - leftPadding - rightPadding;
    const graphHeight = height - topPadding - bottomPadding;

    // Get style context for theme colors
    const styleContext = this.drawingArea.get_style_context();
    const fgColor = styleContext.get_color();

    // No background fill - fully transparent to blend with window

    // Draw subtle grid lines
    cr.setSourceRGBA(fgColor.red, fgColor.green, fgColor.blue, 0.06);
    cr.setLineWidth(1);

    // Horizontal grid lines (5 lines for 0%, 25%, 50%, 75%, 100%)
    for (let i = 0; i <= 4; i++) {
      const y = topPadding + (i * graphHeight) / 4;
      cr.moveTo(leftPadding, y);
      cr.lineTo(leftPadding + graphWidth, y);
      cr.stroke();
    }

    // Vertical grid lines at major lux markers
    const luxMarkers = [10, 100, 1000, 10000];
    for (const lux of luxMarkers) {
      const x = leftPadding + this._luxToX(lux, graphWidth);
      cr.moveTo(x, topPadding);
      cr.lineTo(x, topPadding + graphHeight);
      cr.stroke();
    }

    // Draw axes with theme foreground color
    cr.setSourceRGBA(fgColor.red, fgColor.green, fgColor.blue, 0.15);
    cr.setLineWidth(1.5);
    cr.moveTo(leftPadding, topPadding);
    cr.lineTo(leftPadding, topPadding + graphHeight); // Y-axis
    cr.lineTo(leftPadding + graphWidth, topPadding + graphHeight); // X-axis
    cr.stroke();

    // Font sizes
    const labelFontSize = 11;
    const bucketLabelFontSize = 10;

    // Draw Y-axis labels (brightness percentages)
    cr.setSourceRGBA(fgColor.red, fgColor.green, fgColor.blue, 0.75);
    cr.setFontSize(labelFontSize);
    cr.selectFontFace('Sans', 0, 0);
    for (let i = 0; i <= 4; i++) {
      const brightness = (4 - i) * 0.25;
      const y = topPadding + (i * graphHeight) / 4;
      const text = `${Math.round(brightness * 100)}%`;
      const extents = cr.textExtents(text);
      cr.moveTo(leftPadding - extents.width - 12, y + extents.height / 2 - 1);
      cr.showText(text);
    }

    // Draw X-axis labels (lux levels)
    cr.setFontSize(labelFontSize);
    cr.selectFontFace('Sans', 0, 0);
    cr.setSourceRGBA(fgColor.red, fgColor.green, fgColor.blue, 0.75);
    const allLuxMarkers = [0, 10, 100, 1000, 10000];
    for (const lux of allLuxMarkers) {
      const x = leftPadding + this._luxToX(lux, graphWidth);
      const y = topPadding + graphHeight + 22;

      let text;
      if (lux === 0) {
        text = '0';
      } else if (lux >= 1000) {
        text = `${lux / 1000}k`;
      } else {
        text = lux.toString();
      }

      const extents = cr.textExtents(text);
      cr.moveTo(x - extents.width / 2, y);
      cr.showText(text);
    }

    // Draw bucket segments with enhanced visuals
    if (this.bucketRows && this.bucketRows.length > 0) {
      // Enhanced color palette
      const colors = [
        [0.26, 0.50, 0.96], // Blue
        [0.20, 0.73, 0.42], // Green
        [0.95, 0.61, 0.07], // Orange
        [0.93, 0.31, 0.26], // Red
        [0.62, 0.31, 0.82], // Purple
      ];

      // First pass: Draw background segments for active bucket
      if (this.activeBucketIndex >= 0 && this.activeBucketIndex < this.bucketRows.length) {
        const row = this.bucketRows[this.activeBucketIndex];
        const minLux = row._minLuxRow.get_value();
        const maxLux = row._maxLuxRow.get_value();
        const x1 = leftPadding + this._luxToX(minLux, graphWidth);
        const x2 = leftPadding + this._luxToX(maxLux, graphWidth);
        const color = colors[this.activeBucketIndex % colors.length];

        // Draw subtle background highlight (simple version without gradient)
        cr.setSourceRGBA(color[0], color[1], color[2], 0.05);
        cr.rectangle(x1, topPadding, x2 - x1, graphHeight);
        cr.fill();
      }

      // Second pass: Draw bucket lines with connections
      for (let i = 0; i < this.bucketRows.length; i++) {
        const row = this.bucketRows[i];
        const minLux = row._minLuxRow.get_value();
        const maxLux = row._maxLuxRow.get_value();
        const brightness = row._brightnessRow.get_value() / 100;

        const color = colors[i % colors.length];
        const isActive = this.activeBucketIndex === i;

        const x1 = leftPadding + this._luxToX(minLux, graphWidth);
        const x2 = leftPadding + this._luxToX(maxLux, graphWidth);
        const y = topPadding + graphHeight - brightness * graphHeight;

        // Draw connecting line to next bucket (transition)
        if (i < this.bucketRows.length - 1) {
          const nextRow = this.bucketRows[i + 1];
          const nextMinLux = nextRow._minLuxRow.get_value();
          const nextBrightness = nextRow._brightnessRow.get_value() / 100;
          const nextX = leftPadding + this._luxToX(nextMinLux, graphWidth);
          const nextY = topPadding + graphHeight - nextBrightness * graphHeight;

          // Draw transition line if there's a gap
          if (maxLux < nextMinLux) {
            cr.setLineWidth(1.5);
            cr.setSourceRGBA(color[0], color[1], color[2], 0.25);
            cr.setDash([3, 3], 0);
            cr.moveTo(x2, y);
            cr.lineTo(nextX, nextY);
            cr.stroke();
            cr.setDash([], 0);
          }
        }

        // Draw outer glow for active bucket
        if (isActive) {
          cr.setLineWidth(12);
          cr.setSourceRGBA(color[0], color[1], color[2], 0.12);
          cr.setLineCap(1); // ROUND
          cr.moveTo(x1, y);
          cr.lineTo(x2, y);
          cr.stroke();
        }

        // Draw main bucket line
        cr.setLineWidth(isActive ? 4 : 3);
        cr.setSourceRGBA(color[0], color[1], color[2], isActive ? 1.0 : 0.7);
        cr.setLineCap(1); // ROUND
        cr.moveTo(x1, y);
        cr.lineTo(x2, y);
        cr.stroke();

        // Draw endpoint circles
        const circleRadius = isActive ? 5 : 4;
        cr.setSourceRGBA(color[0], color[1], color[2], isActive ? 1.0 : 0.8);
        cr.arc(x1, y, circleRadius, 0, 2 * Math.PI);
        cr.fill();
        cr.arc(x2, y, circleRadius, 0, 2 * Math.PI);
        cr.fill();

        // Draw bucket name label
        cr.setFontSize(bucketLabelFontSize);
        cr.selectFontFace('Sans', 0, isActive ? 1 : 0); // Bold when active
        const labelText = row._bucketName;
        const extents = cr.textExtents(labelText);
        const labelX = (x1 + x2) / 2 - extents.width / 2;
        const labelY = y - 12;

        // Background for label
        if (isActive) {
          cr.setSourceRGBA(color[0], color[1], color[2], 0.1);
          cr.rectangle(labelX - 5, labelY - extents.height - 2, extents.width + 10, extents.height + 5);
          cr.fill();
        }

        cr.setSourceRGBA(color[0], color[1], color[2], isActive ? 1.0 : 0.75);
        cr.moveTo(labelX, labelY);
        cr.showText(labelText);

        // Draw brightness value below the line (for active bucket)
        if (isActive) {
          cr.setFontSize(9);
          cr.selectFontFace('Sans', 0, 0);
          const brightnessText = `${Math.round(brightness * 100)}%`;
          const brightnessExtents = cr.textExtents(brightnessText);
          const brightnessX = (x1 + x2) / 2 - brightnessExtents.width / 2;
          const brightnessY = y + 18;

          cr.setSourceRGBA(color[0], color[1], color[2], 0.85);
          cr.moveTo(brightnessX, brightnessY);
          cr.showText(brightnessText);
        }
      }
    }

    // Draw current position indicator (enhanced)
    if (this.currentLux !== null && this.currentLux !== undefined && this.activeBucketIndex >= 0) {
      const row = this.bucketRows[this.activeBucketIndex];
      const brightness = row._brightnessRow.get_value() / 100;
      const x = leftPadding + this._luxToX(this.currentLux, graphWidth);
      const y = topPadding + graphHeight - brightness * graphHeight;

      const color = [
        [0.26, 0.50, 0.96],
        [0.20, 0.73, 0.42],
        [0.95, 0.61, 0.07],
        [0.93, 0.31, 0.26],
        [0.62, 0.31, 0.82],
      ][this.activeBucketIndex % 5];

      // Pulsing outer glow
      cr.setSourceRGBA(color[0], color[1], color[2], 0.2);
      cr.arc(x, y, 11, 0, 2 * Math.PI);
      cr.fill();

      // Middle ring
      cr.setSourceRGBA(color[0], color[1], color[2], 0.5);
      cr.arc(x, y, 7, 0, 2 * Math.PI);
      cr.fill();

      // Inner circle
      cr.setSourceRGBA(color[0], color[1], color[2], 1.0);
      cr.arc(x, y, 5, 0, 2 * Math.PI);
      cr.fill();

      // White center
      cr.setSourceRGBA(1, 1, 1, 0.95);
      cr.arc(x, y, 2.5, 0, 2 * Math.PI);
      cr.fill();

      // Draw current lux value
      cr.setFontSize(9);
      cr.selectFontFace('Sans', 0, 1); // Bold
      const luxText = `${Math.round(this.currentLux)} lux`;
      const luxExtents = cr.textExtents(luxText);
      const luxX = x - luxExtents.width / 2;
      const luxY = topPadding - 8;

      // Get theme background color for solid background
      const bgColor = styleContext.lookup_color('view_bg_color')[1];
      if (bgColor) {
        cr.setSourceRGB(bgColor.red, bgColor.green, bgColor.blue);
      } else {
        cr.setSourceRGB(1, 1, 1); // Fallback to white
      }
      cr.rectangle(luxX - 5, luxY - luxExtents.height - 2, luxExtents.width + 10, luxExtents.height + 5);
      cr.fill();

      // Draw text
      cr.setSourceRGBA(color[0], color[1], color[2], 0.95);
      cr.moveTo(luxX, luxY);
      cr.showText(luxText);
    }

    // Draw current lux marker (vertical line)
    if (this.currentLux !== null && this.currentLux !== undefined) {
      cr.setLineWidth(1.5);
      cr.setSourceRGBA(fgColor.red, fgColor.green, fgColor.blue, 0.25);
      cr.setDash([6, 4], 0);
      const x = leftPadding + this._luxToX(this.currentLux, graphWidth);
      cr.moveTo(x, topPadding);
      cr.lineTo(x, topPadding + graphHeight);
      cr.stroke();
      cr.setDash([], 0);
    }
  }

  // Convert lux value to X coordinate (logarithmic scale)
  _luxToX(lux, graphWidth) {
    const maxLux = 10000;
    // Use log scale but add offset to handle 0 and low values
    // Map: 0 -> 0, 10 -> ~0.2, 100 -> ~0.4, 1000 -> ~0.6, 10000 -> 1.0
    const offset = 1;
    const safeLux = Math.max(0, lux) + offset;
    const maxWithOffset = maxLux + offset;
    return (Math.log(safeLux) / Math.log(maxWithOffset)) * graphWidth;
  }

  _cleanupSensorProxy() {
    if (this._sensorSignalId) {
      this.sensorProxy.disconnectListener(this._sensorSignalId);
      this._sensorSignalId = null;
    }

    if (this.sensorProxy) {
      this.sensorProxy.releaseLight();
      this.sensorProxy.destroy();
      this.sensorProxy = null;
    }
  }
}
