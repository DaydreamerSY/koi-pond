using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace KoiPaper;

/// <summary>Owns the wallpapers, the tray icon and everything that keeps them in step with the desktop.</summary>
internal sealed class TrayApp : ApplicationContext
{
    private static readonly (string Id, string Label)[] Weathers =
    [
        ("sunny", "Nắng"),
        ("deep-clear", "Nước trong"),
        ("overcast", "Âm u"),
        ("mist", "Sương mù"),
        ("rain", "Mưa"),
        ("sunset", "Hoàng hôn"),
        ("moonlight", "Ánh trăng"),
    ];

    private static readonly (string Id, string Label)[] FrameRates =
    [
        ("native", "Theo màn hình"),
        ("60", "60 fps"),
        ("30", "30 fps"),
        ("20", "20 fps (tiết kiệm pin)"),
    ];

    private static readonly int[] KoiCounts = [4, 8, 14, 20, 30, 48];

    private static readonly (string Kind, string Label)[] Visitors =
    [
        ("ducks", "Vịt"),
        ("crabs", "Cua"),
        ("shrimp", "Tôm"),
        ("frogs", "Ếch"),
    ];

    private readonly SynchronizationContext ui;
    private readonly AppSettings settings = AppSettings.Load();
    private readonly List<WallpaperWindow> wallpapers = [];
    private readonly Icon appIcon;
    private readonly Icon trayIcon;
    private readonly NotifyIcon tray;
    private readonly ShellEvents shellEvents = new();
    private readonly RegisteredWaitHandle showSettingsWait;
    private readonly RegisteredWaitHandle showResourcesWait;
    private readonly System.Windows.Forms.Timer watchTimer = new() { Interval = 1000 };
    private readonly System.Windows.Forms.Timer rebuildTimer = new();
    private CoreWebView2Environment? environment;
    private DesktopHost? host;
    private DesktopClickHook? clickHook;
    private SettingsForm? settingsForm;
    private ResourceForm? resourceForm;
    private PondState? pond;
    private bool sessionLocked;
    private bool rebuilding;
    private bool rebuildAgain;
    private bool exiting;

    public TrayApp(WaitHandle showSettingsSignal, WaitHandle showResourcesSignal)
    {
        ui = SynchronizationContext.Current!;
        appIcon = LoadIcon(SystemInformation.IconSize);
        trayIcon = LoadIcon(SystemInformation.SmallIconSize);

        tray = new NotifyIcon
        {
            Icon = trayIcon,
            Text = "Koi Paper",
            ContextMenuStrip = BuildMenu(),
            Visible = true,
        };
        tray.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) ShowSettings();
        };

        shellEvents.ExplorerRestarted += () => ScheduleRebuild(2000);
        rebuildTimer.Tick += (_, _) =>
        {
            rebuildTimer.Stop();
            Rebuild();
        };
        watchTimer.Tick += (_, _) => UpdatePlayback();
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
        SystemEvents.SessionSwitch += OnSessionSwitch;

        // A second launch of the exe asks this instance to open the settings window.
        showSettingsWait = ThreadPool.RegisterWaitForSingleObject(
            showSettingsSignal, (_, _) => ui.Post(_ => ShowSettings(), null), null, Timeout.Infinite, executeOnlyOnce: false);
        showResourcesWait = ThreadPool.RegisterWaitForSingleObject(
            showResourcesSignal, (_, _) => ui.Post(_ => ShowResources(), null), null, Timeout.Infinite, executeOnlyOnce: false);

        // Runs once Application.Run's message loop is up, so a startup failure can still exit it.
        ui.Post(_ => Start(), null);
    }

    private async void Start()
    {
        if (!File.Exists(Path.Combine(WebHost.WebRoot, "index.html")))
        {
            Fail($"Không tìm thấy giao diện hồ cá ở:\n{WebHost.WebRoot}\n\nHãy build thư mục web trước (xem README).");
            return;
        }

        try
        {
            environment = await WebHost.CreateEnvironmentAsync();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Fail("Koi Paper cần Microsoft Edge WebView2 Runtime.\nTải tại: https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            return;
        }

        Rebuild();
        watchTimer.Start();

        if (!settings.WelcomeShown)
        {
            tray.ShowBalloonTip(8000, "Koi Paper đang chạy",
                "Bấm vào mặt nước trên desktop để gọi cá. Bấm chuột phải vào biểu tượng cá koi ở khay hệ thống để chỉnh.",
                ToolTipIcon.None);
            settings.WelcomeShown = true;
            settings.Save();
        }
    }

    // ---- wallpapers --------------------------------------------------------

    private void ScheduleRebuild(int delayMs)
    {
        if (exiting) return;
        rebuildTimer.Stop();
        rebuildTimer.Interval = delayMs;
        rebuildTimer.Start();
    }

    /// <summary>Recreates every wallpaper; requests made while one is in progress run once it finishes.</summary>
    private async void Rebuild()
    {
        if (environment is null || exiting) return;
        if (rebuilding)
        {
            rebuildAgain = true;
            return;
        }

        rebuilding = true;
        try
        {
            do
            {
                rebuildAgain = false;
                await BuildWallpapersAsync(environment);
            } while (rebuildAgain && !exiting);
        }
        catch (Exception e)
        {
            Log.Write($"Rebuild failed: {e}");
            ScheduleRebuild(5000);
        }
        finally
        {
            rebuilding = false;
        }
    }

    private async Task BuildWallpapersAsync(CoreWebView2Environment environment)
    {
        DisposeWallpapers();

        host = DesktopHost.Find();
        if (host is null)
        {
            // Explorer is still starting (or restarting).
            Log.Write("Desktop not found; retrying.");
            ScheduleRebuild(3000);
            return;
        }

        Screen[] screens = settings.AllMonitors ? Screen.AllScreens : [Screen.PrimaryScreen ?? Screen.AllScreens[0]];
        var created = screens.Select(screen => new WallpaperWindow(screen)).ToList();
        foreach (WallpaperWindow wallpaper in created)
        {
            wallpaper.StateReceived += OnPondState;
            wallpaper.Failed += _ => ScheduleRebuild(1000);
            wallpapers.Add(wallpaper);
        }
        UpdatePlayback();

        await Task.WhenAll(created.Select(wallpaper => wallpaper.LoadAsync(environment)));
        await Task.WhenAll(created.Select(wallpaper => wallpaper.WaitUntilReadyAsync(TimeSpan.FromSeconds(8))));
        if (exiting) return;

        foreach (WallpaperWindow wallpaper in created) wallpaper.AttachTo(host);
        UpdatePlayback();
        Log.Write($"Attached {created.Count} wallpaper(s) ({(host.IsChildLayout ? "24H2+" : "legacy")} desktop layout).");
    }

    private void DisposeWallpapers()
    {
        if (wallpapers.Count == 0) return;
        bool wasAttached = wallpapers.Any(wallpaper => wallpaper.IsAttached);
        foreach (WallpaperWindow wallpaper in wallpapers) wallpaper.Dispose();
        wallpapers.Clear();
        // The legacy WorkerW keeps showing the last frame until Explorer repaints it.
        if (wasAttached && host is { IsChildLayout: false }) Native.RepaintWallpaper();
    }

    private void UpdatePlayback()
    {
        if (!rebuilding && wallpapers.Count > 0 &&
            (host is { IsAlive: false } || wallpapers.Any(w => w.IsAttached && !Native.IsWindow(w.Handle))))
        {
            // Explorer replaced its desktop windows (restart, wallpaper or theme change).
            Log.Write("Desktop changed underneath the wallpaper; rebuilding.");
            ScheduleRebuild(500);
            return;
        }

        HashSet<string> covered = settings.AutoPause ? Occlusion.CoveredScreens() : [];
        foreach (WallpaperWindow wallpaper in wallpapers)
        {
            wallpaper.PauseReason =
                settings.Paused ? "bạn đã bấm Tạm dừng"
                : sessionLocked ? "máy đang khoá"
                : covered.Contains(wallpaper.Screen.DeviceName) ? "bị cửa sổ khác che kín"
                : null;
            wallpaper.SetPaused(wallpaper.PauseReason is not null);
            // One river is enough: only the main monitor's pond plays sound.
            wallpaper.SetSound(settings.Sound && !settings.Paused && !sessionLocked && wallpaper == SoundWallpaper);
        }

        // Every mouse event on the system (each move too) passes through a
        // low-level hook, so only keep it while a pond can be clicked: not
        // while a game or a maximized window covers every pond.
        bool clickable = wallpapers.Any(wallpaper => wallpaper.IsAttached && !wallpaper.IsPaused);
        if (clickable && clickHook is null) clickHook = new DesktopClickHook(OnDesktopClick);
        else if (!clickable && clickHook is not null)
        {
            clickHook.Dispose();
            clickHook = null;
        }
    }

    private WallpaperWindow? SoundWallpaper =>
        wallpapers.FirstOrDefault(wallpaper => wallpaper.Screen.Primary) ?? wallpapers.FirstOrDefault();

    private void OnPondState(WallpaperWindow source, PondState state)
    {
        if (source == SoundWallpaper) pond = state;
    }

    /// <summary>Calls the fish on the monitor under the pointer, whichever monitor that is.</summary>
    private void OnDesktopClick(Point point)
    {
        string monitor = Screen.FromPoint(point).DeviceName;
        WallpaperWindow? wallpaper =
            wallpapers.FirstOrDefault(candidate => candidate.IsAttached && candidate.Bounds.Contains(point))
            ?? wallpapers.FirstOrDefault(candidate => candidate.IsAttached && candidate.Screen.DeviceName == monitor);
        if (wallpaper is null)
        {
            Log.Write($"Desktop click at {point} on {monitor} matched no pond: {string.Join(", ", wallpapers.Select(w => $"{w.Screen.DeviceName} {w.Bounds}"))}");
            return;
        }
        wallpaper.CallFishAt(point);
    }

    /// <summary>Pond settings go to every monitor's pond (they also persist, shared through localStorage).</summary>
    private void Broadcast(object message)
    {
        foreach (WallpaperWindow wallpaper in wallpapers) wallpaper.Post(message);
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e) => ScheduleRebuild(1500);

    private void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.SessionUnlock)
        {
            sessionLocked = e.Reason == SessionSwitchReason.SessionLock;
            UpdatePlayback();
        }
    }

    // ---- tray menu ----------------------------------------------------------

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();

        var openSettings = new ToolStripMenuItem("Cài đặt hồ cá…", null, (_, _) => ShowSettings());
        openSettings.Font = new Font(openSettings.Font, FontStyle.Bold);
        var openResources = new ToolStripMenuItem("Tài nguyên đang dùng…", null, (_, _) => ShowResources());

        var weather = new ToolStripMenuItem("Thời tiết");
        var weatherItems = new List<ToolStripMenuItem>();
        foreach ((string id, string label) in Weathers)
            weatherItems.Add(new ToolStripMenuItem(label, null, (_, _) => Broadcast(new { type = "weather", value = id })) { Tag = id });
        // Picks a different preset every few minutes; choosing one above turns it off.
        var randomWeather = new ToolStripMenuItem("Ngẫu nhiên", null,
            (_, _) => Broadcast(new { type = "randomWeather", value = !(pond?.RandomWeather ?? false) }));
        weather.DropDownItems.AddRange([.. weatherItems, new ToolStripSeparator(), randomWeather]);

        var rain = new ToolStripMenuItem("Mưa rơi trên mặt nước", null,
            (_, _) => Broadcast(new { type = "rain", value = !(pond?.Rain ?? false) }));

        var sound = new ToolStripMenuItem("Âm thanh dòng nước", null, (_, _) =>
        {
            settings.Sound = !settings.Sound;
            settings.Save();
            UpdatePlayback();
        });

        var koi = new ToolStripMenuItem("Số cá koi");
        foreach (int count in KoiCounts)
            koi.DropDownItems.Add(new ToolStripMenuItem(count.ToString(), null, (_, _) => Broadcast(new { type = "koi", value = count })) { Tag = count });

        var frameRate = new ToolStripMenuItem("Tốc độ khung hình");
        foreach ((string id, string label) in FrameRates)
            frameRate.DropDownItems.Add(new ToolStripMenuItem(label, null, (_, _) => Broadcast(new { type = "fps", value = id })) { Tag = id });

        var scatter = new ToolStripMenuItem("Xua đàn cá", null, (_, _) => Broadcast(new { type = "scatter" }));

        var visitors = new ToolStripMenuItem("Khách ghé hồ");
        foreach ((string kind, string label) in Visitors)
        {
            visitors.DropDownItems.Add(new ToolStripMenuItem(label, null,
                (_, _) => Broadcast(new { type = "visitor", kind, value = VisitorCount(kind) == 0 })) { Tag = kind });
        }

        var pause = new ToolStripMenuItem("Tạm dừng", null, (_, _) =>
        {
            settings.Paused = !settings.Paused;
            settings.Save();
            UpdatePlayback();
        });

        var autoPause = new ToolStripMenuItem("Tự dừng khi bị cửa sổ khác che kín", null, (_, _) =>
        {
            settings.AutoPause = !settings.AutoPause;
            settings.Save();
            UpdatePlayback();
        });

        var monitors = new ToolStripMenuItem("Hiển thị trên");
        var allMonitors = new ToolStripMenuItem("Tất cả màn hình", null, (_, _) => SetAllMonitors(true));
        var primaryMonitor = new ToolStripMenuItem("Chỉ màn hình chính", null, (_, _) => SetAllMonitors(false));
        monitors.DropDownItems.AddRange([allMonitors, primaryMonitor]);

        var autostart = new ToolStripMenuItem("Khởi động cùng Windows", null, (_, _) =>
        {
            try
            {
                Autostart.IsEnabled = !Autostart.IsEnabled;
            }
            catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException or IOException)
            {
                Log.Write($"Autostart toggle failed: {e.Message}");
            }
        });

        var exit = new ToolStripMenuItem("Thoát", null, (_, _) => ExitThread());

        menu.Items.AddRange(
        [
            openSettings,
            openResources,
            new ToolStripSeparator(),
            weather, rain, sound, koi, visitors, frameRate, scatter,
            new ToolStripSeparator(),
            pause, autoPause, monitors, autostart,
            new ToolStripSeparator(),
            exit,
        ]);

        menu.Opening += (_, _) =>
        {
            bool loaded = pond is not null;
            foreach (ToolStripMenuItem item in weatherItems) item.Checked = (string)item.Tag! == pond?.Weather;
            randomWeather.Checked = pond?.RandomWeather ?? false;
            foreach (ToolStripMenuItem item in koi.DropDownItems) item.Checked = (int)item.Tag! == pond?.Koi;
            foreach (ToolStripMenuItem item in frameRate.DropDownItems) item.Checked = (string)item.Tag! == pond?.Fps;
            foreach (ToolStripMenuItem item in visitors.DropDownItems) item.Checked = VisitorCount((string)item.Tag!) > 0;
            koi.Text = loaded ? $"Số cá koi ({pond!.Koi})" : "Số cá koi";
            weather.Enabled = rain.Enabled = koi.Enabled = visitors.Enabled = frameRate.Enabled = scatter.Enabled = loaded;
            rain.Checked = pond?.Rain ?? false;
            sound.Checked = settings.Sound;
            pause.Checked = settings.Paused;
            autoPause.Checked = settings.AutoPause;
            allMonitors.Checked = settings.AllMonitors;
            primaryMonitor.Checked = !settings.AllMonitors;
            autostart.Checked = Autostart.IsEnabled;
        };
        return menu;
    }

    private int VisitorCount(string kind) => pond?.Visitors?.GetValueOrDefault(kind) ?? 0;

    private void SetAllMonitors(bool all)
    {
        if (settings.AllMonitors == all) return;
        settings.AllMonitors = all;
        settings.Save();
        Rebuild();
    }

    private void ShowResources()
    {
        if (exiting) return;
        if (resourceForm is null || resourceForm.IsDisposed)
        {
            resourceForm = new ResourceForm(
                appIcon,
                () => wallpapers.Select(wallpaper => wallpaper.BrowserProcessId).FirstOrDefault(pid => pid > 0),
                PondStatus);
            resourceForm.FormClosed += (_, _) => resourceForm = null;
            resourceForm.Show();
            return;
        }
        if (resourceForm.WindowState == FormWindowState.Minimized) resourceForm.WindowState = FormWindowState.Normal;
        resourceForm.Activate();
    }

    /// <summary>One line per monitor: the pond's real frame rate, or why it's paused.</summary>
    private string PondStatus()
    {
        if (wallpapers.Count == 0) return "Hồ cá: chưa chạy";
        return string.Join("   ·   ", wallpapers.Select((wallpaper, index) =>
        {
            string screen = wallpapers.Count == 1 ? "Hồ cá" : wallpaper.Screen.Primary ? "Màn hình chính" : $"Màn hình {index + 1}";
            return wallpaper.IsPaused
                ? $"{screen}: tạm dừng ({wallpaper.PauseReason})"
                : $"{screen}: đang chạy, {wallpaper.Fps} khung hình/giây";
        }));
    }

    private void ShowSettings()
    {
        if (environment is null || exiting) return;
        if (settingsForm is null || settingsForm.IsDisposed)
        {
            settingsForm = new SettingsForm(environment, appIcon);
            settingsForm.FormClosed += (_, _) => settingsForm = null;
            settingsForm.Show();
            return;
        }
        if (settingsForm.WindowState == FormWindowState.Minimized) settingsForm.WindowState = FormWindowState.Normal;
        settingsForm.Activate();
    }

    // ---- lifetime -----------------------------------------------------------

    private void Fail(string message)
    {
        Log.Write(message);
        MessageBox.Show(message, "Koi Paper", MessageBoxButtons.OK, MessageBoxIcon.Error);
        ExitThread();
    }

    private static Icon LoadIcon(Size size)
    {
        using Stream? stream = typeof(TrayApp).Assembly.GetManifestResourceStream("KoiPaper.app.ico");
        return stream is null ? (Icon)SystemIcons.Application.Clone() : new Icon(stream, size);
    }

    protected override void ExitThreadCore()
    {
        exiting = true;
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        showSettingsWait.Unregister(null);
        showResourcesWait.Unregister(null);
        watchTimer.Dispose();
        rebuildTimer.Dispose();
        clickHook?.Dispose();
        settingsForm?.Close();
        resourceForm?.Close();
        DisposeWallpapers();
        shellEvents.Dispose();
        tray.Visible = false;
        tray.Dispose();
        base.ExitThreadCore();
    }
}

/// <summary>A hidden top-level window that hears Explorer restarting ("TaskbarCreated" is only broadcast to top-level windows).</summary>
internal sealed class ShellEvents : NativeWindow, IDisposable
{
    private static readonly uint TaskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");

    public ShellEvents() => CreateHandle(new CreateParams { Caption = "Koi Paper shell events" });

    public event Action? ExplorerRestarted;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == TaskbarCreated) ExplorerRestarted?.Invoke();
        base.WndProc(ref m);
    }

    public void Dispose() => DestroyHandle();
}
