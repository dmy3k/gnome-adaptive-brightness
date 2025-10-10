/**
 * Mock for GNOME Shell Extension base class
 */

export class Extension {
  constructor(metadata = {}) {
    this.metadata = metadata;
    this.path = metadata.path || "/test/path";
    this.uuid = metadata.uuid || "test-extension@test.com";
    this.dir = {
      get_path: () => this.path,
    };
  }

  getSettings(schema) {
    // This would normally return a Gio.Settings instance
    // For testing, we'll return a mock settings object
    return {
      get_int: jest.fn(),
      set_int: jest.fn(),
      get_boolean: jest.fn(),
      set_boolean: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
  }

  // Methods that can be overridden by extension
  enable() {
    // Override in subclass
  }

  disable() {
    // Override in subclass
  }
}

export default {
  Extension,
};
