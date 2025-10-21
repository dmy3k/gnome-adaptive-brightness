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
      expect(new UserPreferenceLearning(0.2).biasRatio).toBe(0.2);
      expect(new UserPreferenceLearning(2.0).biasRatio).toBe(2.0);
      expect(new UserPreferenceLearning(3.0).biasRatio).toBe(3.0); // Not clamped in constructor
    });
  });

  describe('updateBiasFromManualAdjustment', () => {
    it('should update biasRatio based on manual vs automatic brightness', () => {
      const result = learning.updateBiasFromManualAdjustment(80, 40);
      expect(result).toBe(2.0);
      expect(learning.biasRatio).toBe(2.0);
    });

    it('should clamp bias to minimum (0.2)', () => {
      const result = learning.updateBiasFromManualAdjustment(5, 100);
      expect(result).toBe(0.2);
      expect(learning.biasRatio).toBe(0.2);
    });

    it('should clamp bias to maximum (2.0)', () => {
      const result = learning.updateBiasFromManualAdjustment(100, 20);
      expect(result).toBe(2.0);
      expect(learning.biasRatio).toBe(2.0);
    });

    it('should not update when automaticBrightness is 0', () => {
      learning.biasRatio = 1.5;
      const result = learning.updateBiasFromManualAdjustment(50, 0);
      expect(result).toBeUndefined();
      expect(learning.biasRatio).toBe(1.5);
    });

    it('should not update when automaticBrightness is negative', () => {
      learning.biasRatio = 1.5;
      const result = learning.updateBiasFromManualAdjustment(50, -10);
      expect(result).toBeUndefined();
      expect(learning.biasRatio).toBe(1.5);
    });

    it('should handle equal manual and automatic brightness', () => {
      const result = learning.updateBiasFromManualAdjustment(50, 50);
      expect(result).toBe(1.0);
      expect(learning.biasRatio).toBe(1.0);
    });
  });

  describe('smoothAndClampBias', () => {
    it('should return value within range unchanged', () => {
      const result = learning.smoothAndClampBias(1.5);
      expect(result).toBe(1.5);
    });

    it('should clamp value below minimum to 0.2', () => {
      const result = learning.smoothAndClampBias(0.1);
      expect(result).toBe(0.2);
    });

    it('should clamp value above maximum to 2.0', () => {
      const result = learning.smoothAndClampBias(3.0);
      expect(result).toBe(2.0);
    });

    it('should handle minimum edge value', () => {
      const result = learning.smoothAndClampBias(0.2);
      expect(result).toBe(0.2);
    });

    it('should handle maximum edge value', () => {
      const result = learning.smoothAndClampBias(2.0);
      expect(result).toBe(2.0);
    });

    it('should handle zero', () => {
      const result = learning.smoothAndClampBias(0);
      expect(result).toBe(0.2);
    });

    it('should handle negative values', () => {
      const result = learning.smoothAndClampBias(-1);
      expect(result).toBe(0.2);
    });
  });

  describe('applyBiasTo', () => {
    it('should apply bias correctly with default ratio', () => {
      const result = learning.applyBiasTo(50);
      expect(result).toBe(50);
    });

    it('should apply positive bias with gamma correction', () => {
      learning.biasRatio = 2.0;
      const result = learning.applyBiasTo(50);
      // Gamma correction: 50% with 2× bias = 69% (not linear 100%)
      expect(result).toBe(69);
    });

    it('should apply negative bias with gamma correction', () => {
      learning.biasRatio = 0.5;
      const result = learning.applyBiasTo(50);
      // Gamma correction: 50% with 0.5× bias = 36% (not linear 25%)
      expect(result).toBe(36);
    });

    it('should clamp result to minimum of 1', () => {
      learning.biasRatio = 0.2;
      const result = learning.applyBiasTo(1);
      expect(result).toBe(1);
    });

    it('should clamp result to maximum of 100', () => {
      learning.biasRatio = 2.0;
      const result = learning.applyBiasTo(99);
      expect(result).toBe(100);
    });

    it('should apply gamma correction for mid-range values', () => {
      learning.biasRatio = 1.5;
      const result = learning.applyBiasTo(50);
      // Gamma correction: 50% with 1.5× bias = 60% (not linear 75%)
      expect(result).toBe(60);
    });

    it('should handle brightness of 0', () => {
      learning.biasRatio = 1.5;
      const result = learning.applyBiasTo(0);
      expect(result).toBe(1); // Clamped to minimum
    });

    it('should handle brightness of 100', () => {
      learning.biasRatio = 1.5;
      const result = learning.applyBiasTo(100);
      expect(result).toBe(100); // Clamped to maximum
    });

    it('should preserve perceptual uniformity at low brightness', () => {
      learning.biasRatio = 2.0;
      const result = learning.applyBiasTo(25);
      // Gamma correction: 25% with 2× bias = 34% (not linear 50%)
      expect(result).toBe(34);
    });

    it('should preserve perceptual uniformity at high brightness', () => {
      learning.biasRatio = 0.5;
      const result = learning.applyBiasTo(80);
      // Gamma correction: 80% with 0.5× bias = 58% (not linear 40%)
      expect(result).toBe(58);
    });
  });

  describe('setBiasRatio', () => {
    it('should set and clamp bias ratio', () => {
      learning.setBiasRatio(1.5);
      expect(learning.biasRatio).toBe(1.5);
    });

    it('should clamp values below minimum', () => {
      learning.setBiasRatio(0.1);
      expect(learning.biasRatio).toBe(0.2);
    });

    it('should clamp values above maximum', () => {
      learning.setBiasRatio(3.0);
      expect(learning.biasRatio).toBe(2.0);
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
      learning.updateBiasFromManualAdjustment(80, 40); // 2.0
      expect(learning.biasRatio).toBe(2.0);

      learning.updateBiasFromManualAdjustment(50, 100); // 0.5
      expect(learning.biasRatio).toBe(0.5);

      learning.updateBiasFromManualAdjustment(60, 60); // 1.0
      expect(learning.biasRatio).toBe(1.0);
    });

    it('should maintain bias across brightness applications with gamma correction', () => {
      learning.updateBiasFromManualAdjustment(80, 40); // Sets bias to 2.0

      const result1 = learning.applyBiasTo(30);
      // Gamma correction: 30% with 2× bias = 41% (not linear 60%)
      expect(result1).toBe(41);

      const result2 = learning.applyBiasTo(50);
      // Gamma correction: 50% with 2× bias = 69% (not linear 100%)
      expect(result2).toBe(69);
    });

    it('should reset and allow new learning', () => {
      learning.updateBiasFromManualAdjustment(80, 40);
      expect(learning.biasRatio).toBe(2.0);

      learning.reset();
      expect(learning.biasRatio).toBe(1.0);

      learning.updateBiasFromManualAdjustment(30, 60);
      expect(learning.biasRatio).toBe(0.5);
    });

    it('should provide perceptually uniform adjustments across range', () => {
      learning.biasRatio = 1.5;

      // Low brightness
      expect(learning.applyBiasTo(20)).toBe(24);
      // Mid brightness
      expect(learning.applyBiasTo(50)).toBe(60);
      // High brightness (gamma keeps more headroom)
      expect(learning.applyBiasTo(80)).toBe(96);

      // All adjustments feel proportionally similar due to gamma correction
    });
  });
});
