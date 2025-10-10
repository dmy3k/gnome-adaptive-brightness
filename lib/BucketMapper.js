export class BucketMapper {
  constructor(buckets) {
    this.buckets = buckets;
    this.currentBucketIndex = -1;
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
      const distance =
        luxValue < bucket.min ? bucket.min - luxValue : luxValue - bucket.max;

      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    return closestIndex;
  }
}
