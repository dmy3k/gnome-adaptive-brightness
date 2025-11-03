const MIN_BIAS = 0.1;
const MAX_BIAS = 5;

export class UserPreferenceLearning {
  constructor(initialValue = 1.0) {
    this.biasRatio = initialValue;
  }

  setBiasRatio(biasRatio) {
    this.biasRatio = this.smoothAndClampBias(biasRatio);
  }

  updateBiasFromManualAdjustment(manualBrightness, automaticBrightness) {
    if (automaticBrightness <= 0) {
      return;
    }

    // Store bias ratio directly in linear space
    const newBiasRatio = manualBrightness / automaticBrightness;
    this.biasRatio = this.smoothAndClampBias(newBiasRatio);
    return this.biasRatio;
  }

  smoothAndClampBias(newBiasRatio) {
    return Math.max(MIN_BIAS, Math.min(MAX_BIAS, newBiasRatio));
  }

  applyBiasTo(brightness) {
    // Apply bias ratio directly to brightness value
    // Brightness values are already in perceptually uniform space (0.01-1.0)
    // so we don't need gamma correction here
    const result = brightness * this.biasRatio;
    return Math.max(0.01, Math.min(1.0, result)); // Minimum 1% brightness
  }

  reset() {
    this.biasRatio = 1.0;
  }
}
