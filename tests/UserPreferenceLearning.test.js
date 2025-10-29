import { describe, it, expect, beforeEach } from '@jest/globals';
import { UserPreferenceLearning } from '../lib/UserPreferenceLearning.js';

describe('UserPreferenceLearning', () => {
  let learning;

  beforeEach(() => {
    learning = new UserPreferenceLearning();
  });

  describe('constructor', () => {
    it('should initialize with default biasRatio of 1.0', () => {
      expect(learning.biasRatio).toBe(1.0);
    });

    it('should initialize with custom initial value', () => {
      const customLearning = new UserPreferenceLearning(1.5);
      expect(customLearning.biasRatio).toBe(1.5);
    });

    it('should handle initial value edge cases', () => {
      expect(new UserPreferenceLearning(0.1).biasRatio).toBe(0.1);
      expect(new UserPreferenceLearning(2.0).biasRatio).toBe(2.0);
      expect(new UserPreferenceLearning(5.0).biasRatio).toBe(5.0); // Not clamped in constructor
    });
  });

  describe('updateBiasFromManualAdjustment', () => {
    it('should update biasRatio based on manual vs automatic brightness', () => {
      const result = learning.updateBiasFromManualAdjustment(0.8, 0.4);
      expect(result).toBe(2.0);
      expect(learning.biasRatio).toBe(2.0);
    });

    it('should clamp bias to minimum (0.1)', () => {
      const result = learning.updateBiasFromManualAdjustment(0.05, 1.0);
      expect(result).toBe(0.1);
      expect(learning.biasRatio).toBe(0.1);
    });

    it('should clamp bias to maximum (5)', () => {
      const result = learning.updateBiasFromManualAdjustment(1.0, 0.1);
      expect(result).toBe(5);
      expect(learning.biasRatio).toBe(5);
    });

    it('should not update when automaticBrightness is 0', () => {
      learning.biasRatio = 1.5;
      const result = learning.updateBiasFromManualAdjustment(0.5, 0);
      expect(result).toBeUndefined();
      expect(learning.biasRatio).toBe(1.5);
    });

    it('should not update when automaticBrightness is negative', () => {
      learning.biasRatio = 1.5;
      const result = learning.updateBiasFromManualAdjustment(0.5, -0.1);
      expect(result).toBeUndefined();
      expect(learning.biasRatio).toBe(1.5);
    });

    it('should handle equal manual and automatic brightness', () => {
      const result = learning.updateBiasFromManualAdjustment(0.5, 0.5);
      expect(result).toBe(1.0);
      expect(learning.biasRatio).toBe(1.0);
    });
  });

  describe('smoothAndClampBias', () => {
    it('should return value within range unchanged', () => {
      const result = learning.smoothAndClampBias(1.5);
      expect(result).toBe(1.5);
    });

    it('should clamp value below minimum to 0.1', () => {
      const result = learning.smoothAndClampBias(0.05);
      expect(result).toBe(0.1);
    });

    it('should clamp value above maximum to 5', () => {
      const result = learning.smoothAndClampBias(10.0);
      expect(result).toBe(5);
    });

    it('should handle minimum edge value', () => {
      const result = learning.smoothAndClampBias(0.1);
      expect(result).toBe(0.1);
    });

    it('should handle maximum edge value', () => {
      const result = learning.smoothAndClampBias(5);
      expect(result).toBe(5);
    });

    it('should handle zero', () => {
      const result = learning.smoothAndClampBias(0);
      expect(result).toBe(0.1);
    });

    it('should handle negative values', () => {
      const result = learning.smoothAndClampBias(-1);
      expect(result).toBe(0.1);
    });
  });

  describe('applyBiasTo', () => {
    it('should apply bias correctly with default ratio', () => {
      const result = learning.applyBiasTo(0.5);
      expect(result).toBeCloseTo(0.5, 2);
    });

    it('should apply positive bias with gamma correction', () => {
      learning.biasRatio = 2.0;
      const result = learning.applyBiasTo(0.5);
      // Gamma correction: 50% with 2× bias ≈ 69%
      expect(result).toBeCloseTo(0.69, 2);
    });

    it('should apply negative bias with gamma correction', () => {
      learning.biasRatio = 0.5;
      const result = learning.applyBiasTo(0.5);
      // Gamma correction: 50% with 0.5× bias ≈ 36%
      expect(result).toBeCloseTo(0.36, 2);
    });

    it('should clamp result to minimum of 0.01', () => {
      learning.biasRatio = 0.2;
      const result = learning.applyBiasTo(0.01);
      expect(result).toBeGreaterThanOrEqual(0.01);
    });

    it('should clamp result to maximum of 1.0', () => {
      learning.biasRatio = 2.0;
      const result = learning.applyBiasTo(0.99);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it('should apply gamma correction for mid-range values', () => {
      learning.biasRatio = 1.5;
      const result = learning.applyBiasTo(0.5);
      // Gamma correction: 50% with 1.5× bias ≈ 60%
      expect(result).toBeCloseTo(0.6, 2);
    });

    it('should handle brightness of 0', () => {
      learning.biasRatio = 1.5;
      const result = learning.applyBiasTo(0);
      expect(result).toBe(0.01); // Clamped to minimum
    });

    it('should handle brightness of 1.0', () => {
      learning.biasRatio = 1.5;
      const result = learning.applyBiasTo(1.0);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it('should preserve perceptual uniformity at low brightness', () => {
      learning.biasRatio = 2.0;
      const result = learning.applyBiasTo(0.25);
      // Gamma correction: 25% with 2× bias ≈ 34%
      expect(result).toBeCloseTo(0.34, 2);
    });

    it('should preserve perceptual uniformity at high brightness', () => {
      learning.biasRatio = 0.5;
      const result = learning.applyBiasTo(0.8);
      // Gamma correction: 80% with 0.5× bias ≈ 58%
      expect(result).toBeCloseTo(0.58, 2);
    });
  });

  describe('setBiasRatio', () => {
    it('should set and clamp bias ratio', () => {
      learning.setBiasRatio(1.5);
      expect(learning.biasRatio).toBe(1.5);
    });

    it('should clamp values below minimum', () => {
      learning.setBiasRatio(0.05);
      expect(learning.biasRatio).toBe(0.1);
    });

    it('should clamp values above maximum', () => {
      learning.setBiasRatio(10.0);
      expect(learning.biasRatio).toBe(5);
    });
  });

  describe('reset', () => {
    it('should reset biasRatio to 1.0', () => {
      learning.biasRatio = 1.8;
      learning.reset();
      expect(learning.biasRatio).toBe(1.0);
    });

    it('should reset from minimum bias', () => {
      learning.biasRatio = 0.2;
      learning.reset();
      expect(learning.biasRatio).toBe(1.0);
    });

    it('should reset from maximum bias', () => {
      learning.biasRatio = 2.0;
      learning.reset();
      expect(learning.biasRatio).toBe(1.0);
    });

    it("should not persist to settings (controller's responsibility)", () => {
      // This test documents that reset() only modifies in-memory state
      // The extension controller is responsible for persisting to settings
      learning.biasRatio = 1.8;
      learning.reset();
      expect(learning.biasRatio).toBe(1.0);
      // No settings.set_double() should be called - that's the controller's job
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple sequential adjustments', () => {
      learning.updateBiasFromManualAdjustment(0.8, 0.4); // 2.0
      expect(learning.biasRatio).toBe(2.0);

      learning.updateBiasFromManualAdjustment(0.5, 1.0); // 0.5
      expect(learning.biasRatio).toBe(0.5);

      learning.updateBiasFromManualAdjustment(0.6, 0.6); // 1.0
      expect(learning.biasRatio).toBe(1.0);
    });

    it('should maintain bias across brightness applications with gamma correction', () => {
      learning.updateBiasFromManualAdjustment(0.8, 0.4); // Sets bias to 2.0

      const result1 = learning.applyBiasTo(0.3);
      // Gamma correction: 30% with 2× bias ≈ 41%
      expect(result1).toBeCloseTo(0.41, 2);

      const result2 = learning.applyBiasTo(0.5);
      // Gamma correction: 50% with 2× bias ≈ 69%
      expect(result2).toBeCloseTo(0.69, 2);
    });

    it('should reset and allow new learning', () => {
      learning.updateBiasFromManualAdjustment(0.8, 0.4);
      expect(learning.biasRatio).toBe(2.0);

      learning.reset();
      expect(learning.biasRatio).toBe(1.0);

      learning.updateBiasFromManualAdjustment(0.3, 0.6);
      expect(learning.biasRatio).toBe(0.5);
    });

    it('should provide perceptually uniform adjustments across range', () => {
      learning.biasRatio = 1.5;

      // Low brightness
      expect(learning.applyBiasTo(0.1)).toBeCloseTo(0.12, 2);
      // Mid brightness
      expect(learning.applyBiasTo(0.5)).toBeCloseTo(0.6, 2);
      // High brightness (gamma keeps more headroom)
      expect(learning.applyBiasTo(0.8)).toBeCloseTo(0.96, 2);

      // All adjustments feel proportionally similar due to gamma correction
    });
  });
});
