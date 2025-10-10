/**
 * Manages multiple callbacks for an event
 *
 * @example
 * const onChange = new CallbackManager();
 * const id1 = onChange.add((value) => console.log('Listener 1:', value));
 * const id2 = onChange.add((value) => console.log('Listener 2:', value));
 * onChange.invoke(50); // Invokes both listeners
 * onChange.remove(id1); // Remove specific listener
 * onChange.clear(); // Remove all listeners
 */
export class CallbackManager {
  constructor() {
    this._callbacks = new Map();
    this._nextId = 1;

    // Capture stack trace and use the line where CallbackManager was constructed
    const err = new Error();
    const stackLines = err.stack ? err.stack.split("\n") : [];
    this._name = stackLines[2] ? stackLines[2].trim() : "unknown";
  }

  /**
   * Register a callback
   * @param {Function} callback - Function to call when event fires
   * @returns {number} Callback ID for removal
   */
  add(callback) {
    if (typeof callback !== "function") {
      throw new Error(
        `CallbackManager(${this._name}): callback must be a function`
      );
    }

    const id = this._nextId++;
    this._callbacks.set(id, callback);
    return id;
  }

  /**
   * Remove a callback by ID
   * @param {number} id - Callback ID returned from add()
   * @returns {boolean} True if callback was found and removed
   */
  remove(id) {
    return this._callbacks.delete(id);
  }

  /**
   * Invoke all registered callbacks with the given arguments
   * Errors in individual callbacks are caught and logged
   * @param {...any} args - Arguments to pass to each callback
   */
  invoke(...args) {
    for (const [id, callback] of this._callbacks) {
      try {
        callback(...args);
      } catch (error) {
        console.error(
          `CallbackManager(${this._name}): Error in callback ${id}:`,
          error
        );
      }
    }
  }

  clear() {
    this._callbacks.clear();
  }

  get size() {
    return this._callbacks.size;
  }
}
