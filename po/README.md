# Translation Guide

This directory contains translation files for the Adaptive Brightness GNOME Shell extension.

## For Translators

### Creating a New Translation

1. Copy the template file `adaptive-brightness@dmy3k.github.io.pot` to create your language file:

   ```bash
   cp adaptive-brightness@dmy3k.github.io.pot <language_code>.po
   ```

   For example:
   - `es.po` for Spanish
   - `fr.po` for French
   - `de.po` for German
   - `zh_CN.po` for Simplified Chinese
   - `pt_BR.po` for Brazilian Portuguese

2. Edit the `.po` file header with your information:
   - Update `Last-Translator` with your name and email
   - Update `Language-Team` with your language team
   - Update `Language` with your language code
   - Update `PO-Revision-Date` with the current date

3. Translate the strings:
   - Each translatable string is marked with `msgid`
   - Add your translation after `msgstr`
   - Keep placeholders like `%s`, `%d`, `%f` in the same positions
   - Preserve special characters and formatting

### Example Translation Entry

```po
#: extension.js
msgid "Adaptive Brightness"
msgstr "Luminosité Adaptive"  # French translation
```

### Format Specifiers

The following format specifiers are used in the strings:

- `%s` - String placeholder
- `%d` - Integer placeholder
- `%f` - Floating point placeholder
- `%%` - Literal percent sign

**Important:** Do not change or remove these placeholders in your translation.

### Testing Your Translation

1. Save your `.po` file in this directory
2. Build the extension:
   ```bash
   make clean
   make build
   ```
3. Install and enable the extension to see your translation

## For Developers

### Updating the Translation Template

When you add new translatable strings to the code:

1. Mark strings for translation using the `_()` function
2. Update the POT template:
   ```bash
   make update-pot
   ```
3. Update existing translations:
   ```bash
   msgmerge --update po/<language>.po po/adaptive-brightness@dmy3k.github.io.pot
   ```

### Build Process

The build process automatically:

1. Compiles all `.po` files to `.mo` files
2. Places them in the correct locale directory structure
3. Includes them in the extension package

### Adding Translation Support to New Files

1. Add the file path to `POTFILES`
2. In the code, use `this._('String to translate')` for translatable strings
3. Ensure the gettext function is available in the class/module
4. Run `make update-pot` to regenerate the template

## Contributing Translations

We welcome translations! To contribute:

1. Fork the repository
2. Create your translation following the guide above
3. Test your translation
4. Submit a pull request with your `.po` file

For questions or help, please open an issue on GitHub.
