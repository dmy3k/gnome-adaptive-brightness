# Contributing

Bug reports, fixes and translations are welcome.

## Getting started

- Build and install from source: see [Installation](README.md#from-source).
- Translations: see [po/README.md](po/README.md).
- Tests: see [tests/README.md](tests/README.md).

## Making changes

- Keep pull requests focused on one concern.
- Wrap user-visible strings in `_()`, then run `make update-pot`.
- Anything created in `enable()` (signals, timeouts, D-Bus proxies) must be released in `disable()`.
- After editing the GSettings schema, run `glib-compile-schemas schemas/`.

## Tests

Tests for changes are highly encouraged. Add or update a test in `tests/` for every behavior change or bug fix in `lib/`, and make sure `make test` passes before opening a pull request.

GNOME modules (`gi://`, `resource://`) are mocked in `tests/__mocks__/`. If your code imports a new one, add a mock and a `moduleNameMapper` entry in `package.json`.

## Pull requests

Describe what changed and why, include a screenshot for UI changes, and note the GNOME Shell version you tested on.

## Translations

This extension supports internationalization (i18n) using gettext. All user-facing strings can be translated. For detailed instructions on translations to new languages, see [po/README.md](po/README.md).
