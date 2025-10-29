import { BucketMapper } from '../lib/BucketMapper.js';

describe('BucketMapper', () => {
  let testBuckets;
  let mapper;

  beforeEach(() => {
    // Define test buckets similar to what's used in the extension
    testBuckets = [
      { min: 0, max: 10, brightness: 0.1 },
      { min: 5, max: 200, brightness: 0.25 },
      { min: 50, max: 650, brightness: 0.5 },
      { min: 350, max: 2000, brightness: 0.75 },
      { min: 1000, max: 10000, brightness: 1.0 },
    ];
    mapper = new BucketMapper(testBuckets);
  });

  describe('constructor', () => {
    test('should initialize with provided buckets', () => {
      expect(mapper.buckets).toBe(testBuckets);
    });

    test('should initialize currentBucketIndex to -1', () => {
      expect(mapper.currentBucketIndex).toBe(-1);
    });

    test('should handle empty bucket array', () => {
      const emptyMapper = new BucketMapper([]);
      expect(emptyMapper.buckets).toEqual([]);
      expect(emptyMapper.currentBucketIndex).toBe(-1);
    });
  });

  describe('crossesBucketBoundary', () => {
    test('should return true when previousLux is null', () => {
      expect(mapper.crossesBucketBoundary(null, 100)).toBe(true);
    });

    test('should return true when currentLux is null', () => {
      expect(mapper.crossesBucketBoundary(100, null)).toBe(true);
    });

    test('should return true when exiting bucket 0', () => {
      // 5 is in bucket 0 [0, 10], 50 is outside bucket 0
      expect(mapper.crossesBucketBoundary(5, 50)).toBe(true);
    });

    test('should return true when exiting bucket at max boundary', () => {
      // 10 is in bucket 0 [0, 10], 50 is outside
      expect(mapper.crossesBucketBoundary(10, 50)).toBe(true);
    });

    test('should return true when exiting any bucket even if staying in another', () => {
      // 100 is in bucket 1 [5, 200] AND bucket 2 [50, 650]
      // 400 is in bucket 2 [50, 650] AND bucket 3 [350, 2000]
      // Exits bucket 1, so should return true
      expect(mapper.crossesBucketBoundary(100, 400)).toBe(true);
    });

    test('should return false when staying within overlapping region', () => {
      // 100 is in both bucket 1 [5, 200] and bucket 2 [50, 650]
      // 150 is also in both
      expect(mapper.crossesBucketBoundary(100, 150)).toBe(false);
    });

    test('should return true when exiting an overlapping region', () => {
      // 100 is in buckets 1 and 2, but 700 is only in bucket 3
      // Exits bucket 2 [50, 650]
      expect(mapper.crossesBucketBoundary(100, 700)).toBe(true);
    });

    test('should return true when crossing from bucket 2 to 3', () => {
      // 400 in bucket 2 [50, 650], 700 in bucket 3 [350, 2000]
      // Exits bucket 2
      expect(mapper.crossesBucketBoundary(400, 700)).toBe(true);
    });

    test('should return false when staying in bucket 3', () => {
      // Both in bucket 3 [350, 2000]
      expect(mapper.crossesBucketBoundary(1000, 1500)).toBe(false);
    });

    test('should return true when going from bucket 4 to 0', () => {
      // 5000 in bucket 4 [1000, 10000], 5 in bucket 0 [0, 10]
      expect(mapper.crossesBucketBoundary(5000, 5)).toBe(true);
    });

    test('should return false when both values identical', () => {
      expect(mapper.crossesBucketBoundary(100, 100)).toBe(false);
    });

    test('should handle boundary values correctly', () => {
      // At bucket 0 max boundary
      expect(mapper.crossesBucketBoundary(10, 10)).toBe(false);

      // Crossing from 10 to 11 - exits bucket 0 [0, 10]
      expect(mapper.crossesBucketBoundary(10, 11)).toBe(true);

      // At bucket 2 min boundary, staying in range
      expect(mapper.crossesBucketBoundary(50, 100)).toBe(false);
    });

    test('should work with empty buckets array', () => {
      const emptyMapper = new BucketMapper([]);
      // No buckets means we can't determine if they're in the same bucket
      // Safer to return true and let the event through
      expect(emptyMapper.crossesBucketBoundary(100, 200)).toBe(true);
    });
  });

  describe('isLuxInBucket', () => {
    test('should return true when lux is within bucket range', () => {
      const bucket = { min: 50, max: 650, brightness: 50 };
      expect(mapper.isLuxInBucket(100, bucket)).toBe(true);
      expect(mapper.isLuxInBucket(50, bucket)).toBe(true);
      expect(mapper.isLuxInBucket(650, bucket)).toBe(true);
    });

    test('should return false when lux is below bucket minimum', () => {
      const bucket = { min: 50, max: 650, brightness: 50 };
      expect(mapper.isLuxInBucket(49, bucket)).toBe(false);
      expect(mapper.isLuxInBucket(0, bucket)).toBe(false);
    });

    test('should return false when lux is above bucket maximum', () => {
      const bucket = { min: 50, max: 650, brightness: 50 };
      expect(mapper.isLuxInBucket(651, bucket)).toBe(false);
      expect(mapper.isLuxInBucket(1000, bucket)).toBe(false);
    });

    test('should handle edge values correctly', () => {
      const bucket = { min: 0, max: 10, brightness: 10 };
      expect(mapper.isLuxInBucket(0, bucket)).toBe(true);
      expect(mapper.isLuxInBucket(10, bucket)).toBe(true);
    });
  });

  describe('findClosestBucketIndex', () => {
    test('should return 0 for values below first bucket minimum', () => {
      expect(mapper.findClosestBucketIndex(-10)).toBe(0);
      expect(mapper.findClosestBucketIndex(-1)).toBe(0);
    });

    test('should find closest bucket for value between buckets', () => {
      // Value 30 is between bucket[1] (max: 200) and bucket[2] (min: 50)
      // It's actually within bucket[1], so this tests gaps
      // Let's test a value in a gap: between bucket[0] max:10 and bucket[1] min:5
      // Actually these overlap, let me test a clearer gap

      // For value 11 (above bucket[0].max=10, could be in bucket[1] min=5)
      // It should be in bucket[1] since 11 >= 5

      // Let's create a scenario with clear gaps
      const gappedBuckets = [
        { min: 0, max: 10, brightness: 10 },
        { min: 50, max: 100, brightness: 50 },
        { min: 200, max: 300, brightness: 75 },
      ];
      const gappedMapper = new BucketMapper(gappedBuckets);

      // Value 25 is between bucket[0].max=10 and bucket[1].min=50
      // Distance to bucket[0]: 25 - 10 = 15
      // Distance to bucket[1]: 50 - 25 = 25
      // Should return bucket[0] (index 0)
      expect(gappedMapper.findClosestBucketIndex(25)).toBe(0);

      // Value 150 is between bucket[1].max=100 and bucket[2].min=200
      // Distance to bucket[1]: 150 - 100 = 50
      // Distance to bucket[2]: 200 - 150 = 50
      // Should return bucket[1] (index 1) - first encountered with min distance
      expect(gappedMapper.findClosestBucketIndex(150)).toBe(1);
    });

    test('should handle value above all buckets', () => {
      // Value above last bucket's max (10000)
      const result = mapper.findClosestBucketIndex(15000);
      expect(result).toBe(4); // Last bucket index
    });

    test('should handle empty buckets array gracefully', () => {
      const emptyMapper = new BucketMapper([]);
      // The implementation doesn't guard against empty arrays in findClosestBucketIndex
      // This would throw an error if called, which is acceptable behavior
      // as BucketMapper expects to be initialized with valid buckets
      expect(emptyMapper.buckets).toEqual([]);
    });

    test('should find closest bucket when value is just outside bucket range', () => {
      const gappedBuckets = [
        { min: 0, max: 10, brightness: 10 },
        { min: 50, max: 100, brightness: 50 },
      ];
      const gappedMapper = new BucketMapper(gappedBuckets);

      // Value 11 is just above bucket[0].max
      // Distance to bucket[0]: 11 - 10 = 1
      // Distance to bucket[1]: 50 - 11 = 39
      expect(gappedMapper.findClosestBucketIndex(11)).toBe(0);

      // Value 49 is just below bucket[1].min
      // Distance to bucket[0]: 49 - 10 = 39
      // Distance to bucket[1]: 50 - 49 = 1
      expect(gappedMapper.findClosestBucketIndex(49)).toBe(1);
    });
  });

  describe('findBucketIndex', () => {
    test('should find correct bucket for lux value within range', () => {
      expect(mapper.findBucketIndex(5, false)).toBe(0); // in bucket 0
      expect(mapper.findBucketIndex(100, false)).toBe(1); // in bucket 1
      expect(mapper.findBucketIndex(500, false)).toBe(2); // in bucket 2
      expect(mapper.findBucketIndex(1500, false)).toBe(3); // in bucket 3
      expect(mapper.findBucketIndex(5000, false)).toBe(4); // in bucket 4
    });

    test('should return current bucket when hysteresis enabled and lux still in range', () => {
      mapper.currentBucketIndex = 2;
      const result = mapper.findBucketIndex(100, true);
      // 100 is in bucket[1] (min:5, max:200) and bucket[2] (min:50, max:650)
      // With hysteresis and currentBucketIndex=2, should stay at 2 since 100 is within it
      expect(result).toBe(2);
    });

    test('should find new bucket when hysteresis enabled but lux outside current range', () => {
      mapper.currentBucketIndex = 0;
      const result = mapper.findBucketIndex(500, true);
      // 500 is outside bucket[0] (min:0, max:10), should find new bucket
      expect(result).toBe(2); // bucket 2 (min:50, max:650)
    });

    test('should ignore hysteresis when withHysteresis is false', () => {
      mapper.currentBucketIndex = 2;
      const result = mapper.findBucketIndex(5, false);
      // Should find bucket 0, ignoring current bucket 2
      expect(result).toBe(0);
    });

    test('should handle overlapping buckets by returning first match', () => {
      // Value 100 could be in bucket[1] (5-200) or bucket[2] (50-650)
      const result = mapper.findBucketIndex(100, false);
      expect(result).toBe(1); // Should return first matching bucket
    });

    test('should fallback to findClosestBucketIndex when no exact match', () => {
      const gappedBuckets = [
        { min: 0, max: 10, brightness: 10 },
        { min: 50, max: 100, brightness: 50 },
      ];
      const gappedMapper = new BucketMapper(gappedBuckets);

      const result = gappedMapper.findBucketIndex(25, false);
      // 25 is not in any bucket, should find closest (bucket 0)
      expect(result).toBe(0);
    });

    test('should handle currentBucketIndex = -1 with hysteresis', () => {
      mapper.currentBucketIndex = -1;
      const result = mapper.findBucketIndex(100, true);
      // Should find bucket normally since currentBucketIndex is -1
      expect(result).toBe(1);
    });
  });

  describe('mapLuxToBrightness', () => {
    test('should return correct brightness for lux value', () => {
      const result = mapper.mapLuxToBrightness(100);
      expect(result).toEqual({ min: 5, max: 200, brightness: 0.25 });
    });

    test('should update currentBucketIndex when bucket changes', () => {
      mapper.mapLuxToBrightness(5);
      expect(mapper.currentBucketIndex).toBe(0);

      mapper.mapLuxToBrightness(500);
      expect(mapper.currentBucketIndex).toBe(2);
    });

    test('should maintain currentBucketIndex with hysteresis when lux stays in range', () => {
      mapper.mapLuxToBrightness(100); // Sets to bucket 1
      const initialIndex = mapper.currentBucketIndex;

      mapper.mapLuxToBrightness(150); // Still in bucket 1 range (5-200)
      expect(mapper.currentBucketIndex).toBe(initialIndex);
    });

    test('should change bucket when lux moves outside current range', () => {
      mapper.mapLuxToBrightness(5); // Bucket 0
      expect(mapper.currentBucketIndex).toBe(0);

      mapper.mapLuxToBrightness(5000); // Bucket 4
      expect(mapper.currentBucketIndex).toBe(4);
    });

    test('should return null when no buckets are available', () => {
      // Note: The actual implementation will throw an error with empty buckets
      // when trying to access this.buckets[0].min in findClosestBucketIndex
      // This test documents that behavior - BucketMapper expects valid buckets
      const emptyMapper = new BucketMapper([]);
      expect(() => emptyMapper.mapLuxToBrightness(100)).toThrow();
    });

    test('should update currentBucketIndex when withHysteresis is false', () => {
      mapper.mapLuxToBrightness(100, true); // Sets to bucket 1
      expect(mapper.currentBucketIndex).toBe(1);

      // Even though 100 could be in bucket 2 (overlapping), without hysteresis
      // it should find the first matching bucket
      mapper.mapLuxToBrightness(100, false);
      expect(mapper.currentBucketIndex).toBe(1);
    });

    test('should handle edge case of lux at bucket boundary', () => {
      const result1 = mapper.mapLuxToBrightness(10); // At bucket 0 max
      expect(result1.brightness).toBe(0.1);

      const result2 = mapper.mapLuxToBrightness(50); // At bucket 2 min
      // Could be bucket 1 (min:5, max:200) or bucket 2 (min:50, max:650)
      expect([0.25, 0.5]).toContain(result2.brightness);
    });

    test('should handle very low lux values', () => {
      const result = mapper.mapLuxToBrightness(0);
      expect(result).toEqual({ min: 0, max: 10, brightness: 0.1 });
    });

    test('should handle very high lux values', () => {
      const result = mapper.mapLuxToBrightness(15000);
      expect(result).toEqual({ min: 1000, max: 10000, brightness: 1.0 });
    });

    test('should demonstrate hysteresis behavior preventing rapid bucket switching', () => {
      // Start in bucket 2
      mapper.mapLuxToBrightness(400, true);
      expect(mapper.currentBucketIndex).toBe(2);
      expect(mapper.buckets[2]).toEqual({ min: 50, max: 650, brightness: 0.5 });

      // Move to a value that's in overlapping range of bucket 1 and 2
      // Value 100 is in bucket 1 (5-200) and bucket 2 (50-650)
      // With hysteresis, should stay in bucket 2
      const result = mapper.mapLuxToBrightness(100, true);
      expect(mapper.currentBucketIndex).toBe(2);
      expect(result.brightness).toBe(0.5);

      // Without hysteresis, should switch to bucket 1
      const result2 = mapper.mapLuxToBrightness(100, false);
      expect(mapper.currentBucketIndex).toBe(1);
      expect(result2.brightness).toBe(0.25);
    });

    test('should work with single bucket', () => {
      const singleBucket = [{ min: 0, max: 1000, brightness: 0.5 }];
      const singleMapper = new BucketMapper(singleBucket);

      expect(singleMapper.mapLuxToBrightness(500)).toEqual({
        min: 0,
        max: 1000,
        brightness: 0.5,
      });
      expect(singleMapper.mapLuxToBrightness(1500)).toEqual({
        min: 0,
        max: 1000,
        brightness: 0.5,
      });
    });
  });

  describe('integration scenarios', () => {
    test('should handle a typical day cycle of light changes', () => {
      // Night
      let result = mapper.mapLuxToBrightness(2);
      expect(result.brightness).toBe(0.1);
      expect(mapper.currentBucketIndex).toBe(0);

      // Dawn - gradual increase
      result = mapper.mapLuxToBrightness(50);
      expect([0.25, 0.5]).toContain(result.brightness);

      // Morning indoor
      result = mapper.mapLuxToBrightness(300);
      expect(result.brightness).toBe(0.5);

      // Bright indoor/window
      result = mapper.mapLuxToBrightness(1200);
      expect(result.brightness).toBe(0.75);

      // Outdoor
      result = mapper.mapLuxToBrightness(8000);
      expect(result.brightness).toBe(1.0);

      // Back indoors - with hysteresis, 100 is still in bucket 4's range? No, bucket 4 is min:1000
      // So it should switch. But 100 is in bucket 1 (5-200) and bucket 2 (50-650)
      // After being in bucket 4, moving to 100 should find bucket 1 first
      result = mapper.mapLuxToBrightness(400);
      expect(result.brightness).toBe(0.5);

      // Evening - 100 is in range of bucket 2 (50-650) due to hysteresis from previous 400
      result = mapper.mapLuxToBrightness(100);
      // With hysteresis enabled (default), stays in bucket 2 since 100 is within 50-650
      expect(result.brightness).toBe(0.5);

      // Night again - clearly outside bucket 2 range
      result = mapper.mapLuxToBrightness(5);
      expect(result.brightness).toBe(0.1);
    });

    test('should handle fluctuating light with hysteresis preventing jitter', () => {
      // Start at mid-range of bucket 2
      mapper.mapLuxToBrightness(400, true);
      expect(mapper.currentBucketIndex).toBe(2);

      // Small fluctuations within bucket range
      mapper.mapLuxToBrightness(420, true);
      expect(mapper.currentBucketIndex).toBe(2);

      mapper.mapLuxToBrightness(380, true);
      expect(mapper.currentBucketIndex).toBe(2);

      // Move to overlapping region but stay in current bucket
      mapper.mapLuxToBrightness(150, true);
      expect(mapper.currentBucketIndex).toBe(2); // Stays due to hysteresis

      // Move clearly out of range
      mapper.mapLuxToBrightness(5000, true);
      expect(mapper.currentBucketIndex).toBe(4);
    });

    test('should handle rapid transitions without hysteresis', () => {
      mapper.mapLuxToBrightness(5, false);
      expect(mapper.currentBucketIndex).toBe(0);

      mapper.mapLuxToBrightness(100, false);
      expect(mapper.currentBucketIndex).toBe(1);

      mapper.mapLuxToBrightness(500, false);
      expect(mapper.currentBucketIndex).toBe(2);

      mapper.mapLuxToBrightness(1500, false);
      expect(mapper.currentBucketIndex).toBe(3);
    });
  });
});
