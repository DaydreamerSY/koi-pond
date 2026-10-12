using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using static KoiPaper.Native;

namespace KoiPaper;

/// <summary>One monitor's pond: a plain Win32 window hosting a WebView2, parked behind the desktop icons.</summary>
internal sealed class WallpaperWindow : NativeWindow, IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly TaskCompletionSource firstState = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private CoreWebView2Controller? controller;
    private bool pageReady;
    private bool paused;
    private bool sound;

    public WallpaperWindow(Screen screen)
    {
        Screen = screen;
        Bounds = screen.Bounds;
        CreateHandle(new CreateParams
        {
            Caption = "Koi Paper",
            X = Bounds.X,
            Y = Bounds.Y,
            Width = Bounds.Width,
            Height = Bounds.Height,
            Style = unchecked((int)(WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS)),
            ExStyle = (int)(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE),
        });
    }

    public Screen Screen { get; }

    public Rectangle Bounds { get; }

    public bool IsAttached { get; private set; }

    /// <summary>Frames the pond actually drew in the last second (0 while paused).</summary>
    public int Fps { get; private set; }

    public bool IsPaused => paused;

    /// <summary>Why the pond is paused, for the resource window (null while running).</summary>
    public string? PauseReason { get; set; }

    /// <summary>The WebView2 browser process (shared by every web view in the app).</summary>
    public int BrowserProcessId
    {
        get
        {
            try
            {
                return (int)(controller?.CoreWebView2?.BrowserProcessId ?? 0);
            }
            catch (InvalidOperationException)
            {
                return 0;
            }
        }
    }

    /// <summary>The pond reported its state (weather, koi count, …).</summary>
    public event Action<WallpaperWindow, PondState>? StateReceived;

    /// <summary>The WebView2 browser process died; the window needs rebuilding.</summary>
    public event Action<WallpaperWindow>? Failed;

    public async Task LoadAsync(CoreWebView2Environment environment)
    {
        controller = await environment.CreateCoreWebView2ControllerAsync(Handle);
        controller.DefaultBackgroundColor = Color.FromArgb(255, 9, 9, 11);
        controller.Bounds = new Rectangle(Point.Empty, Bounds.Size);

        CoreWebView2 core = controller.CoreWebView2;
        WebHost.Configure(core, wallpaper: true);
        core.WebMessageReceived += OnWebMessage;
        core.NavigationStarting += (_, _) => pageReady = false;
        core.ProcessFailed += (_, e) =>
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) Failed?.Invoke(this);
            else if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited
                     or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) core.Reload();
        };
        core.Navigate(WebHost.PondUrl(wallpaper: true));
    }

    /// <summary>Waits until the pond has rendered (or gives up after a while), so attaching never shows a blank frame.</summary>
    public Task WaitUntilReadyAsync(TimeSpan timeout) => Task.WhenAny(firstState.Task, Task.Delay(timeout));

    public void AttachTo(DesktopHost host)
    {
        host.Attach(Handle, Bounds);
        IsAttached = true;
        if (controller is not null)
        {
            // WebView2 starts hidden when its parent is (ours was, until now).
            controller.IsVisible = true;
            controller.NotifyParentWindowPositionChanged();
        }
    }

    /// <summary>Converts a screen point to the pond's normalized coordinates and calls the fish there.</summary>
    public void CallFishAt(Point screenPoint) => Post(new
    {
        type = "call",
        x = (screenPoint.X - Bounds.X) / (double)Bounds.Width,
        y = (screenPoint.Y - Bounds.Y) / (double)Bounds.Height,
    });

    public void SetPaused(bool value)
    {
        if (paused == value) return;
        paused = value;
        if (pageReady) Post(new { type = "paused", value });
    }

    public void SetSound(bool value)
    {
        if (sound == value) return;
        sound = value;
        if (pageReady) Post(new { type = "sound", value });
    }

    public void Post(object message)
    {
        try
        {
            controller?.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, JsonOptions));
        }
        catch (InvalidOperationException)
        {
            // The WebView is shutting down.
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        PondState? state;
        try
        {
            using JsonDocument message = JsonDocument.Parse(e.WebMessageAsJson);
            JsonElement root = message.RootElement;
            string? type = root.TryGetProperty("type", out JsonElement typeValue) ? typeValue.GetString() : null;
            if (type == "stats")
            {
                Fps = root.TryGetProperty("fps", out JsonElement fps) && fps.TryGetInt32(out int value) ? value : 0;
                return;
            }
            if (type != "state") return;
            state = root.Deserialize<PondState>(JsonOptions);
        }
        catch (JsonException)
        {
            return;
        }
        if (state is null) return;
        if (!pageReady)
        {
            // A fresh page (first load, or a reload after a crash) starts unpaused and silent.
            pageReady = true;
            if (paused) Post(new { type = "paused", value = true });
            if (sound) Post(new { type = "sound", value = true });
        }
        firstState.TrySetResult();
        StateReceived?.Invoke(this, state);
    }

    public void Dispose()
    {
        controller?.Close();
        controller = null;
        DestroyHandle();
    }
}

/// <summary>What the pond reports back (see web/src/wallpaper.ts).</summary>
internal sealed record PondState(string Type, string Weather, bool Rain, int Koi, string Fps, Dictionary<string, int>? Visitors);
