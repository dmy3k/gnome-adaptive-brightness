import { describe, it, expect, beforeEach } from '@jest/globals';
import { BrightnessAnimator } from '../lib/BrightnessAnimator.js';

describe('BrightnessAnimator', () => {
  let animator;

  beforeEach(() => {
    animator = new BrightnessAnimator();
  });

  describe('animate', () => {
    it('should yield target immediately when current is null', () => {
      const steps = [...animator.animate(null, 0.5)];

      expect(steps).toEqual([0.5]);
    });

    it('should yield target immediately when current equals target', () => {
      const steps = [...animator.animate(0.5, 0.5)];

      expect(steps).toEqual([0.5]);
    });

    it('should yield target immediately for small differences (< 2 steps)', () => {
      const steps = [...animator.animate(0.5, 0.51)];

      expect(steps).toEqual([0.51]);
    });

    it('should generate correct upward animation steps', () => {
      const steps = [...animator.animate(0.1, 0.15)];

      expect(steps.length).toBe(5);
      expect(steps[0]).toBeCloseTo(0.11, 2);
      expect(steps[steps.length - 1]).toBe(0.15);
    });

    it('should generate correct downward animation steps', () => {
      const steps = [...animator.animate(0.2, 0.15)];

      expect(steps.length).toBe(5);
      expect(steps[0]).toBeCloseTo(0.19, 2);
      expect(steps[steps.length - 1]).toBe(0.15);
    });

    it('should handle large upward changes', () => {
      const steps = [...animator.animate(0, 0.1)];

      expect(steps.length).toBeGreaterThanOrEqual(10);
      expect(steps[0]).toBeCloseTo(0.01, 2);
      expect(steps[steps.length - 1]).toBe(0.1);
    });

    it('should handle large downward changes', () => {
      const steps = [...animator.animate(1.0, 0.9)];

      expect(steps.length).toBe(10);
      expect(steps[0]).toBeCloseTo(0.99, 2);
      expect(steps[steps.length - 1]).toBe(0.9);
    });

    it('should always end with exact target value', () => {
      const steps1 = [...animator.animate(0.1, 0.2)];
      expect(steps1[steps1.length - 1]).toBe(0.2);

      const steps2 = [...animator.animate(0.5, 0.3)];
      expect(steps2[steps2.length - 1]).toBe(0.3);
    });

    it('should support custom step size', () => {
      const steps = [...animator.animate(0.1, 0.2, { stepSize: 0.02 })];

      expect(steps.length).toBeGreaterThanOrEqual(5);
      expect(steps[0]).toBeCloseTo(0.12, 2);
      expect(steps[steps.length - 1]).toBe(0.2);
    });

    it('should support custom minSteps threshold', () => {
      const steps1 = [...animator.animate(0.1, 0.12, { minSteps: 2 })];
      expect(steps1.length).toBe(1);
      expect(steps1[0]).toBe(0.12);

      const steps2 = [...animator.animate(0.1, 0.13, { minSteps: 2 })];
      expect(steps2.length).toBeGreaterThanOrEqual(3);
      expect(steps2[steps2.length - 1]).toBe(0.13);
    });

    it('should handle animation from 0', () => {
      const steps = [...animator.animate(0, 0.05)];

      expect(steps.length).toBeGreaterThanOrEqual(5);
      expect(steps[0]).toBeCloseTo(0.01, 2);
      expect(steps[steps.length - 1]).toBe(0.05);
    });

    it('should handle animation to 0', () => {
      const steps = [...animator.animate(0.05, 0)];

      expect(steps.length).toBe(5);
      expect(steps[0]).toBeCloseTo(0.04, 2);
      expect(steps[steps.length - 1]).toBe(0);
    });

    it('should handle animation from 1.0', () => {
      const steps = [...animator.animate(1.0, 0.95)];

      expect(steps.length).toBeGreaterThanOrEqual(5);
      expect(steps[0]).toBeCloseTo(0.99, 2);
      expect(steps[steps.length - 1]).toBe(0.95);
    });

    it('should handle animation to 1.0', () => {
      const steps = [...animator.animate(0.95, 1.0)];

      expect(steps.length).toBeGreaterThanOrEqual(5);
      expect(steps[0]).toBeCloseTo(0.96, 2);
      expect(steps[steps.length - 1]).toBe(1.0);
    });

    it('should be lazy - not compute all steps upfront', () => {
      const generator = animator.animate(0, 1.0);

      // Get first step
      const first = generator.next();
      expect(first.value).toBe(0.01);
      expect(first.done).toBe(false);

      // Get second step
      const second = generator.next();
      expect(second.value).toBe(0.02);
      expect(second.done).toBe(false);
    });

    it('should support partial consumption of steps', () => {
      const generator = animator.animate(0.1, 0.2);

      // Consume only first 3 steps
      const step1 = generator.next();
      const step2 = generator.next();
      const step3 = generator.next();

      expect(step1.value).toBe(0.11);
      expect(step2.value).toBe(0.12);
      expect(step3.value).toBe(0.13);

      // Can still continue
      const step4 = generator.next();
      expect(step4.value).toBe(0.14);
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple sequential animations', () => {
      const steps1 = [...animator.animate(0, 0.05)];
      expect(steps1.length).toBeGreaterThanOrEqual(5);
      expect(steps1[steps1.length - 1]).toBe(0.05);

      const steps2 = [...animator.animate(0.5, 0.45)];
      expect(steps2.length).toBeGreaterThanOrEqual(5);
      expect(steps2[steps2.length - 1]).toBe(0.45);

      const steps3 = [...animator.animate(0.1, 0.1)];
      expect(steps3).toEqual([0.1]);
    });

    it('should generate consistent results for same inputs', () => {
      const steps1 = [...animator.animate(0.2, 0.3)];
      const steps2 = [...animator.animate(0.2, 0.3)];

      expect(steps1).toEqual(steps2);
    });

    it('should work with spread operator', () => {
      const steps = [...animator.animate(0.1, 0.15)];

      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBe(5);
    });

    it('should work with for...of loop', () => {
      const collected = [];

      for (const brightness of animator.animate(0.1, 0.15)) {
        collected.push(brightness);
      }

      expect(collected.length).toBe(5);
      expect(collected[collected.length - 1]).toBe(0.15);
    });

    it('should work with manual iteration', () => {
      const generator = animator.animate(0.1, 0.13);
      const results = [];

      let result = generator.next();
      while (!result.done) {
        results.push(result.value);
        result = generator.next();
      }

      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results[results.length - 1]).toBe(0.13);
    });
  });
});
