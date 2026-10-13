import AppKit
import ServiceManagement
import WebKit

/// Owns the wallpapers, the menu bar item, and everything that keeps them in
/// step with the desktop (mirrors app/TrayApp.cs on Windows).
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, NSWindowDelegate {
    private static let weathers = [
        ("sunny", "Nắng"), ("deep-clear", "Nước trong"), ("overcast", "Âm u"), ("mist", "Sương mù"),
        ("rain", "Mưa"), ("sunset", "Hoàng hôn"), ("moonlight", "Ánh trăng"),
    ]
    private static let frameRates = [("native", "Theo màn hình"), ("60", "60 fps"), ("30", "30 fps"), ("20", "20 fps (tiết kiệm pin)")]
    private static let koiCounts = [4, 8, 14, 20, 30, 48]
    private static let visitors = [("ducks", "Vịt"), ("crabs", "Cua"), ("shrimp", "Tôm"), ("frogs", "Ếch")]

    private let preferences = Preferences()
    private var statusItem: NSStatusItem!
    private var wallpapers: [Wallpaper] = []
    private var pond: PondState?
    private var settingsWindow: NSWindow?
    private var resourceWindow: ResourceWindowController?
    private var clickMonitor: Any?
    private var timer: Timer?
    private var rebuildTimer: Timer?
    private var screenLocked = false
    private var screensAsleep = false

    // Menu items whose check marks follow the pond's state.
    private var weatherItems: [NSMenuItem] = []
    private var koiItems: [NSMenuItem] = []
    private var visitorItems: [NSMenuItem] = []
    private var frameRateItems: [NSMenuItem] = []
    private var pondItems: [NSMenuItem] = []
    private var koiMenuItem: NSMenuItem!
    private var randomWeatherItem: NSMenuItem!
    private var rainItem: NSMenuItem!
    private var soundItem: NSMenuItem!
    private var pauseItem: NSMenuItem!
    private var autoPauseItem: NSMenuItem!
    private var allScreensItem: NSMenuItem!
    private var mainScreenItem: NSMenuItem!
    private var loginItem: NSMenuItem!

    // MARK: - Lifetime

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard FileManager.default.fileExists(atPath: PondWeb.root.appendingPathComponent("index.html").path) else {
            Self.alert("Không tìm thấy giao diện hồ cá (wwwroot) trong app. Hãy build lại bằng mac/build.sh.")
            NSApp.terminate(nil)
            return
        }

        NSApp.mainMenu = Self.editMenu()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(systemSymbolName: "fish.fill", accessibilityDescription: "Koi Paper") {
            image.isTemplate = true
            statusItem.button?.image = image
        } else {
            statusItem.button?.title = "🐟"
        }
        statusItem.menu = buildMenu()

        rebuild()

        // Wallpaper windows ignore the mouse (clicks belong to Finder's desktop), so
        // watch clicks globally and pass the ones that land on the desktop to the pond.
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in
            let point = NSEvent.mouseLocation
            DispatchQueue.main.async { self?.desktopClicked(at: point) }
        }
        timer = Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(updatePlayback), userInfo: nil, repeats: true)

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(screensSlept), name: NSWorkspace.screensDidSleepNotification, object: nil)
        workspace.addObserver(self, selector: #selector(screensWoke), name: NSWorkspace.screensDidWakeNotification, object: nil)
        workspace.addObserver(self, selector: #selector(updatePlayback), name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
        let distributed = DistributedNotificationCenter.default()
        distributed.addObserver(self, selector: #selector(screenLockedChanged(_:)), name: Notification.Name("com.apple.screenIsLocked"), object: nil)
        distributed.addObserver(self, selector: #selector(screenLockedChanged(_:)), name: Notification.Name("com.apple.screenIsUnlocked"), object: nil)
    }

    /// Opening the app again (Finder, Spotlight) while it runs shows the settings.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showSettings()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }
        wallpapers.forEach { $0.close() }
    }

    // MARK: - Wallpapers

    private func rebuild() {
        wallpapers.forEach { $0.close() }
        let screens = preferences.allScreens ? NSScreen.screens : Array(NSScreen.screens.prefix(1))
        wallpapers = screens.map { screen in
            let wallpaper = Wallpaper(screen: screen)
            wallpaper.onState = { [weak self] source, state in
                // The main screen's pond speaks for all of them in the menu.
                if source === self?.wallpapers.first { self?.pond = state }
            }
            return wallpaper
        }
        updatePlayback()
    }

    @objc private func screensChanged() {
        // Screens often change in bursts (lid, dock, resolution); settle first.
        rebuildTimer?.invalidate()
        rebuildTimer = Timer.scheduledTimer(timeInterval: 1.5, target: self, selector: #selector(rebuildNow), userInfo: nil, repeats: false)
    }

    @objc private func rebuildNow() {
        rebuild()
    }

    @objc private func screensSlept() {
        screensAsleep = true
        updatePlayback()
    }

    @objc private func screensWoke() {
        screensAsleep = false
        updatePlayback()
    }

    @objc private func screenLockedChanged(_ notification: Notification) {
        screenLocked = notification.name.rawValue == "com.apple.screenIsLocked"
        updatePlayback()
    }

    @objc private func updatePlayback() {
        let covered = preferences.autoPause ? DesktopProbe.coveredScreens(NSScreen.screens) : []
        for wallpaper in wallpapers {
            let hidden = covered.contains(wallpaper.displayID) || !wallpaper.isVisibleOnScreen
            wallpaper.pauseReason =
                preferences.paused ? "bạn đã bấm Tạm dừng"
                : screenLocked ? "máy đang khoá"
                : screensAsleep ? "màn hình đang tắt"
                : preferences.autoPause && hidden ? "bị cửa sổ khác che kín"
                : nil
            wallpaper.setPaused(wallpaper.pauseReason != nil)
            // One river is enough: only the main screen's pond plays sound.
            wallpaper.setSound(preferences.sound && !preferences.paused && !screenLocked && wallpaper === wallpapers.first)
        }
    }

    private func desktopClicked(at point: NSPoint) {
        guard DesktopProbe.isDesktop(at: point),
              let wallpaper = wallpapers.first(where: { NSMouseInRect(point, $0.window.frame, false) }) else { return }
        wallpaper.callFish(at: point)
    }

    /// Pond settings go to every screen's pond (they also persist in localStorage).
    private func broadcast(_ message: [String: Any]) {
        wallpapers.forEach { $0.post(message) }
    }

    // MARK: - Menu

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.delegate = self

        let settings = ActionItem("Cài đặt hồ cá…") { [weak self] in self?.showSettings() }
        settings.keyEquivalent = ","
        menu.addItem(settings)
        menu.addItem(ActionItem("Tài nguyên đang dùng…") { [weak self] in self?.showResources() })
        menu.addItem(.separator())

        let weather = NSMenuItem(title: "Thời tiết", action: nil, keyEquivalent: "")
        weather.submenu = NSMenu()
        for (id, label) in Self.weathers {
            let item = ActionItem(label) { [weak self] in self?.broadcast(["type": "weather", "value": id]) }
            item.representedObject = id
            weather.submenu?.addItem(item)
            weatherItems.append(item)
        }
        // Picks a different preset every few minutes; choosing one above turns it off.
        weather.submenu?.addItem(.separator())
        randomWeatherItem = ActionItem("Ngẫu nhiên") { [weak self] in
            guard let self else { return }
            broadcast(["type": "randomWeather", "value": !(pond?.randomWeather ?? false)])
        }
        weather.submenu?.addItem(randomWeatherItem)
        menu.addItem(weather)

        rainItem = ActionItem("Mưa rơi trên mặt nước") { [weak self] in
            self?.broadcast(["type": "rain", "value": !(self?.pond?.rain ?? false)])
        }
        menu.addItem(rainItem)

        soundItem = ActionItem("Âm thanh dòng nước") { [weak self] in
            guard let self else { return }
            preferences.sound.toggle()
            updatePlayback()
        }
        menu.addItem(soundItem)

        koiMenuItem = NSMenuItem(title: "Số cá koi", action: nil, keyEquivalent: "")
        koiMenuItem.submenu = NSMenu()
        for count in Self.koiCounts {
            let item = ActionItem(String(count)) { [weak self] in self?.broadcast(["type": "koi", "value": count]) }
            item.tag = count
            koiMenuItem.submenu?.addItem(item)
            koiItems.append(item)
        }
        menu.addItem(koiMenuItem)

        let visitorsMenu = NSMenuItem(title: "Khách ghé hồ", action: nil, keyEquivalent: "")
        visitorsMenu.submenu = NSMenu()
        for (kind, label) in Self.visitors {
            let item = ActionItem(label) { [weak self] in
                guard let self else { return }
                broadcast(["type": "visitor", "kind": kind, "value": (pond?.visitors[kind] ?? 0) == 0])
            }
            item.representedObject = kind
            visitorsMenu.submenu?.addItem(item)
            visitorItems.append(item)
        }
        menu.addItem(visitorsMenu)

        let frameRate = NSMenuItem(title: "Tốc độ khung hình", action: nil, keyEquivalent: "")
        frameRate.submenu = NSMenu()
        for (id, label) in Self.frameRates {
            let item = ActionItem(label) { [weak self] in self?.broadcast(["type": "fps", "value": id]) }
            item.representedObject = id
            frameRate.submenu?.addItem(item)
            frameRateItems.append(item)
        }
        menu.addItem(frameRate)

        let scatter = ActionItem("Xua đàn cá") { [weak self] in self?.broadcast(["type": "scatter"]) }
        menu.addItem(scatter)
        pondItems = [weather, rainItem, koiMenuItem, visitorsMenu, frameRate, scatter]
        menu.addItem(.separator())

        pauseItem = ActionItem("Tạm dừng") { [weak self] in
            guard let self else { return }
            preferences.paused.toggle()
            updatePlayback()
        }
        menu.addItem(pauseItem)
        autoPauseItem = ActionItem("Tự dừng khi bị cửa sổ khác che kín") { [weak self] in
            guard let self else { return }
            preferences.autoPause.toggle()
            updatePlayback()
        }
        menu.addItem(autoPauseItem)

        let screensMenu = NSMenuItem(title: "Hiển thị trên", action: nil, keyEquivalent: "")
        screensMenu.submenu = NSMenu()
        allScreensItem = ActionItem("Tất cả màn hình") { [weak self] in self?.setAllScreens(true) }
        mainScreenItem = ActionItem("Chỉ màn hình chính") { [weak self] in self?.setAllScreens(false) }
        screensMenu.submenu?.addItem(allScreensItem)
        screensMenu.submenu?.addItem(mainScreenItem)
        menu.addItem(screensMenu)

        loginItem = ActionItem("Mở cùng macOS") { [weak self] in self?.toggleLaunchAtLogin() }
        menu.addItem(loginItem)
        menu.addItem(.separator())

        let quit = ActionItem("Thoát Koi Paper") { NSApp.terminate(nil) }
        quit.keyEquivalent = "q"
        menu.addItem(quit)
        return menu
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        let loaded = pond != nil
        for item in pondItems { item.isEnabled = loaded }
        for item in weatherItems { item.state = (item.representedObject as? String) == pond?.weather ? .on : .off }
        for item in koiItems { item.state = item.tag == pond?.koi ? .on : .off }
        for item in frameRateItems { item.state = (item.representedObject as? String) == pond?.fps ? .on : .off }
        for item in visitorItems {
            item.state = (pond?.visitors[(item.representedObject as? String) ?? ""] ?? 0) > 0 ? .on : .off
        }
        koiMenuItem.title = pond.map { "Số cá koi (\($0.koi))" } ?? "Số cá koi"
        randomWeatherItem.state = pond?.randomWeather == true ? .on : .off
        rainItem.state = pond?.rain == true ? .on : .off
        soundItem.state = preferences.sound ? .on : .off
        pauseItem.state = preferences.paused ? .on : .off
        autoPauseItem.state = preferences.autoPause ? .on : .off
        allScreensItem.state = preferences.allScreens ? .on : .off
        mainScreenItem.state = preferences.allScreens ? .off : .on
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    private func setAllScreens(_ all: Bool) {
        guard preferences.allScreens != all else { return }
        preferences.allScreens = all
        rebuild()
    }

    private func toggleLaunchAtLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            Self.alert("Không đổi được \"Mở cùng macOS\": \(error.localizedDescription)\n\nHãy chép Koi Paper.app vào thư mục Applications rồi thử lại.")
        }
    }

    // MARK: - Windows

    private func showSettings() {
        if let settingsWindow {
            Self.bringToFront(settingsWindow)
            return
        }
        let webView = PondWeb.makeWebView(wallpaper: false) { _ in }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        window.title = "Koi Paper — Cài đặt hồ cá"
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(srgbRed: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1)
        window.contentView = webView
        window.contentMinSize = NSSize(width: 640, height: 420)
        window.delegate = self
        window.center()
        webView.load(URLRequest(url: PondWeb.url(wallpaper: false)))
        settingsWindow = window
        Self.bringToFront(window)
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === settingsWindow else { return }
        settingsWindow = nil
        // In case storage events don't reach the wallpapers' web views, have them
        // re-read the settings that were just edited.
        broadcast(["type": "resync"])
    }

    private func showResources() {
        if resourceWindow == nil {
            let controller = ResourceWindowController(
                status: { [weak self] in self?.pondStatus() ?? "" },
                webProcesses: { [weak self] in self?.wallpapers.compactMap { $0.webProcessID } ?? [] })
            controller.onClose = { [weak self] in self?.resourceWindow = nil }
            resourceWindow = controller
        }
        resourceWindow?.show()
    }

    /// One line per screen: the pond's real frame rate, or why it's paused.
    private func pondStatus() -> String {
        guard !wallpapers.isEmpty else { return "Hồ cá     chưa chạy" }
        return wallpapers.enumerated().map { index, wallpaper in
            let screen = wallpapers.count == 1 ? "Hồ cá" : index == 0 ? "Màn hình chính" : "Màn hình \(index + 1)"
            return wallpaper.isPaused
                ? "\(screen)     tạm dừng (\(wallpaper.pauseReason ?? ""))"
                : "\(screen)     đang chạy, \(wallpaper.fps) khung hình/giây"
        }.joined(separator: "\n")
    }

    // MARK: - Helpers

    static func bringToFront(_ window: NSWindow) {
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
        window.makeKeyAndOrderFront(nil)
    }

    private static func alert(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Koi Paper"
        alert.informativeText = message
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    /// Menu-bar apps have no menu bar of their own, but text fields (the settings
    /// search box) still need ⌘C/⌘V/⌘A, which travel through the main menu.
    private static func editMenu() -> NSMenu {
        let main = NSMenu()
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        editItem.submenu = edit
        main.addItem(editItem)
        return main
    }
}

/// A menu item that runs a closure.
final class ActionItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(runHandler), keyEquivalent: "")
        target = self
    }

    required init(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    @objc private func runHandler() {
        handler()
    }
}
