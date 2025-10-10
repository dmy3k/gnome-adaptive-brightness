import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { NotificationService } from "../lib/NotificationService.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

describe("NotificationService", () => {
  let service;

  beforeEach(() => {
    service = new NotificationService();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
  });

  describe("constructor", () => {
    it("should initialize with null source and notification", () => {
      expect(service._source).toBeNull();
      expect(service._currentNotification).toBeNull();
    });
  });

  describe("showNotification", () => {
    it("should create a notification with title and body", () => {
      service.showNotification("Test Title", "Test Body");

      expect(service._source).not.toBeNull();
      expect(service._currentNotification).not.toBeNull();
      expect(service._currentNotification.title).toBe("Test Title");
      expect(service._currentNotification.body).toBe("Test Body");
    });

    it("should create source with appropriate properties", () => {
      service.showNotification("Test", "Message");

      expect(service._source.title).toBe("Adaptive Brightness");
      expect(service._source.iconName).toBe("display-brightness-symbolic");
    });

    it("should set notification as transient by default", () => {
      service.showNotification("Test", "Message");

      expect(service._currentNotification.isTransient).toBe(true);
    });

    it("should set notification as non-transient when specified", () => {
      service.showNotification("Test", "Message", { transient: false });

      expect(service._currentNotification.isTransient).toBe(false);
    });

    it("should add activation callback when provided", () => {
      const onActivate = jest.fn();
      service.showNotification("Test", "Message", { onActivate });

      service._currentNotification.activate();

      expect(onActivate).toHaveBeenCalled();
    });

    it("should handle activation callback error gracefully", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
      const onActivate = jest.fn(() => {
        throw new Error("Callback error");
      });

      service.showNotification("Test", "Message", { onActivate });
      service._currentNotification.activate();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should add action button when provided", () => {
      const actionCallback = jest.fn();
      service.showNotification("Test", "Message", {
        action: {
          label: "Action Label",
          callback: actionCallback,
        },
      });

      const action = service._currentNotification._actions[0];
      expect(action.label).toBe("Action Label");

      action.callback();
      expect(actionCallback).toHaveBeenCalled();
    });

    it("should handle action callback error gracefully", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
      const actionCallback = jest.fn(() => {
        throw new Error("Action error");
      });

      service.showNotification("Test", "Message", {
        action: {
          label: "Action",
          callback: actionCallback,
        },
      });

      service._currentNotification._actions[0].callback();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should destroy previous notification when showing new one", () => {
      service.showNotification("First", "Message");
      const firstNotification = service._currentNotification;
      const destroySpy = jest.spyOn(firstNotification, "destroy");

      service.showNotification("Second", "Message");

      expect(destroySpy).toHaveBeenCalled();
      expect(service._currentNotification).not.toBe(firstNotification);
      expect(service._currentNotification.title).toBe("Second");
    });

    it("should recreate source if it was destroyed", () => {
      service.showNotification("First", "Message");
      const firstSource = service._source;

      firstSource.destroy();

      service.showNotification("Second", "Message");

      expect(service._source).not.toBe(firstSource);
      expect(service._source.isDestroyed).toBe(false);
    });

    it("should clear notification reference when notification is destroyed", () => {
      service.showNotification("Test", "Message");

      service._currentNotification.destroy();

      expect(service._currentNotification).toBeNull();
    });

    it("should clear source reference when source is destroyed", () => {
      service.showNotification("Test", "Message");

      service._source.destroy();

      expect(service._source).toBeNull();
      expect(service._currentNotification).toBeNull();
    });
  });

  describe("destroy", () => {
    it("should destroy current notification", () => {
      service.showNotification("Test", "Message");
      const notification = service._currentNotification;
      const destroySpy = jest.spyOn(notification, "destroy");

      service.destroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(service._currentNotification).toBeNull();
    });

    it("should destroy source", () => {
      service.showNotification("Test", "Message");
      const source = service._source;
      const destroySpy = jest.spyOn(source, "destroy");

      service.destroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(service._source).toBeNull();
    });

    it("should handle notification already destroyed", () => {
      service.showNotification("Test", "Message");
      service._currentNotification.destroy();

      expect(() => service.destroy()).not.toThrow();
    });

    it("should handle source already destroyed", () => {
      service.showNotification("Test", "Message");
      service._source.destroy();

      expect(() => service.destroy()).not.toThrow();
    });

    it("should handle destroy when no notification exists", () => {
      expect(() => service.destroy()).not.toThrow();
    });

    it("should handle multiple destroy calls", () => {
      service.showNotification("Test", "Message");
      service.destroy();
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle multiple notifications in sequence", () => {
      service.showNotification("First", "Message 1");
      expect(service._currentNotification.title).toBe("First");

      service.showNotification("Second", "Message 2");
      expect(service._currentNotification.title).toBe("Second");

      service.showNotification("Third", "Message 3");
      expect(service._currentNotification.title).toBe("Third");
    });

    it("should handle notification with activation and action", () => {
      const onActivate = jest.fn();
      const actionCallback = jest.fn();

      service.showNotification("Test", "Message", {
        onActivate,
        action: {
          label: "Do Something",
          callback: actionCallback,
        },
      });

      service._currentNotification.activate();
      expect(onActivate).toHaveBeenCalled();

      service._currentNotification._actions[0].callback();
      expect(actionCallback).toHaveBeenCalled();
    });

    it("should maintain source across multiple notifications", () => {
      service.showNotification("First", "Message");
      const source = service._source;

      service.showNotification("Second", "Message");

      expect(service._source).toBe(source);
    });
  });
});
