import AppKit
import CoreGraphics

/// Reads the on-screen window list (positions, layers, and owners only, which
/// needs no Screen Recording permission) to tell what is at a point.
@MainActor
enum DesktopProbe {
    private static let iconLevel = Int(CGWindowLevelForKey(.desktopIconWindow))

    /// True when a click at `point` (screen coordinates, bottom-left origin) lands
    /// on the desktop itself: the icons or the wallpaper, not a window, the Dock,
    /// or the menu bar.
    static func isDesktop(at point: NSPoint) -> Bool {
        let target = CGPoint(x: point.x, y: primaryHeight - point.y)
        // Windows come front to back; the first one under the point decides.
        guard let topmost = otherWindows().first(where: { $0.bounds.contains(target) }) else { return true }
        return topmost.layer <= iconLevel
    }

    /// Screens whose usable area is fully covered by an app window (a zoomed or
    /// full-screen app), so their pond can pause.
    static func coveredScreens(_ screens: [NSScreen]) -> Set<CGDirectDisplayID> {
        let windows = otherWindows().filter { $0.layer == 0 }
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
            return WindowInfo(bounds: bounds, layer: (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0)
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
