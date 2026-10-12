using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace KoiPaper;

/// <summary>Serves the built pond (../web/dist, copied to wwwroot) to every WebView2 in the app.</summary>
internal static class WebHost
{
    // Shared by the wallpapers and the settings window, so they share localStorage
    // (pond settings) and stay in sync through `storage` events.
    private const string HostName = "koipaper.example";

    public static string WebRoot => Path.Combine(AppContext.BaseDirectory, "wwwroot");

    public static string PondUrl(bool wallpaper) =>
        $"https://{HostName}/index.html{(wallpaper ? "?wallpaper" : "")}";

    public static Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        var options = new CoreWebView2EnvironmentOptions
        {
            // The river ambience starts from the tray menu, not from a click on the page.
            // Chromium's own occlusion check would freeze a window parked behind the
            // desktop icons; TrayApp pauses the pond itself when it's covered.
            AdditionalBrowserArguments =
                "--autoplay-policy=no-user-gesture-required --disable-features=CalculateNativeWinOcclusion",
        };
        string userData = Path.Combine(AppSettings.LocalDirectory, "WebView2");
        return CoreWebView2Environment.CreateAsync(null, userData, options);
    }

    public static void Configure(CoreWebView2 core, bool wallpaper)
    {
        core.SetVirtualHostNameToFolderMapping(HostName, WebRoot, CoreWebView2HostResourceAccessKind.Allow);
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        core.Settings.IsSwipeNavigationEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = !wallpaper;
        core.Settings.AreBrowserAcceleratorKeysEnabled = !wallpaper;
        core.Settings.IsBuiltInErrorPageEnabled = !wallpaper;

        // Links (GitHub, the upstream project) open in the user's browser.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        };
        core.NavigationStarting += (_, e) =>
        {
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri? uri) && uri.Host == HostName) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        };
    }

    private static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? uri)) return;
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return;
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }
}
