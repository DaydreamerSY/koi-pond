using static KoiPaper.Native;

namespace KoiPaper;

internal static class Occlusion
{
    /// <summary>
    /// Device names of the monitors whose desktop can't be seen: covered by a
    /// maximized window, or by the foreground window in full screen (games, video).
    /// </summary>
    public static HashSet<string> CoveredScreens()
    {
        var covered = new HashSet<string>();
        nint foreground = GetForegroundWindow();
        EnumWindows((window, _) =>
        {
            if (!IsWindowVisible(window) || IsIconic(window) || IsCloaked(window)) return true;
            bool maximized = IsZoomed(window);
            // Only the foreground window counts as full screen: invisible overlays
            // (game bars, screen recorders) often span the whole monitor too.
            if (!maximized && window != foreground) return true;
            if (ClassName(window) is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd") return true;

            Screen screen = Screen.FromHandle(window);
            if (maximized || VisibleBounds(window).Contains(screen.Bounds)) covered.Add(screen.DeviceName);
            return true;
        }, 0);
        return covered;
    }
}
