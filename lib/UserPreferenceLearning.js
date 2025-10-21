const MIN_BIAS = 0.2;
const MAX_BIAS = 2;
const GAMMA = 2.2;

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
    // Apply gamma correction for perceptually uniform brightness adjustment
    // Convert to linear light space, apply bias, convert back to gamma space
    const normalized = brightness / 100;
    const linear = Math.pow(normalized, GAMMA);
    const biased = linear * this.biasRatio;
    const result = Math.pow(biased, 1 / GAMMA);
    return Math.max(1, Math.min(100, Math.round(result * 100)));
  }

  reset() {
    this.biasRatio = 1.0;
  }
}
