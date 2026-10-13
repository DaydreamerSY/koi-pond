using System.Runtime.InteropServices;
using System.Text;

namespace KoiPaper;

internal static partial class Native
{
    public const int GWL_STYLE = -16;
    public const int GWL_EXSTYLE = -20;

    public const uint WS_CHILD = 0x40000000;
    public const uint WS_POPUP = 0x80000000;
    public const uint WS_CLIPSIBLINGS = 0x04000000;
    public const uint WS_CLIPCHILDREN = 0x02000000;
    public const uint WS_EX_TOOLWINDOW = 0x00000080;
    public const uint WS_EX_NOACTIVATE = 0x08000000;
    public const uint WS_EX_LAYERED = 0x00080000;
    public const uint WS_EX_TRANSPARENT = 0x00000020;

    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_FRAMECHANGED = 0x0020;
    public const nint HWND_BOTTOM = 1;

    public const uint LWA_ALPHA = 0x2;
    public const uint SMTO_NORMAL = 0x0;
    public const uint GA_ROOT = 2;
    public const int SW_SHOWNA = 8;

    public const int WH_MOUSE_LL = 14;
    public const int WM_LBUTTONDOWN = 0x0201;

    public const uint SPI_GETDESKWALLPAPER = 0x0073;
    public const uint SPI_SETDESKWALLPAPER = 0x0014;

    public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    public const int DWMWA_CLOAKED = 14;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
        public readonly Rectangle ToRectangle() => Rectangle.FromLTRB(Left, Top, Right, Bottom);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData, flags, time;
        public nint dwExtraInfo;
    }

    public delegate bool EnumWindowsProc(nint hWnd, nint lParam);
    public delegate nint LowLevelMouseProc(int nCode, nint wParam, nint lParam);

    [LibraryImport("user32.dll", EntryPoint = "FindWindowW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint FindWindow(string? className, string? windowName);

    [LibraryImport("user32.dll", EntryPoint = "FindWindowExW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint FindWindowEx(nint parent, nint childAfter, string? className, string? windowName);

    [LibraryImport("user32.dll", EntryPoint = "SendMessageTimeoutW")]
    public static partial nint SendMessageTimeout(nint hWnd, uint msg, nint wParam, nint lParam, uint flags, uint timeout, out nint result);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool EnumWindows(EnumWindowsProc callback, nint lParam);

    [LibraryImport("user32.dll")]
    public static partial nint SetParent(nint child, nint newParent);

    [LibraryImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static partial nint GetWindowLongPtr(nint hWnd, int index);

    [LibraryImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    public static partial nint SetWindowLongPtr(nint hWnd, int index, nint value);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetLayeredWindowAttributes(nint hWnd, uint colorKey, byte alpha, uint flags);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetWindowPos(nint hWnd, nint insertAfter, int x, int y, int cx, int cy, uint flags);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ShowWindow(nint hWnd, int cmd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsWindow(nint hWnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsWindowVisible(nint hWnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsIconic(nint hWnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsZoomed(nint hWnd);

    [LibraryImport("user32.dll")]
    public static partial nint GetForegroundWindow();

    [LibraryImport("user32.dll")]
    public static partial nint GetAncestor(nint hWnd, uint flags);

    [LibraryImport("user32.dll")]
    public static partial nint WindowFromPoint(POINT point);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetWindowRect(nint hWnd, out RECT rect);

    [LibraryImport("user32.dll", EntryPoint = "GetClassNameW", StringMarshalling = StringMarshalling.Utf16)]
    private static unsafe partial int GetClassName(nint hWnd, char* buffer, int maxCount);

    [LibraryImport("user32.dll", EntryPoint = "RegisterWindowMessageW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial uint RegisterWindowMessage(string name);

    [LibraryImport("user32.dll", EntryPoint = "SetWindowsHookExW")]
    public static partial nint SetWindowsHookEx(int idHook, LowLevelMouseProc callback, nint module, uint threadId);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool UnhookWindowsHookEx(nint hook);

    [LibraryImport("user32.dll")]
    public static partial nint CallNextHookEx(nint hook, int nCode, nint wParam, nint lParam);

    [LibraryImport("user32.dll", EntryPoint = "SystemParametersInfoW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static unsafe partial bool SystemParametersInfo(uint action, uint param, char* value, uint winIni);

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmGetWindowAttribute(nint hWnd, int attribute, out RECT value, int size);

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmGetWindowAttribute(nint hWnd, int attribute, out int value, int size);

    [LibraryImport("kernel32.dll", EntryPoint = "GetModuleHandleW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint GetModuleHandle(string? moduleName);

    public static unsafe string ClassName(nint hWnd)
    {
        char* buffer = stackalloc char[256];
        int length = GetClassName(hWnd, buffer, 256);
        return length > 0 ? new string(buffer, 0, length) : string.Empty;
    }

    public static bool IsCloaked(nint hWnd) =>
        DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0;

    /// <summary>Window bounds without the invisible resize borders Windows 10+ adds.</summary>
    public static Rectangle VisibleBounds(nint hWnd)
    {
        if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out RECT frame, Marshal.SizeOf<RECT>()) == 0)
            return frame.ToRectangle();
        return GetWindowRect(hWnd, out RECT rect) ? rect.ToRectangle() : Rectangle.Empty;
    }

    public static unsafe string? CurrentWallpaperPath()
    {
        char* buffer = stackalloc char[1024];
        return SystemParametersInfo(SPI_GETDESKWALLPAPER, 1024, buffer, 0) ? new string(buffer) : null;
    }

    /// <summary>Re-applies the current wallpaper (without saving it) so Explorer repaints the desktop.</summary>
    public static unsafe void RepaintWallpaper()
    {
        string? path = CurrentWallpaperPath();
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return;
        fixed (char* value = path)
            SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, value, 0);
    }
}
