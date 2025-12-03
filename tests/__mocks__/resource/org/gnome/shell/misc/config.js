/**
 * Mock for GNOME Shell's config module
 */

// Default to GNOME 49.2 for testing bias slider behavior
export let PACKAGE_VERSION = '49.2';

// Helper to change version for testing
export function setPackageVersion(version) {
  PACKAGE_VERSION = version;
}
