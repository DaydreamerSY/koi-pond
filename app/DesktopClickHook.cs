using System.Runtime.InteropServices;
using static KoiPaper.Native;

namespace KoiPaper;

/// <summary>
/// Wallpaper windows sit behind the desktop icons and never get mouse input,
/// so a low-level mouse hook spots left clicks on the bare desktop instead.
/// </summary>
internal sealed class DesktopClickHook : IDisposable
{
    private readonly LowLevelMouseProc callback;
    private readonly SynchronizationContext context;
    private readonly Action<Point> onDesktopClick;
    private nint hook;

    public DesktopClickHook(Action<Point> onDesktopClick)
    {
        this.onDesktopClick = onDesktopClick;
        context = SynchronizationContext.Current ?? new SynchronizationContext();
        callback = HookCallback; // Kept in a field so the GC never collects the delegate.
        hook = SetWindowsHookEx(WH_MOUSE_LL, callback, GetModuleHandle(null), 0);
    }

    private nint HookCallback(int nCode, nint wParam, nint lParam)
    {
        if (nCode >= 0 && wParam == WM_LBUTTONDOWN)
        {
            POINT point = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam).pt;
            // Windows drops hooks that answer slowly: only the cheap hit test runs here.
            if (DesktopHost.IsDesktopAt(point))
                context.Post(_ => onDesktopClick(new Point(point.X, point.Y)), null);
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (hook == 0) return;
        UnhookWindowsHookEx(hook);
        hook = 0;
    }
}
