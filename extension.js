import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export default class AdaptiveBrightnessExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._proxy = null;
        this._signalId = null;
        this._powerProxy = null;
        this._currentBrightnessBucket = -1; // Track current bucket for hysteresis
        this._lastUpdateTime = 0; // Track last brightness update
        this._pendingLuxValue = null; // Store pending lux value
        this._pendingTimeout = null; // Timeout for delayed updates
        this._currentBrightness = null; // Track current brightness for smooth transitions
        this._animationTimeout = null; // Timeout for brightness animation
        this._powerSettings = null; // GSettings for power management
        this._settingsSignalId = null; // GSettings signal connection
        this._isScreenDimmed = false; // Track if screen is dimmed/off
        this._idleBrightness = 30; // Default idle brightness (will be read from settings)
        this._settingBrightness = false; // Flag to track when WE are setting brightness
        this._powerPropertiesSignalId = null; // D-Bus signal for brightness changes
        
        // Stability-focused brightness buckets - wider ranges, fewer changes
        // Prioritizes stable brightness over precise light matching
        this._brightnessBuckets = [
            { min: 0,    max: 10,    brightness: 10 },   // Night
            { min: 5,    max: 200,   brightness: 25 },   // Very dark to dim indoor
            { min: 50,   max: 650,   brightness: 50 },   // Dim to normal indoor
            { min: 350,  max: 2000,  brightness: 75 },   // Normal to bright indoor
            { min: 1000, max: 10000, brightness: 100 }   // Bright indoor to outdoor
        ];
    }

    enable() {
        console.log('Adaptive Brightness extension enabled');
        
        // Initialize power settings monitoring
        this._initPowerSettings();
        
        // Create D-Bus proxy for IIO sensor proxy
        this._initSensorProxy();
        this._initPowerProxy();
    }

    async _initSensorProxy() {
        try {
            this._proxy = await new Promise((resolve, reject) => {
                Gio.DBusProxy.new(
                    Gio.bus_get_sync(Gio.BusType.SYSTEM, null),
                    Gio.DBusProxyFlags.NONE,
                    null,
                    'net.hadess.SensorProxy',
                    '/net/hadess/SensorProxy',
                    'net.hadess.SensorProxy',
                    null,
                    (source, result) => {
                        try {
                            const proxy = Gio.DBusProxy.new_finish(result);
                            resolve(proxy);
                        } catch (error) {
                            reject(error);
                        }
                    }
                );
            });

            // Connect to ambient light level changes
            this._signalId = this._proxy.connect('g-properties-changed', 
                this._onPropertiesChanged.bind(this));

            // Claim the light sensor asynchronously
            this._proxy.call(
                'ClaimLight', 
                null, 
                Gio.DBusCallFlags.NONE, 
                -1, 
                null,
                (source, result) => {
                    try {
                        source.call_finish(result);
                        console.log('IIO sensor proxy connected successfully');
                    } catch (error) {
                        console.error('Failed to claim light sensor:', error);
                    }
                }
            );
        } catch (error) {
            console.error('Failed to connect to IIO sensor proxy:', error);
        }
    }

    _initPowerSettings() {
        try {
            this._powerSettings = new Gio.Settings({
                schema: 'org.gnome.settings-daemon.plugins.power'
            });
            
            // Read initial idle brightness value
            this._idleBrightness = this._powerSettings.get_int('idle-brightness');
            console.log(`Idle brightness from settings: ${this._idleBrightness}%`);
            
            // Monitor changes to idle brightness
            this._settingsSignalId = this._powerSettings.connect('changed::idle-brightness', () => {
                this._idleBrightness = this._powerSettings.get_int('idle-brightness');
                console.log(`Idle brightness updated: ${this._idleBrightness}%`);
            });
        } catch (error) {
            console.error('Failed to initialize power settings:', error);
            this._idleBrightness = 30;
        }
    }

    async _initPowerProxy() {
        try {
            this._powerProxy = await new Promise((resolve, reject) => {
                Gio.DBusProxy.new(
                    Gio.bus_get_sync(Gio.BusType.SESSION, null),
                    Gio.DBusProxyFlags.NONE,
                    null,
                    'org.gnome.SettingsDaemon.Power',
                    '/org/gnome/SettingsDaemon/Power',
                    'org.gnome.SettingsDaemon.Power.Screen',
                    null,
                    (source, result) => {
                        try {
                            const proxy = Gio.DBusProxy.new_finish(result);
                            resolve(proxy);
                        } catch (error) {
                            reject(error);
                        }
                    }
                );
            });
            
            // Monitor PropertiesChanged signals for brightness changes
            this._powerPropertiesSignalId = this._powerProxy.connect('g-properties-changed', 
                this._onPowerPropertiesChanged.bind(this));
            
            console.log('Power settings proxy connected successfully');
        } catch (error) {
            console.error('Failed to connect to power settings proxy:', error);
        }
    }



    disable() {
        console.log('Adaptive Brightness extension disabled');
        
        // Cleanup D-Bus connections
        if (this._proxy && this._signalId) {
            this._proxy.disconnect(this._signalId);
            this._signalId = null;
        }

        // Release the light sensor
        if (this._proxy) {
            this._proxy.call(
                'ReleaseLight', 
                null, 
                Gio.DBusCallFlags.NONE, 
                -1, 
                null,
                (source, result) => {
                    try {
                        source.call_finish(result);
                    } catch (error) {
                        console.error('Failed to release light sensor:', error);
                    }
                }
            );
            this._proxy = null;
        }

        // Cleanup power proxy
        if (this._powerProxy && this._powerPropertiesSignalId) {
            this._powerProxy.disconnect(this._powerPropertiesSignalId);
            this._powerPropertiesSignalId = null;
        }
        if (this._powerProxy) {
            this._powerProxy = null;
        }

        // Cleanup power settings
        if (this._powerSettings && this._settingsSignalId) {
            this._powerSettings.disconnect(this._settingsSignalId);
            this._settingsSignalId = null;
        }
        if (this._powerSettings) {
            this._powerSettings = null;
        }

        // Clear pending timeout
        if (this._pendingTimeout) {
            GLib.source_remove(this._pendingTimeout);
            this._pendingTimeout = null;
        }

        // Clear animation timeout
        if (this._animationTimeout) {
            GLib.source_remove(this._animationTimeout);
            this._animationTimeout = null;
        }
    }

    _onPropertiesChanged(proxy, changed, invalidated) {
        // Check if LightLevel property changed
        const lightLevel = changed.lookup_value('LightLevel', null);
        if (lightLevel) {
            const level = lightLevel.get_double();
            const now = Date.now();
            
            // Store the latest lux value
            this._pendingLuxValue = level;
            
            // If we updated recently, schedule a delayed update
            if (now - this._lastUpdateTime < 2000) {
                // Clear any existing timeout
                if (this._pendingTimeout) {
                    GLib.source_remove(this._pendingTimeout);
                }
                
                // Schedule update for when 2 seconds have passed (convert ms to seconds)
                const remainingTimeMs = 2000 - (now - this._lastUpdateTime);
                const remainingTimeSec = Math.ceil(remainingTimeMs / 1000);
                
                this._pendingTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, remainingTimeSec, () => {
                    this._processBrightnessUpdate(this._pendingLuxValue);
                    this._pendingTimeout = null;
                    return GLib.SOURCE_REMOVE;
                });
                
                return;
            }
            
            // Process immediately if enough time has passed
            this._processBrightnessUpdate(level);
        }

        // Also check HasAmbientLight property
        const hasAmbientLight = changed.lookup_value('HasAmbientLight', null);
        if (hasAmbientLight) {
            const available = hasAmbientLight.get_boolean();
            console.log(`Ambient light sensor available: ${available}`);
        }
    }

    _processBrightnessUpdate(level) {
        // Skip brightness updates if screen is dimmed or off
        if (this._isScreenDimmed) {
            return;
        }

        this._lastUpdateTime = Date.now();
        
        // Map light level to brightness with hysteresis
        const targetBrightness = this._mapLightToBrightness(level);
        if (targetBrightness !== null) {
            
            // Apply brightness smoothly to internal display
            this._setBrightnessSmooth(targetBrightness.brightness);
        }
    }

    _mapLightToBrightness(luxValue) {
        // Find the appropriate bucket for current lux value
        let targetBucket = -1;
        
        // First, try to stay in current bucket if we're within range (hysteresis)
        if (this._currentBrightnessBucket >= 0) {
            const currentBucket = this._brightnessBuckets[this._currentBrightnessBucket];
            if (luxValue >= currentBucket.min && luxValue <= currentBucket.max) {
                // Stay in current bucket (hysteresis prevents flickering)
                return currentBucket;
            }
        }
        
        // Find the best matching bucket
        for (let i = 0; i < this._brightnessBuckets.length; i++) {
            const bucket = this._brightnessBuckets[i];
            if (luxValue >= bucket.min && luxValue <= bucket.max) {
                targetBucket = i;
                break;
            }
        }
        
        // If no exact match, find the closest bucket
        if (targetBucket === -1) {
            if (luxValue < this._brightnessBuckets[0].min) {
                targetBucket = 0; // Use lowest brightness for very dark conditions
            } else if (luxValue > this._brightnessBuckets[this._brightnessBuckets.length - 1].max) {
                targetBucket = this._brightnessBuckets.length - 1; // Use highest brightness for very bright conditions
            } else {
                // Find the bucket with the closest range
                let minDistance = Infinity;
                for (let i = 0; i < this._brightnessBuckets.length; i++) {
                    const bucket = this._brightnessBuckets[i];
                    let distance;
                    if (luxValue < bucket.min) {
                        distance = bucket.min - luxValue;
                    } else if (luxValue > bucket.max) {
                        distance = luxValue - bucket.max;
                    } else {
                        distance = 0; // This shouldn't happen as we already checked above
                    }
                    
                    if (distance < minDistance) {
                        minDistance = distance;
                        targetBucket = i;
                    }
                }
            }
        }
        
        // Only change if we're switching to a different bucket
        if (targetBucket !== -1 && targetBucket !== this._currentBrightnessBucket) {
            this._currentBrightnessBucket = targetBucket;
            const bucket = this._brightnessBuckets[targetBucket];
            // console.log(`Brightness bucket changed to ${targetBucket}: ${bucket.brightness}% for ${luxValue} lux (range: ${bucket.min}-${bucket.max})`);
            return bucket;
        }
        
        // Return current bucket info without changing (for logging purposes)
        if (this._currentBrightnessBucket >= 0) {
            return this._brightnessBuckets[this._currentBrightnessBucket];
        }
        
        return null;
    }

    _setBrightness(brightnessPercent) {
        if (!this._powerProxy) {
            console.log('Power proxy not available, cannot set brightness');
            return;
        }

        const brightnessValue = Math.max(1, Math.min(100, Math.round(brightnessPercent)));
        
        // Mark that we are setting the brightness
        this._settingBrightness = true;
        
        this._powerProxy.call(
            'org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [
                'org.gnome.SettingsDaemon.Power.Screen',
                'Brightness',
                new GLib.Variant('i', brightnessValue)
            ]),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (source, result) => {
                try {
                    source.call_finish(result);
                    this._currentBrightness = brightnessValue;
                    
                    // Clear the flag after a short delay to allow D-Bus signal to be ignored
                    GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
                        this._settingBrightness = false;
                        return GLib.SOURCE_REMOVE;
                    });
                } catch (error) {
                    this._settingBrightness = false;
                    console.log(`Failed to set brightness via D-Bus: ${error.message}`);
                }
            }
        );
    }

    _setBrightnessSmooth(targetBrightness) {
        // Cancel any ongoing animation
        if (this._animationTimeout) {
            GLib.source_remove(this._animationTimeout);
            this._animationTimeout = null;
        }

        // Get current brightness
        let currentBrightness = this._currentBrightness;
        if (currentBrightness === null) {
            // First time, set immediately
            this._setBrightness(targetBrightness);
            return;
        }

        const brightnessDiff = targetBrightness - currentBrightness;
        if (Math.abs(brightnessDiff) < 2) {
            // Difference too small, set immediately
            this._setBrightness(targetBrightness);
            return;
        }

        // Animation parameters
        const stepSize = brightnessDiff > 0 ? 1 : -1; // 1% steps in the right direction
        const steps = Math.abs(brightnessDiff); // Number of 1% steps needed
        const stepDurationMs = 25; // Fixed frame duration for consistent animation speed

        let currentStep = 0;

        const animateStep = () => {
            currentStep++;
            const newBrightness = currentBrightness + (stepSize * currentStep);
            
            if (currentStep >= steps) {
                // Final step, ensure we hit the exact target
                this._setBrightness(targetBrightness);
                this._animationTimeout = null;
                return GLib.SOURCE_REMOVE;
            } else {
                // Intermediate step - each step is exactly 1%
                this._setBrightness(newBrightness);
                return GLib.SOURCE_CONTINUE;
            }
        };

        // Start the animation
        this._animationTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, stepDurationMs, animateStep);
    }

    _onPowerPropertiesChanged(proxy, changed, invalidated) {        
        // Only process if we're not currently setting brightness
        if (this._settingBrightness) {
            return;
        }

        // Check if Brightness property changed
        const brightness = changed.lookup_value('Brightness', null);
        if (brightness) {
            const newBrightness = brightness.get_int32();
            
            // Check if this is an external change
            if (this._currentBrightness !== null && newBrightness !== this._currentBrightness) {
                console.log(`External brightness change: ${this._currentBrightness}% -> ${newBrightness}%`);
                
                const wasDimmed = this._isScreenDimmed;
                
                // Check if brightness went down to idle level (dimmed)
                this._isScreenDimmed = newBrightness === this._idleBrightness;
                
                // Update our tracking
                this._currentBrightness = newBrightness;
                
                // Handle state transitions
                if (wasDimmed !== this._isScreenDimmed) {
                    if (this._isScreenDimmed) {
                    } else {
                        if (this._pendingLuxValue !== null) {
                            this._processBrightnessUpdate(this._pendingLuxValue);
                        }
                    }
                }
            }
        }
    }

}