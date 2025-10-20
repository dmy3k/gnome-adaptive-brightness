UUID = $(shell grep -oP '(?<="uuid": ")[^"]+' metadata.json)
LIB_DIR = lib
TESTS_DIR = tests
SCHEMAS_DIR = schemas

.PHONY: all build install uninstall enable disable test clean compile-schemas

all: build

compile-schemas:
	@echo "Compiling GSettings schemas..."
	@glib-compile-schemas $(SCHEMAS_DIR)/
	@echo "Schemas compiled."

build: compile-schemas
	@echo "Building extension..."
	@gnome-extensions pack --force --extra-source=$(LIB_DIR) .
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
	@rm -f $(PO_DIR)/*.mo
	@rm -f $(UUID).shell-extension.zip
	@echo "Cleaned build artifacts."
