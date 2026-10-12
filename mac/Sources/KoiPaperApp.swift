import AppKit

/// Koi Paper for macOS: the Nagomi pond as a live desktop wallpaper, run from
/// the menu bar (no Dock icon). Personal, local, non-commercial build.
@main
@MainActor
enum KoiPaperApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        // NSApplication holds its delegate weakly.
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}
