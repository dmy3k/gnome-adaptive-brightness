/**
 * Mock for GNOME Shell's fileUtils
 */

export function loadInterfaceXML(iface) {
  // Return mock XML for known interfaces
  const interfaces = {
    'org.gnome.SettingsDaemon.Power.Screen': `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite">
      <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/>
    </property>
  </interface>
</node>`,
    'org.gnome.SettingsDaemon.Power.Keyboard': `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Keyboard">
    <property name="Brightness" type="i" access="readwrite">
      <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/>
    </property>
    <property name="Steps" type="i" access="read"/>
  </interface>
</node>`,
  };

  if (interfaces[iface]) {
    return interfaces[iface];
  }

  throw new Error(`Unknown interface: ${iface}`);
}
