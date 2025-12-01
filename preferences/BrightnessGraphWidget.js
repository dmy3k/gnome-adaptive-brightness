import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import { BucketMapper } from '../lib/BucketMapper.js';

export class BrightnessGraphWidget {
  constructor(generateBucketNameCallback, saveBucketsCallback) {
    this.generateBucketName = generateBucketNameCallback;
    this.saveBucketsToSettings = saveBucketsCallback;

    this.bucketMapper = null;
    this.currentLux = null;
    this.activeBucketIndex = -1;

    this.dragState = {
      isDragging: false,
      dragType: null,
      bucketIndex: -1,
      startX: 0,
      startY: 0,
      originalValue: 0,
      hoverHandle: null,
    };

    this._skipNextSettingsUpdate = false;
    this._createWidget();
  }

  _createWidget() {
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
    });

    this.drawingArea = new Gtk.DrawingArea({
      content_height: 280,
      hexpand: true,
      vexpand: true,
    });

    this.drawingArea.set_draw_func((area, cr, width, height) => {
      this._drawCurve(cr, width, height);
    });

    const motionController = new Gtk.EventControllerMotion();
    motionController.connect('motion', (controller, x, y) => {
      this._onGraphMotion(x, y);
    });
    motionController.connect('leave', () => {
      this._onGraphLeave();
    });
    this.drawingArea.add_controller(motionController);

    const clickGesture = new Gtk.GestureDrag();
    clickGesture.connect('drag-begin', (gesture, x, y) => {
      this._onDragBegin(x, y);
    });
    clickGesture.connect('drag-update', (gesture, offsetX, offsetY) => {
      this._onDragUpdate(offsetX, offsetY);
    });
    clickGesture.connect('drag-end', (gesture, offsetX, offsetY) => {
      this._onDragEnd();
    });
    this.drawingArea.add_controller(clickGesture);

    this.tooltipLabel = new Gtk.Label({
      halign: Gtk.Align.START,
      valign: Gtk.Align.START,
    });

    const cssProvider = new Gtk.CssProvider();
    cssProvider.load_from_data(
      `.tooltip-box { 
        background-color: rgba(0, 0, 0, 0.9); 
        color: white; 
        padding: 8px 12px; 
        border-radius: 6px; 
        font-size: 11pt; 
        font-weight: bold; 
      }
      .tooltip-box label {
        color: white;
      }`,
      -1
    );

    const tooltipBox = new Gtk.Box({
      visible: false,
      halign: Gtk.Align.START,
      valign: Gtk.Align.START,
      css_classes: ['tooltip-box'],
    });
    tooltipBox.append(this.tooltipLabel);
    tooltipBox
      .get_style_context()
      .add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    this.tooltipLabel
      .get_style_context()
      .add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    this.tooltipBox = tooltipBox;

    const overlay = new Gtk.Overlay();
    overlay.set_child(this.drawingArea);
    overlay.add_overlay(this.tooltipBox);

    box.append(overlay);

    this.widget = box;
  }

  getWidget() {
    return this.widget;
  }

  setBucketMapper(bucketMapper) {
    this.bucketMapper = bucketMapper;
    this.redraw();
  }

  setCurrentLux(lux, activeBucketIndex) {
    this.currentLux = lux;
    this.activeBucketIndex = activeBucketIndex;
    this.redraw();
  }

  redraw() {
    if (this.drawingArea) {
      this.drawingArea.queue_draw();
    }
  }

  _drawCurve(cr, width, height) {
    const leftPadding = 40;
    const rightPadding = 40;
    const topPadding = 20;
    const bottomPadding = 30;
    const graphWidth = width - leftPadding - rightPadding;
    const graphHeight = height - topPadding - bottomPadding;

    const styleContext = this.drawingArea.get_style_context();
    const fgColor = styleContext.get_color();

    cr.setSourceRGBA(fgColor.red, fgColor.green, fgColor.blue, 0.06);
    cr.setLineWidth(1);

    for (let i = 0; i <= 4; i++) {
      const y = topPadding + (i * graphHeight) / 4;
      cr.moveTo(leftPadding, y);
      cr.lineTo(leftPadding + graphWidth, y);
      cr.stroke();
    }

    const luxMarkers = [10, 100, 1000, 10000];
    for (const lux of luxMarkers) {
      const x = leftPadding + this._luxToX(lux, graphWidth);
      cr.moveTo(x, topPadding);
      cr.lineTo(x, topPadding + graphHeight);
      cr.stroke();
    }

    cr.setSourceRGBA(fgColor.red, fgColor.green, fgColor.blue, 0.15);
    cr.setLineWidth(1.5);
    cr.moveTo(leftPadding, topPadding);
    cr.lineTo(leftPadding, topPadding + graphHeight);
    cr.lineTo(leftPadding + graphWidth, topPadding + graphHeight);
    cr.stroke();

    const labelFontSize = 11;
    const bucketLabelFontSize = 10;
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

    const bucketsData = this.bucketMapper?.buckets || [];
    if (bucketsData.length > 0) {
      const colors = [
        [0.26, 0.5, 0.96],
        [0.2, 0.73, 0.42],
        [0.95, 0.61, 0.07],
        [0.93, 0.31, 0.26],
        [0.62, 0.31, 0.82],
      ];

      // Draw active bucket background highlight
      if (this.activeBucketIndex >= 0 && this.activeBucketIndex < bucketsData.length) {
        const bucket = bucketsData[this.activeBucketIndex];
        const minLux = bucket.min;
        const maxLux = bucket.max;
        const x1 = leftPadding + this._luxToX(minLux, graphWidth);
        const x2 = leftPadding + this._luxToX(maxLux, graphWidth);
        const color = colors[this.activeBucketIndex % colors.length];

        cr.setSourceRGBA(color[0], color[1], color[2], 0.05);
        cr.rectangle(x1, topPadding, x2 - x1, graphHeight);
        cr.fill();
      }

      for (let i = 0; i < bucketsData.length; i++) {
        const bucket = bucketsData[i];
        const minLux = bucket.min;
        const maxLux = bucket.max;
        const brightness = bucket.brightness;

        const color = colors[i % colors.length];
        const isActive = this.activeBucketIndex === i;

        const x1 = leftPadding + this._luxToX(minLux, graphWidth);
        const x2 = leftPadding + this._luxToX(maxLux, graphWidth);
        const y = topPadding + graphHeight - brightness * graphHeight;

        if (i < bucketsData.length - 1) {
          const nextBucket = bucketsData[i + 1];
          const nextMinLux = nextBucket.min;
          const nextBrightness = nextBucket.brightness;
          const nextX = leftPadding + this._luxToX(nextMinLux, graphWidth);
          const nextY = topPadding + graphHeight - nextBrightness * graphHeight;

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

        if (isActive) {
          cr.setLineWidth(12);
          cr.setSourceRGBA(color[0], color[1], color[2], 0.12);
          cr.setLineCap(1);
          cr.moveTo(x1, y);
          cr.lineTo(x2, y);
          cr.stroke();
        }

        cr.setLineWidth(isActive ? 4 : 3);
        cr.setSourceRGBA(color[0], color[1], color[2], isActive ? 1.0 : 0.7);
        cr.setLineCap(1);
        cr.moveTo(x1, y);
        cr.lineTo(x2, y);
        cr.stroke();

        const handleRadius = 6;
        const isHoverMin =
          this.dragState.hoverHandle?.type === 'min' &&
          this.dragState.hoverHandle?.bucketIndex === i;
        const isHoverMax =
          this.dragState.hoverHandle?.type === 'max' &&
          this.dragState.hoverHandle?.bucketIndex === i;
        const isHoverBrightness =
          this.dragState.hoverHandle?.type === 'brightness' &&
          this.dragState.hoverHandle?.bucketIndex === i;

        const centerX = (x1 + x2) / 2;
        if (
          isHoverBrightness ||
          (this.dragState.isDragging &&
            this.dragState.dragType === 'brightness' &&
            this.dragState.bucketIndex === i)
        ) {
          cr.setSourceRGBA(color[0], color[1], color[2], 0.3);
          cr.arc(centerX, y, handleRadius + 3, 0, 2 * Math.PI);
          cr.fill();
        }
        cr.setSourceRGBA(color[0], color[1], color[2], 1.0);
        cr.arc(centerX, y, handleRadius, 0, 2 * Math.PI);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.7);
        cr.rectangle(centerX - 3, y - 2, 6, 1);
        cr.fill();
        cr.rectangle(centerX - 3, y + 1, 6, 1);
        cr.fill();

        if (
          isHoverMin ||
          (this.dragState.isDragging &&
            this.dragState.dragType === 'min' &&
            this.dragState.bucketIndex === i)
        ) {
          cr.setSourceRGBA(color[0], color[1], color[2], 0.3);
          cr.arc(x1, y, handleRadius + 3, 0, 2 * Math.PI);
          cr.fill();
        }
        cr.setSourceRGBA(color[0], color[1], color[2], isActive ? 1.0 : 0.8);
        cr.arc(x1, y, handleRadius, 0, 2 * Math.PI);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.6);
        cr.rectangle(x1 - 2, y - 3, 2, 6);
        cr.fill();

        if (
          isHoverMax ||
          (this.dragState.isDragging &&
            this.dragState.dragType === 'max' &&
            this.dragState.bucketIndex === i)
        ) {
          cr.setSourceRGBA(color[0], color[1], color[2], 0.3);
          cr.arc(x2, y, handleRadius + 3, 0, 2 * Math.PI);
          cr.fill();
        }
        cr.setSourceRGBA(color[0], color[1], color[2], isActive ? 1.0 : 0.8);
        cr.arc(x2, y, handleRadius, 0, 2 * Math.PI);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.6);
        cr.rectangle(x2, y - 3, 2, 6);
        cr.fill();

        cr.setFontSize(bucketLabelFontSize);
        cr.selectFontFace('Sans', 0, isActive ? 1 : 0);
        const labelText = bucket.name;
        const extents = cr.textExtents(labelText);
        const labelX = (x1 + x2) / 2 - extents.width / 2;
        const labelY = y - 12;

        if (isActive) {
          cr.setSourceRGBA(color[0], color[1], color[2], 0.1);
          cr.rectangle(
            labelX - 5,
            labelY - extents.height - 2,
            extents.width + 10,
            extents.height + 5
          );
          cr.fill();
        }

        cr.setSourceRGBA(color[0], color[1], color[2], isActive ? 1.0 : 0.75);
        cr.moveTo(labelX, labelY);
        cr.showText(labelText);

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

    // Draw current lux indicator with label
    if (
      this.currentLux !== null &&
      this.currentLux !== undefined &&
      this.activeBucketIndex >= 0 &&
      this.bucketMapper?.buckets
    ) {
      const bucketsData = this.bucketMapper.buckets;
      if (this.activeBucketIndex < bucketsData.length) {
        const bucket = bucketsData[this.activeBucketIndex];
        const brightness = bucket.brightness;
        const x = leftPadding + this._luxToX(this.currentLux, graphWidth);
        const y = topPadding + graphHeight - brightness * graphHeight;

        const color = [
          [0.26, 0.5, 0.96],
          [0.2, 0.73, 0.42],
          [0.95, 0.61, 0.07],
          [0.93, 0.31, 0.26],
          [0.62, 0.31, 0.82],
        ][this.activeBucketIndex % 5];

        cr.setSourceRGBA(color[0], color[1], color[2], 0.2);
        cr.arc(x, y, 11, 0, 2 * Math.PI);
        cr.fill();

        cr.setSourceRGBA(color[0], color[1], color[2], 0.5);
        cr.arc(x, y, 7, 0, 2 * Math.PI);
        cr.fill();

        cr.setSourceRGBA(color[0], color[1], color[2], 1.0);
        cr.arc(x, y, 5, 0, 2 * Math.PI);
        cr.fill();

        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.arc(x, y, 2.5, 0, 2 * Math.PI);
        cr.fill();

        cr.setFontSize(9);
        cr.selectFontFace('Sans', 0, 1);
        const luxText = `${Math.round(this.currentLux)} lux`;
        const luxExtents = cr.textExtents(luxText);
        const luxX = x - luxExtents.width / 2;
        const luxY = topPadding - 8;

        const bgColor = styleContext.lookup_color('view_bg_color')[1];
        if (bgColor) {
          cr.setSourceRGB(bgColor.red, bgColor.green, bgColor.blue);
        } else {
          cr.setSourceRGB(1, 1, 1);
        }
        cr.rectangle(
          luxX - 5,
          luxY - luxExtents.height - 2,
          luxExtents.width + 10,
          luxExtents.height + 5
        );
        cr.fill();

        cr.setSourceRGBA(color[0], color[1], color[2], 0.95);
        cr.moveTo(luxX, luxY);
        cr.showText(luxText);
      }
    }

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

  _luxToX(lux, graphWidth) {
    const maxLux = 10000;
    const offset = 1;
    const safeLux = Math.max(0, lux) + offset;
    const maxWithOffset = maxLux + offset;
    return (Math.log(safeLux) / Math.log(maxWithOffset)) * graphWidth;
  }

  _getGraphDimensions() {
    const width = this.drawingArea.get_width();
    const height = this.drawingArea.get_height();
    const leftPadding = 40;
    const rightPadding = 40;
    const topPadding = 20;
    const bottomPadding = 30;
    const graphWidth = width - leftPadding - rightPadding;
    const graphHeight = height - topPadding - bottomPadding;

    return {
      width,
      height,
      leftPadding,
      rightPadding,
      topPadding,
      bottomPadding,
      graphWidth,
      graphHeight,
    };
  }

  _xToLux(x, dims) {
    const relX = (x - dims.leftPadding) / dims.graphWidth;
    const maxLux = 10000;
    const offset = 1;
    const maxWithOffset = maxLux + offset;
    return Math.pow(maxWithOffset, relX) - offset;
  }

  _yToBrightness(y, dims) {
    const relY = (y - dims.topPadding) / dims.graphHeight;
    return Math.max(0, Math.min(1, 1 - relY));
  }

  _findHandleAtPosition(x, y) {
    const bucketsData = this.bucketMapper?.buckets || [];
    if (bucketsData.length === 0) return null;

    const dims = this._getGraphDimensions();
    const handleRadius = 10;

    for (let i = 0; i < bucketsData.length; i++) {
      const bucket = bucketsData[i];
      const minLux = bucket.min;
      const maxLux = bucket.max;
      const brightness = bucket.brightness;

      const x1 = dims.leftPadding + this._luxToX(minLux, dims.graphWidth);
      const x2 = dims.leftPadding + this._luxToX(maxLux, dims.graphWidth);
      const yPos = dims.topPadding + dims.graphHeight - brightness * dims.graphHeight;

      if (Math.abs(x - x1) <= handleRadius && Math.abs(y - yPos) <= handleRadius) {
        return { type: 'min', bucketIndex: i };
      }

      if (Math.abs(x - x2) <= handleRadius && Math.abs(y - yPos) <= handleRadius) {
        return { type: 'max', bucketIndex: i };
      }

      const centerX = (x1 + x2) / 2;
      if (Math.abs(x - centerX) <= handleRadius && Math.abs(y - yPos) <= handleRadius) {
        return { type: 'brightness', bucketIndex: i };
      }
    }

    return null;
  }

  _onGraphMotion(x, y) {
    if (this.dragState.isDragging) {
      return;
    }

    const handle = this._findHandleAtPosition(x, y);
    const wasHovering = this.dragState.hoverHandle !== null;
    const isHovering = handle !== null;

    this.dragState.hoverHandle = handle;

    if (handle) {
      if (handle.type === 'brightness') {
        this.drawingArea.set_cursor(Gdk.Cursor.new_from_name('ns-resize', null));
      } else {
        this.drawingArea.set_cursor(Gdk.Cursor.new_from_name('ew-resize', null));
      }
    } else {
      this.drawingArea.set_cursor(null);
    }

    if (
      wasHovering !== isHovering ||
      (isHovering && JSON.stringify(this.dragState.hoverHandle) !== JSON.stringify(handle))
    ) {
      this.drawingArea.queue_draw();
    }
  }

  _onGraphLeave() {
    if (!this.dragState.isDragging) {
      this.dragState.hoverHandle = null;
      this.drawingArea.set_cursor(null);
      this.drawingArea.queue_draw();
    }
  }

  _onDragBegin(x, y) {
    const handle = this._findHandleAtPosition(x, y);
    if (!handle) return;

    this.dragState.isDragging = true;
    this.dragState.dragType = handle.type;
    this.dragState.bucketIndex = handle.bucketIndex;
    this.dragState.startX = x;
    this.dragState.startY = y;

    const bucketsData = this.bucketMapper?.buckets || [];
    if (handle.bucketIndex >= bucketsData.length) {
      this.dragState.isDragging = false;
      return;
    }

    const bucket = bucketsData[handle.bucketIndex];
    if (handle.type === 'min') {
      this.dragState.originalValue = bucket.min;
    } else if (handle.type === 'max') {
      this.dragState.originalValue = bucket.max;
    } else {
      this.dragState.originalValue = bucket.brightness;
    }

    this._showTooltip(x, y);
    this.drawingArea.queue_draw();
  }

  _onDragUpdate(offsetX, offsetY) {
    if (!this.dragState.isDragging) return;

    const currentX = this.dragState.startX + offsetX;
    const currentY = this.dragState.startY + offsetY;
    const dims = this._getGraphDimensions();

    const bucketsData = (this.bucketMapper?.buckets || []).map((b) => ({
      name: b.name,
      min: b.min,
      max: b.max,
      brightness: b.brightness,
    }));
    if (this.dragState.bucketIndex >= bucketsData.length) return;

    const bucket = bucketsData[this.dragState.bucketIndex];
    let newValue;

    if (this.dragState.dragType === 'brightness') {
      const newBrightness = this._yToBrightness(currentY, dims);
      const snappedBrightness = Math.round(newBrightness * 20) / 20;
      newValue = Math.max(0, Math.min(1, snappedBrightness));
      bucket.brightness = newValue;
    } else if (this.dragState.dragType === 'min') {
      const newLux = this._xToLux(currentX, dims);
      let minConstraint = 0;
      let maxConstraint = bucket.max - 1;

      if (this.dragState.bucketIndex > 0) {
        const prevBucket = bucketsData[this.dragState.bucketIndex - 1];
        minConstraint = prevBucket.min;
        maxConstraint = Math.min(maxConstraint, prevBucket.max);
      }

      const snappedLux = Math.round(newLux / 5) * 5;
      newValue = Math.max(minConstraint, Math.min(maxConstraint, snappedLux));
      bucket.min = newValue;
      bucket.name = this.generateBucketName(bucket.min, bucket.max, bucket.brightness);
    } else {
      const newLux = this._xToLux(currentX, dims);
      let minConstraint = bucket.min + 1;
      let maxConstraint = 10000;

      if (this.dragState.bucketIndex < bucketsData.length - 1) {
        const nextBucket = bucketsData[this.dragState.bucketIndex + 1];
        minConstraint = Math.max(minConstraint, nextBucket.min);
        maxConstraint = nextBucket.max;
      }

      const snappedLux = Math.round(newLux / 5) * 5;
      newValue = Math.max(minConstraint, Math.min(maxConstraint, snappedLux));
      bucket.max = newValue;
      bucket.name = this.generateBucketName(bucket.min, bucket.max, bucket.brightness);
    }

    this.bucketMapper = new BucketMapper(bucketsData);
    this._updateTooltip(currentX, currentY);
    if (this.drawingArea) {
      this.drawingArea.queue_draw();
    }
  }

  _onDragEnd() {
    if (!this.dragState.isDragging) return;

    const bucketsData = this.bucketMapper?.buckets || [];
    if (bucketsData.length > 0) {
      this._skipNextSettingsUpdate = true;
      this.saveBucketsToSettings(bucketsData);
    }

    this.dragState.isDragging = false;
    this.dragState.dragType = null;
    this.dragState.bucketIndex = -1;

    this._hideTooltip();
    this.drawingArea.queue_draw();
  }

  _showTooltip(x, y) {
    const bucketsData = this.bucketMapper?.buckets || [];
    if (this.dragState.bucketIndex >= bucketsData.length) return;

    const bucket = bucketsData[this.dragState.bucketIndex];
    let text = '';

    if (this.dragState.dragType === 'min') {
      text = `Min: ${bucket.min} lux`;
    } else if (this.dragState.dragType === 'max') {
      text = `Max: ${bucket.max} lux`;
    } else {
      text = `Brightness: ${Math.round(bucket.brightness * 100)}%`;
    }

    this.tooltipLabel.set_label(text);
    this.tooltipBox.set_visible(true);

    this.tooltipBox.set_margin_start(Math.round(x + 15));
    this.tooltipBox.set_margin_top(Math.round(y - 25));
  }

  _updateTooltip(x, y) {
    if (!this.tooltipBox.get_visible()) return;

    const bucketsData = this.bucketMapper?.buckets || [];
    if (this.dragState.bucketIndex >= bucketsData.length) return;

    const bucket = bucketsData[this.dragState.bucketIndex];
    let text = '';

    if (this.dragState.dragType === 'min') {
      text = `Min: ${bucket.min} lux`;
    } else if (this.dragState.dragType === 'max') {
      text = `Max: ${bucket.max} lux`;
    } else {
      text = `Brightness: ${Math.round(bucket.brightness * 100)}%`;
    }

    this.tooltipLabel.set_label(text);
    this.tooltipBox.set_margin_start(Math.round(x + 15));
    this.tooltipBox.set_margin_top(Math.round(y - 25));
  }

  _hideTooltip() {
    this.tooltipBox.set_visible(false);
  }

  getSkipNextSettingsUpdate() {
    return this._skipNextSettingsUpdate;
  }

  clearSkipNextSettingsUpdate() {
    this._skipNextSettingsUpdate = false;
  }

  isDragging() {
    return this.dragState.isDragging;
  }
}
