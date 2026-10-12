import AppKit
import WebKit

/// What the pond reports back (see web/src/wallpaper.ts).
struct PondState {
    var weather: String
    var rain: Bool
    var koi: Int
    var fps: String
    var visitors: [String: Int]

    init?(_ message: [String: Any]) {
        guard let weather = message["weather"] as? String else { return nil }
        self.weather = weather
        rain = (message["rain"] as? NSNumber)?.boolValue ?? false
        koi = (message["koi"] as? NSNumber)?.intValue ?? 0
        fps = message["fps"] as? String ?? ""
        visitors = (message["visitors"] as? [String: Any] ?? [:]).compactMapValues { ($0 as? NSNumber)?.intValue }
    }
}

extension NSScreen {
    var displayID: CGDirectDisplayID {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    }
}

/// One screen's pond: a borderless window at the desktop-picture level, so it
/// sits under the desktop icons and every other window, on every Space.
@MainActor
final class Wallpaper {
    let window: NSWindow
    let webView: WKWebView
    let displayID: CGDirectDisplayID

    var onState: ((Wallpaper, PondState) -> Void)?

    /// Frames the pond actually drew in the last second (0 while paused).
    private(set) var fps = 0
    private(set) var isPaused = false
    /// Why it's paused, for the resource window (nil while running).
    var pauseReason: String?

    private var pageReady = false
    private var sound = false

    init(screen: NSScreen) {
        displayID = screen.displayID
        window = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.setFrame(screen.frame, display: false)
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        window.ignoresMouseEvents = true
        window.hasShadow = false
        window.isOpaque = true
        window.backgroundColor = NSColor(srgbRed: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1)
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none

        var receive: (([String: Any]) -> Void)?
        webView = PondWeb.makeWebView(wallpaper: true) { message in receive?(message) }
        webView.frame = NSRect(origin: .zero, size: screen.frame.size)
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView
        receive = { [weak self] message in self?.receive(message) }

        webView.load(URLRequest(url: PondWeb.url(wallpaper: true)))
        window.orderFrontRegardless()
    }

    /// Whether macOS still shows any of this window (it tracks occlusion per window).
    var isVisibleOnScreen: Bool {
        window.occlusionState.contains(.visible)
    }

    /// Calls the fish to a point in screen coordinates (macOS's bottom-left origin).
    func callFish(at point: NSPoint) {
        let frame = window.frame
        post([
            "type": "call",
            "x": Double((point.x - frame.minX) / frame.width),
            "y": Double(1 - (point.y - frame.minY) / frame.height),
        ])
    }

    func setPaused(_ value: Bool) {
        guard value != isPaused else { return }
        isPaused = value
        if pageReady { post(["type": "paused", "value": value]) }
    }

    func setSound(_ value: Bool) {
        guard value != sound else { return }
        sound = value
        if pageReady { post(["type": "sound", "value": value]) }
    }

    func post(_ message: [String: Any]) {
        PondWeb.post(message, to: webView)
    }

    /// The content process drawing this pond (for the resource window).
    var webProcessID: pid_t? {
        // Private WebKit property; only read it while it exists.
        guard webView.responds(to: NSSelectorFromString("_webProcessIdentifier")) else { return nil }
        return (webView.value(forKey: "_webProcessIdentifier") as? NSNumber)?.int32Value
    }

    func close() {
        onState = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "koipaper")
        webView.stopLoading()
        window.orderOut(nil)
        window.close()
    }

    private func receive(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "stats":
            fps = (message["fps"] as? NSNumber)?.intValue ?? 0
        case "state":
            guard let state = PondState(message) else { return }
            if !pageReady {
                // A fresh page (first load, or a reload after a crash) starts unpaused and silent.
                pageReady = true
                if isPaused { post(["type": "paused", "value": true]) }
                if sound { post(["type": "sound", "value": true]) }
            }
            onState?(self, state)
        default:
            break
        }
    }
}
