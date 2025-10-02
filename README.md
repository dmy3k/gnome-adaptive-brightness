# Adaptive brightness

Adaptive Brightness is a GNOME Shell extension that automatically adjusts your screen brightness based on ambient light conditions, helping to reduce eye strain and save energy.

## Installation

### From source

Typically this is needed for testing and development. Clone the repo, pack and install the extension.

```bash
# Build
gnome-extensions pack --force

# Install and activate
gnome-extensions install --force adaptive-brightness@example.com.shell-extension.zip
gnome-extensions enable adaptive-brightness@example.com
```

Extension will appear in the list of extensions and will be activated after you logout and log back in.
