import { describe, it, expect, beforeEach } from "@jest/globals";
import { BrightnessAnimator } from "../lib/BrightnessAnimator.js";

describe("BrightnessAnimator", () => {
  let animator;

  beforeEach(() => {
    animator = new BrightnessAnimator();
  });

  describe("animate", () => {
    it("should yield target immediately when current is null", () => {
      const steps = [...animator.animate(null, 50)];

      expect(steps).toEqual([50]);
    });

    it("should yield target immediately when current equals target", () => {
      const steps = [...animator.animate(50, 50)];

      expect(steps).toEqual([50]);
    });

    it("should yield target immediately for small differences (< 2 steps)", () => {
      const steps = [...animator.animate(50, 51)];

      expect(steps).toEqual([51]);
    });

    it("should generate correct upward animation steps", () => {
      const steps = [...animator.animate(10, 15)];

      expect(steps).toEqual([11, 12, 13, 14, 15]);
    });

    it("should generate correct downward animation steps", () => {
      const steps = [...animator.animate(20, 15)];

      expect(steps).toEqual([19, 18, 17, 16, 15]);
    });

    it("should handle large upward changes", () => {
      const steps = [...animator.animate(0, 10)];

      expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(steps.length).toBe(10);
    });

    it("should handle large downward changes", () => {
      const steps = [...animator.animate(100, 90)];

      expect(steps).toEqual([99, 98, 97, 96, 95, 94, 93, 92, 91, 90]);
      expect(steps.length).toBe(10);
    });

    it("should always end with exact target value", () => {
      const steps1 = [...animator.animate(10, 20)];
      expect(steps1[steps1.length - 1]).toBe(20);

      const steps2 = [...animator.animate(50, 30)];
      expect(steps2[steps2.length - 1]).toBe(30);
    });

    it("should support custom step size", () => {
      const steps = [...animator.animate(10, 20, { stepSize: 2 })];

      // With stepSize 2, should be [12, 14, 16, 18, 20]
      expect(steps).toEqual([12, 14, 16, 18, 20]);
    });

    it("should support custom minSteps threshold", () => {
      const steps1 = [...animator.animate(10, 12, { minSteps: 2 })];
      expect(steps1).toEqual([12]); // Difference is 2, equal to minSteps

      const steps2 = [...animator.animate(10, 13, { minSteps: 2 })];
      expect(steps2).toEqual([11, 12, 13]); // Difference is 3, greater than minSteps
    });

    it("should handle animation from 0", () => {
      const steps = [...animator.animate(0, 5)];

      expect(steps).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle animation to 0", () => {
      const steps = [...animator.animate(5, 0)];

      expect(steps).toEqual([4, 3, 2, 1, 0]);
    });

    it("should handle animation from 100", () => {
      const steps = [...animator.animate(100, 95)];

      expect(steps).toEqual([99, 98, 97, 96, 95]);
    });

    it("should handle animation to 100", () => {
      const steps = [...animator.animate(95, 100)];

      expect(steps).toEqual([96, 97, 98, 99, 100]);
    });

    it("should be lazy - not compute all steps upfront", () => {
      const generator = animator.animate(0, 100);

      // Get first step
      const first = generator.next();
      expect(first.value).toBe(1);
      expect(first.done).toBe(false);

      // Get second step
      const second = generator.next();
      expect(second.value).toBe(2);
      expect(second.done).toBe(false);
    });

    it("should support partial consumption of steps", () => {
      const generator = animator.animate(10, 20);

      // Consume only first 3 steps
      const step1 = generator.next();
      const step2 = generator.next();
      const step3 = generator.next();

      expect(step1.value).toBe(11);
      expect(step2.value).toBe(12);
      expect(step3.value).toBe(13);

      // Can still continue
      const step4 = generator.next();
      expect(step4.value).toBe(14);
    });
  });

  describe("integration scenarios", () => {
    it("should handle multiple sequential animations", () => {
      const steps1 = [...animator.animate(0, 5)];
      expect(steps1).toEqual([1, 2, 3, 4, 5]);

      const steps2 = [...animator.animate(50, 45)];
      expect(steps2).toEqual([49, 48, 47, 46, 45]);

      const steps3 = [...animator.animate(10, 10)];
      expect(steps3).toEqual([10]);
    });

    it("should generate consistent results for same inputs", () => {
      const steps1 = [...animator.animate(20, 30)];
      const steps2 = [...animator.animate(20, 30)];

      expect(steps1).toEqual(steps2);
    });

    it("should work with spread operator", () => {
      const steps = [...animator.animate(10, 15)];

      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBe(5);
    });

    it("should work with for...of loop", () => {
      const collected = [];

      for (const brightness of animator.animate(10, 15)) {
        collected.push(brightness);
      }

      expect(collected).toEqual([11, 12, 13, 14, 15]);
    });

    it("should work with manual iteration", () => {
      const generator = animator.animate(10, 13);
      const results = [];

      let result = generator.next();
      while (!result.done) {
        results.push(result.value);
        result = generator.next();
      }

      expect(results).toEqual([11, 12, 13]);
    });
  });
});
