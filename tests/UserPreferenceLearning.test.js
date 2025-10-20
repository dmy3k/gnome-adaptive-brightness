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
      expect(new UserPreferenceLearning(2.5).biasRatio).toBe(2.5);
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

    it('should clamp bias to maximum (2.5)', () => {
      const result = learning.updateBiasFromManualAdjustment(100, 20);
      expect(result).toBe(2.5);
      expect(learning.biasRatio).toBe(2.5);
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

    it('should clamp value above maximum to 2.5', () => {
      const result = learning.smoothAndClampBias(3.0);
      expect(result).toBe(2.5);
    });

    it('should handle minimum edge value', () => {
      const result = learning.smoothAndClampBias(0.2);
      expect(result).toBe(0.2);
    });

    it('should handle maximum edge value', () => {
      const result = learning.smoothAndClampBias(2.5);
      expect(result).toBe(2.5);
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

    it('should apply positive bias', () => {
      learning.biasRatio = 2.0;
      const result = learning.applyBiasTo(50);
      expect(result).toBe(100);
    });

    it('should apply negative bias', () => {
      learning.biasRatio = 0.5;
      const result = learning.applyBiasTo(50);
      expect(result).toBe(25);
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

    it('should round fractional results', () => {
      learning.biasRatio = 1.5;
      const result = learning.applyBiasTo(33);
      expect(result).toBe(50); // 33 * 1.5 = 49.5, rounded to 50
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
      expect(learning.biasRatio).toBe(2.5);
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
      learning.biasRatio = 2.5;
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

    it('should maintain bias across brightness applications', () => {
      learning.updateBiasFromManualAdjustment(80, 40);

      const result1 = learning.applyBiasTo(30);
      expect(result1).toBe(60);

      const result2 = learning.applyBiasTo(50);
      expect(result2).toBe(100);
    });

    it('should reset and allow new learning', () => {
      learning.updateBiasFromManualAdjustment(80, 40);
      expect(learning.biasRatio).toBe(2.0);

      learning.reset();
      expect(learning.biasRatio).toBe(1.0);

      learning.updateBiasFromManualAdjustment(30, 60);
      expect(learning.biasRatio).toBe(0.5);
    });
  });
});
