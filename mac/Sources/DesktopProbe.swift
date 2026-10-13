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
        let target = CGPoint(x: point.x, y: primaryHeight - point.y)
        // Everything you can see and click (app windows, panels, the Dock, the
        // menu bar) sits at layer 0 or above. Below that is the desktop itself,
        // which on some screens is more than one window (wallpaper, icons,
        // widgets), so none of those may count as "in the way".
        return !otherWindows().contains { $0.layer >= 0 && $0.bounds.contains(target) }
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
