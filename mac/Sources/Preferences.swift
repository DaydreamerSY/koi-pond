import Foundation

/// The shell's own preferences. Pond settings (weather, koi, visitors, fps, …)
/// live in the pond's localStorage instead, shared with the settings window.
final class Preferences {
    private let defaults = UserDefaults.standard

    var sound: Bool {
        get { defaults.bool(forKey: "sound") }
        set { defaults.set(newValue, forKey: "sound") }
    }

    var paused: Bool {
        get { defaults.bool(forKey: "paused") }
        set { defaults.set(newValue, forKey: "paused") }
    }

    /// Pause a screen's pond while a window covers it.
    var autoPause: Bool {
        get { defaults.object(forKey: "autoPause") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "autoPause") }
    }

    var allScreens: Bool {
        get { defaults.object(forKey: "allScreens") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "allScreens") }
    }

    /// With `allScreens`: a pond per screen instead of one big pond across them all.
    var separatePonds: Bool {
        get { defaults.bool(forKey: "separatePonds") }
        set { defaults.set(newValue, forKey: "separatePonds") }
    }
}
