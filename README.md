# Adaptive brightness

GNOME Shell extension that automatically adjusts your screen brightness based on ambient light conditions, helping to reduce eye strain and save energy.

ALS (ambient light sensor) is required for extesion to operate.

# Background

GNOME includes "Automatic Screen Brightness" feature, under Settings -> Power -> Power Saving.
It has a number of issues reported that make it challenging to use in some scenarios (e.g [#277](https://gitlab.gnome.org/GNOME/gnome-settings-daemon/-/issues/277), [#82](https://gitlab.gnome.org/GNOME/gnome-settings-daemon/-/issues/82), [#237](https://gitlab.gnome.org/GNOME/gnome-settings-daemon/-/merge_requests/237)).

This extension addresses some of the issues with custom implementation:

- **Improved Algorithm**: More stable under often changing light conditions
- **Smooth Transitions**: Gradually changes brightness to avoid jarring jumps
- **Respects System States**: Better coexistence with brightness set by user and system states (display dim/off)

# Installation

### From source

Typically this is needed for testing and development. Clone the repo, pack and install the extension.

```bash
git clone git@github.com:dmy3k/gnome-extension-adaptive-brightness.git && cd gnome-extension-adaptive-brightness

make install
make enable
```
