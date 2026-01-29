UUID = $(shell grep -oP '(?<="uuid": ")[^"]+' metadata.json)
TESTS_DIR = tests
SCHEMAS_DIR = schemas
PO_DIR = po
LOCALE_DIR = locale

.PHONY: all build install uninstall enable disable test clean update-pot

all: build

update-pot:
	@echo "Updating translation template..."
	@xgettext --from-code=UTF-8 --output=$(PO_DIR)/$(UUID).pot \
		--package-name="Adaptive Brightness" \
		--package-version="1.0" \
		--msgid-bugs-address="https://github.com/dmy3k/gnome-adaptive-brightness/issues" \
		--keyword=_ \
		--add-comments=TRANSLATORS \
		extension.js prefs.js lib/*.js preferences/*.js
	@echo "Translation template updated: $(PO_DIR)/$(UUID).pot"

build:
	@echo "Building extension..."
	@gnome-extensions pack --force --extra-source=lib --extra-source=preferences --podir=$(PO_DIR) .
	@echo "Build complete: $(UUID).shell-extension.zip"

install: build
	@echo "Installing extension..."
	@gnome-extensions install --force $(UUID).shell-extension.zip
	@echo "Extension installed. Restart Gnome session (logout & login) to be able to activate the extension"

uninstall:
	@gnome-extensions uninstall $(UUID) || true
	@echo "Extension uninstalled."

enable:
	@echo "Enabling extension..."
	@gnome-extensions enable $(UUID) || echo ">>> Restart Gnome session (logout & login) and run this command again"

disable:
	@echo "Disabling extension..."
	@gnome-extensions disable $(UUID)

test:
	@echo "Running tests..."
	@yarn check --verify-tree || yarn install --ignore-optional --non-interactive; yarn test

clean:
	@rm -f $(SCHEMAS_DIR)/*.compiled
	@rm -rf $(LOCALE_DIR)
	@rm -f $(UUID).shell-extension.zip
	@echo "Cleaned build artifacts."
