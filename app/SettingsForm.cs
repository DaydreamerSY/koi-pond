using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KoiPaper;

/// <summary>
/// The full Nagomi page with its settings drawer. It shares localStorage with the
/// wallpapers, which pick up every change live.
/// </summary>
internal sealed class SettingsForm : Form
{
    private readonly CoreWebView2Environment environment;
    private readonly WebView2 view;

    public SettingsForm(CoreWebView2Environment environment, Icon icon)
    {
        this.environment = environment;
        Text = "Koi Paper — Cài đặt hồ cá";
        Icon = icon;
        BackColor = Color.FromArgb(9, 9, 11);
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1280, 760);
        MinimumSize = new Size(640, 420);

        view = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = BackColor,
        };
        Controls.Add(view);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        await view.EnsureCoreWebView2Async(environment);
        WebHost.Configure(view.CoreWebView2, wallpaper: false);
        view.CoreWebView2.Navigate(WebHost.PondUrl(wallpaper: false));
    }
}
