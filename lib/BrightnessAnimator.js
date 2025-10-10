/**
 * Pure animation logic using generators
 * No timeouts, no callbacks - just yields animation steps
 * This allows the consumer to control timing and execution
 */
export class BrightnessAnimator {
  /**
   * Generate animation steps from current to target brightness
   * @param {number} current - Starting brightness
   * @param {number} target - Target brightness (0-100)
   * @param {Object} options - Animation options
   * @param {number} options.stepSize - Size of each step (default: 1)
   * @param {number} options.minSteps - Minimum steps for animation (default: 2)
   * @returns {Generator<number>} Yields brightness values for each step
   */
  *animate(current, target, { stepSize = 1, minSteps = 2 } = {}) {
    // If no current value or same as target, yield target immediately
    if (current === null || current === target) {
      yield target;
      return;
    }

    const difference = target - current;
    const absDifference = Math.abs(difference);

    // If difference too small, jump directly to target
    // Calculate number of steps that would be needed
    const numSteps = Math.ceil(absDifference / stepSize);
    if (numSteps <= minSteps) {
      yield target;
      return;
    }

    const direction = Math.sign(difference);
    let currentValue = current;

    // Yield intermediate steps
    while (Math.abs(target - currentValue) > stepSize) {
      currentValue += direction * stepSize;
      yield currentValue;
    }

    // Always end with exact target value
    yield target;
  }
}
