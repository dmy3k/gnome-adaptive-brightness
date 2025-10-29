export class BrightnessAnimator {
  *animate(current, target, { stepSize = 0.01, minSteps = 2, maxSteps = 100 } = {}) {
    // If no current value or same as target, yield target immediately
    if (current === null || current === target) {
      yield target;
      return;
    }

    const difference = target - current;
    const absDifference = Math.abs(difference);

    // Calculate number of steps that would be needed using preferred stepSize
    let numSteps = Math.ceil(absDifference / stepSize);

    // If the preferred stepSize would produce too many steps, increase stepSize
    if (numSteps > maxSteps) {
      stepSize = absDifference / maxSteps;
      numSteps = Math.ceil(absDifference / stepSize);
    }

    // If difference too small, jump directly to target
    if (numSteps <= minSteps) {
      yield target;
      return;
    }

    const direction = Math.sign(difference);
    let currentValue = current;

    // Yield intermediate steps
    // Use epsilon comparison to avoid floating point precision issues
    const epsilon = stepSize * 0.1;
    while (Math.abs(target - currentValue) > epsilon) {
      currentValue += direction * stepSize;
      // Ensure we don't overshoot the target
      if ((direction > 0 && currentValue > target) || (direction < 0 && currentValue < target)) {
        break;
      }
      yield currentValue;
    }

    // Always end with exact target value
    yield target;
  }
}
