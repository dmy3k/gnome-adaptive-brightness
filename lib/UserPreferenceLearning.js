export class UserPreferenceLearning {
  constructor() {
    this.biasRatio = 1.0;
  }

  updateBiasFromManualAdjustment(manualBrightness, automaticBrightness) {
    if (automaticBrightness <= 0) {
      return;
    }

    const newBiasRatio = manualBrightness / automaticBrightness;
    this.biasRatio = this.smoothAndClampBias(newBiasRatio);
    return this.biasRatio;
  }

  smoothAndClampBias(newBiasRatio) {
    const MIN_BIAS = 0.2;
    const MAX_BIAS = 2.5;

    return Math.max(MIN_BIAS, Math.min(MAX_BIAS, newBiasRatio));
  }

  applyBiasTo(brightness) {
    const biasedBrightness = Math.round(brightness * this.biasRatio);
    return Math.max(1, Math.min(100, biasedBrightness));
  }

  reset() {
    this.biasRatio = 1.0;
  }
}
