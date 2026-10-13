import AppKit
import CoreGraphics

/// Reads the on-screen window list (positions, layers, and owners only, which
/// needs no Screen Recording permission) to tell what is at a point.
@MainActor
enum DesktopProbe {
    /// True when a click at `point` (screen coordinates, bottom-left origin) lands
    /// on the desktop itself: the icons or the wallpaper, not a window, the Dock,
    /// or the menu bar.
    static func isDesktop(at point: NSPoint) -> Bool {
        // Not on the menu bar or the Dock's strip.
        guard NSScreen.screens.contains(where: { NSMouseInRect(point, $0.visibleFrame, false) }) else { return false }
        let target = CGPoint(x: point.x, y: primaryHeight - point.y)
        let screens = NSScreen.screens.map { cgRect($0.frame) }
        // Everything you can see and click (app windows, panels, the Dock, the
        // menu bar) sits at layer 0 or above; the desktop itself (wallpaper,
        // icons, widgets) is below that. Invisible overlays that span a whole
        // screen aren't in the way either.
        return !otherWindows().contains { window in
            window.layer >= 0 && window.bounds.contains(target) && !isOverlay(window, screens)
        }
    }

    /// Screens whose usable area is fully covered by an app window (a zoomed or
    /// full-screen app), so their pond can pause.
    static func coveredScreens(_ screens: [NSScreen]) -> Set<CGDirectDisplayID> {
        let windows = otherWindows().filter { $0.layer == 0 && $0.owner != "Dock" }
        var covered = Set<CGDirectDisplayID>()
        for screen in screens {
            let area = cgRect(screen.visibleFrame).insetBy(dx: 2, dy: 2)
            if windows.contains(where: { $0.bounds.contains(area) }) { covered.insert(screen.displayID) }
        }
        return covered
    }

    private struct WindowInfo {
        let bounds: CGRect
        let layer: Int
        let owner: String
    }

    /// A window that spans (nearly) a whole screen but isn't an ordinary app
    /// window: the Dock keeps an invisible one over its screen for Mission
    /// Control and hot corners, and other system overlays do the same.
    private static func isOverlay(_ window: WindowInfo, _ screens: [CGRect]) -> Bool {
        guard window.layer > 0 || window.owner == "Dock" else { return false }
        return screens.contains { screen in
            let overlap = window.bounds.intersection(screen)
            return !overlap.isNull && overlap.width * overlap.height >= screen.width * screen.height * 0.9
        }
    }

    /// Visible windows of other apps, front to back.
    private static func otherWindows() -> [WindowInfo] {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return [] }
        let ownPID = ProcessInfo.processInfo.processIdentifier
        return list.compactMap { info in
            guard (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value != ownPID,
                  ((info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0.01,
                  let boundsInfo = info[kCGWindowBounds as String] as? [String: Any],
                  let bounds = CGRect(dictionaryRepresentation: boundsInfo as CFDictionary) else { return nil }
            return WindowInfo(
                bounds: bounds,
                layer: (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0,
                owner: info[kCGWindowOwnerName as String] as? String ?? "")
        }
    }

    /// The window list uses a top-left origin on the main display.
    private static var primaryHeight: CGFloat {
        NSScreen.screens.first?.frame.height ?? 0
    }

    private static func cgRect(_ rect: NSRect) -> CGRect {
        CGRect(x: rect.minX, y: primaryHeight - rect.maxY, width: rect.width, height: rect.height)
    }
}
