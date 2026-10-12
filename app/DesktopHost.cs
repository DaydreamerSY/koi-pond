using static KoiPaper.Native;

namespace KoiPaper;

/// <summary>
/// The spot in Explorer's desktop where wallpaper windows go: behind the
/// desktop icons, in front of Explorer's own wallpaper.
/// </summary>
internal sealed class DesktopHost
{
    private const uint WM_SPAWN_WORKERW = 0x052C;

    private DesktopHost(nint parent, nint iconsView, nint wallpaperLayer)
    {
        Parent = parent;
        IconsView = iconsView;
        WallpaperLayer = wallpaperLayer;
    }

    /// <summary>The window wallpaper windows become children of.</summary>
    public nint Parent { get; }

    /// <summary>SHELLDLL_DefView (the icons). Only set on the Windows 11 24H2+ layout.</summary>
    public nint IconsView { get; }

    /// <summary>Explorer's own wallpaper WorkerW. Only set on the Windows 11 24H2+ layout.</summary>
    public nint WallpaperLayer { get; }

    /// <summary>
    /// Windows 11 24H2+ keeps the icons and the wallpaper WorkerW as children of
    /// Progman, so wallpaper windows are slotted between the two.
    /// </summary>
    public bool IsChildLayout => IconsView != 0;

    /// <summary>Parent's top-left in screen coordinates (it spans the whole virtual screen).</summary>
    public Point Origin => GetWindowRect(Parent, out RECT rect) ? new Point(rect.Left, rect.Top) : Point.Empty;

    public bool IsAlive =>
        IsWindow(Parent) &&
        (!IsChildLayout ||
         (FindWindowEx(Parent, 0, "SHELLDLL_DefView", null) == IconsView &&
          FindWindowEx(Parent, 0, "WorkerW", null) == WallpaperLayer));

    public static DesktopHost? Find()
    {
        nint progman = FindWindow("Progman", null);
        if (progman == 0) return null;

        // Asks Explorer to draw the wallpaper on its own WorkerW layer.
        SendMessageTimeout(progman, WM_SPAWN_WORKERW, 0xD, 0x1, SMTO_NORMAL, 1000, out _);

        nint iconsView = FindWindowEx(progman, 0, "SHELLDLL_DefView", null);
        nint childWorkerW = FindWindowEx(progman, 0, "WorkerW", null);
        if (iconsView != 0 && childWorkerW != 0)
            return new DesktopHost(progman, iconsView, childWorkerW);

        // Before 24H2: a top-level WorkerW holds the icons and the next top-level
        // WorkerW draws the wallpaper; wallpaper windows become its children.
        nint wallpaperWorkerW = 0;
        EnumWindows((topLevel, _) =>
        {
            if (FindWindowEx(topLevel, 0, "SHELLDLL_DefView", null) != 0)
                wallpaperWorkerW = FindWindowEx(0, topLevel, "WorkerW", null);
            return true;
        }, 0);
        return wallpaperWorkerW != 0 ? new DesktopHost(wallpaperWorkerW, 0, 0) : null;
    }

    public void Attach(nint window, Rectangle screenBounds)
    {
        nint style = GetWindowLongPtr(window, GWL_STYLE);
        SetWindowLongPtr(window, GWL_STYLE, (nint)(((ulong)style & ~(ulong)WS_POPUP) | WS_CHILD));

        if (IsChildLayout)
        {
            // Progman doesn't give its children a redirection surface on 24H2+;
            // a layered child gets its own and shows up.
            nint exStyle = GetWindowLongPtr(window, GWL_EXSTYLE);
            SetWindowLongPtr(window, GWL_EXSTYLE, (nint)((ulong)exStyle | WS_EX_LAYERED));
            SetLayeredWindowAttributes(window, 0, 255, LWA_ALPHA);
        }

        SetParent(window, Parent);
        Point origin = Origin;
        SetWindowPos(window, IsChildLayout ? IconsView : 0,
            screenBounds.X - origin.X, screenBounds.Y - origin.Y, screenBounds.Width, screenBounds.Height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW | (IsChildLayout ? 0 : SWP_NOZORDER));

        // Keep Explorer's wallpaper below ours.
        if (IsChildLayout)
            SetWindowPos(WallpaperLayer, window, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    /// <summary>True when the screen point is on the desktop itself (icons layer or wallpaper).</summary>
    public static bool IsDesktopAt(POINT point)
    {
        nint root = GetAncestor(WindowFromPoint(point), GA_ROOT);
        return root != 0 && ClassName(root) is "Progman" or "WorkerW";
    }
}
