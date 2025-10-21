export class BucketMapper {
  constructor(buckets) {
    this.buckets = buckets;
    this.currentBucketIndex = -1;
  }

  /**
   * Check if light level change would result in a different bucket
   * Optimized: checks if the current value crossed the boundaries of the previous bucket
   * This correctly handles overlapping bucket ranges
   * @param {number} previousLux - Previous light level in lux
   * @param {number} currentLux - Current light level in lux
   * @returns {boolean} True if the bucket would change
   */
  crossesBucketBoundary(previousLux, currentLux) {
    if (previousLux === null || currentLux === null || this.buckets.length === 0) {
      return true;
    }

    // Use the actual current bucket (with hysteresis state) if available
    // This ensures we check against the bucket that's actually active
    if (this.currentBucketIndex >= 0 && this.currentBucketIndex < this.buckets.length) {
      const currentBucket = this.buckets[this.currentBucketIndex];
      // Check if the new value would leave the current bucket
      return !this.isLuxInBucket(currentLux, currentBucket);
    }

    // Fallback: if no current bucket, check if values would map to different buckets
    const prevBucketIndex = this.findBucketIndex(previousLux, false);
    return !this.isLuxInBucket(currentLux, this.buckets[prevBucketIndex]);
  }
  mapLuxToBrightness(luxValue, withHysteresis = true) {
    const targetBucketIndex = this.findBucketIndex(luxValue, withHysteresis);

    if (targetBucketIndex === -1) {
      return null;
    }

    const bucketChanged = targetBucketIndex !== this.currentBucketIndex;

    if (bucketChanged || !withHysteresis) {
      this.currentBucketIndex = targetBucketIndex;
    }

    return this.buckets[this.currentBucketIndex];
  }

  findBucketIndex(luxValue, withHysteresis) {
    if (withHysteresis && this.currentBucketIndex >= 0) {
      const currentBucket = this.buckets[this.currentBucketIndex];
      if (this.isLuxInBucket(luxValue, currentBucket)) {
        return this.currentBucketIndex;
      }
    }

    for (let i = 0; i < this.buckets.length; i++) {
      if (this.isLuxInBucket(luxValue, this.buckets[i])) {
        return i;
      }
    }

    return this.findClosestBucketIndex(luxValue);
  }

  isLuxInBucket(luxValue, bucket) {
    return luxValue >= bucket.min && luxValue <= bucket.max;
  }

  findClosestBucketIndex(luxValue) {
    if (luxValue < this.buckets[0].min) {
      return 0;
    }

    let minDistance = Infinity;
    let closestIndex = -1;

    for (let i = 0; i < this.buckets.length; i++) {
      const bucket = this.buckets[i];
      const distance = luxValue < bucket.min ? bucket.min - luxValue : luxValue - bucket.max;

      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    return closestIndex;
  }
}
