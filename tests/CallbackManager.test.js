import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CallbackManager } from "../lib/CallbackManager.js";

describe("CallbackManager", () => {
  let manager;

  beforeEach(() => {
    manager = new CallbackManager();
  });

  describe("constructor", () => {
    it("should create an instance", () => {
      expect(manager).toBeInstanceOf(CallbackManager);
    });

    it("should initialize with zero callbacks", () => {
      expect(manager.size).toBe(0);
    });
  });

  describe("add", () => {
    it("should add a callback and return an ID", () => {
      const callback = jest.fn();
      const id = manager.add(callback);

      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
      expect(manager.size).toBe(1);
    });

    it("should add multiple callbacks with unique IDs", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      const id1 = manager.add(callback1);
      const id2 = manager.add(callback2);
      const id3 = manager.add(callback3);

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(manager.size).toBe(3);
    });

    it("should throw error for non-function callback", () => {
      expect(() => manager.add(null)).toThrow();
      expect(() => manager.add("not a function")).toThrow();
      expect(() => manager.add(123)).toThrow();
      expect(() => manager.add({})).toThrow();
    });
  });

  describe("remove", () => {
    it("should remove a callback by ID", () => {
      const callback = jest.fn();
      const id = manager.add(callback);

      const removed = manager.remove(id);

      expect(removed).toBe(true);
      expect(manager.size).toBe(0);
    });

    it("should return false for non-existent ID", () => {
      const removed = manager.remove(999);
      expect(removed).toBe(false);
    });

    it("should only remove the specified callback", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      const id1 = manager.add(callback1);
      const id2 = manager.add(callback2);
      const id3 = manager.add(callback3);

      manager.remove(id2);

      expect(manager.size).toBe(2);
      manager.invoke(42);
      expect(callback1).toHaveBeenCalledWith(42);
      expect(callback2).not.toHaveBeenCalled();
      expect(callback3).toHaveBeenCalledWith(42);
    });
  });

  describe("invoke", () => {
    it("should invoke all registered callbacks", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      manager.add(callback1);
      manager.add(callback2);
      manager.add(callback3);

      manager.invoke(42, "test");

      expect(callback1).toHaveBeenCalledWith(42, "test");
      expect(callback2).toHaveBeenCalledWith(42, "test");
      expect(callback3).toHaveBeenCalledWith(42, "test");
    });

    it("should handle no callbacks gracefully", () => {
      expect(() => manager.invoke(42)).not.toThrow();
    });

    it("should catch and log errors in individual callbacks", () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const goodCallback = jest.fn();
      const badCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const anotherGoodCallback = jest.fn();

      manager.add(goodCallback);
      manager.add(badCallback);
      manager.add(anotherGoodCallback);

      manager.invoke(42);

      // All callbacks should be attempted
      expect(goodCallback).toHaveBeenCalledWith(42);
      expect(badCallback).toHaveBeenCalledWith(42);
      expect(anotherGoodCallback).toHaveBeenCalledWith(42);

      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should pass all arguments to callbacks", () => {
      const callback = jest.fn();
      manager.add(callback);

      manager.invoke("a", "b", "c", 1, 2, 3, { key: "value" }, [1, 2, 3]);

      expect(callback).toHaveBeenCalledWith(
        "a",
        "b",
        "c",
        1,
        2,
        3,
        { key: "value" },
        [1, 2, 3]
      );
    });
  });

  describe("clear", () => {
    it("should remove all callbacks", () => {
      manager.add(jest.fn());
      manager.add(jest.fn());
      manager.add(jest.fn());

      expect(manager.size).toBe(3);

      manager.clear();

      expect(manager.size).toBe(0);
    });

    it("should allow adding callbacks after clear", () => {
      manager.add(jest.fn());
      manager.clear();

      const callback = jest.fn();
      const id = manager.add(callback);

      expect(id).toBeGreaterThan(0);
      expect(manager.size).toBe(1);

      manager.invoke(42);
      expect(callback).toHaveBeenCalledWith(42);
    });
  });

  describe("integration scenarios", () => {
    it("should support typical add-invoke-remove workflow", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const id1 = manager.add(callback1);
      const id2 = manager.add(callback2);

      manager.invoke(1);
      expect(callback1).toHaveBeenCalledWith(1);
      expect(callback2).toHaveBeenCalledWith(1);

      manager.remove(id1);
      manager.invoke(2);
      expect(callback1).toHaveBeenCalledTimes(1); // Not called again
      expect(callback2).toHaveBeenCalledWith(2);

      manager.clear();
      manager.invoke(3);
      expect(callback1).toHaveBeenCalledTimes(1); // Still once
      expect(callback2).toHaveBeenCalledTimes(2); // Still twice
    });

    it("should handle multiple registrations and removals", () => {
      const callbacks = [];
      const ids = [];

      // Add 10 callbacks
      for (let i = 0; i < 10; i++) {
        const callback = jest.fn();
        callbacks.push(callback);
        ids.push(manager.add(callback));
      }

      expect(manager.size).toBe(10);

      // Remove every other callback
      for (let i = 0; i < 10; i += 2) {
        manager.remove(ids[i]);
      }

      expect(manager.size).toBe(5);

      // Invoke and verify only odd-indexed callbacks are called
      manager.invoke(42);
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          expect(callbacks[i]).not.toHaveBeenCalled();
        } else {
          expect(callbacks[i]).toHaveBeenCalledWith(42);
        }
      }
    });
  });
});
