using System.Text.Json;
using Microsoft.Win32;

namespace KoiPaper;

/// <summary>
/// The shell's own preferences. Pond settings (weather, koi, fps, …) live in the
/// pond's localStorage instead, shared with the settings window.
/// </summary>
internal sealed class AppSettings
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public bool Sound { get; set; }

    public bool Paused { get; set; }

    /// <summary>Pause a monitor's pond while a maximized or full-screen window covers it.</summary>
    public bool AutoPause { get; set; } = true;

    public bool AllMonitors { get; set; } = true;

    /// <summary>With <see cref="AllMonitors"/>: a pond per monitor instead of one big pond across them all.</summary>
    public bool SeparatePonds { get; set; }

    public bool WelcomeShown { get; set; }

    public static string LocalDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KoiPaper");

    private static string FilePath => Path.Combine(LocalDirectory, "settings.json");

    public static AppSettings Load()
    {
        try
        {
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            return new AppSettings();
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(LocalDirectory);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, JsonOptions));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Preferences are a convenience; never crash the wallpaper over them.
        }
    }
}

/// <summary>"Start with Windows", as a per-user Run entry pointing at this exe.</summary>
internal static class Autostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "KoiPaper";

    private static string Command => $"\"{Environment.ProcessPath}\"";

    public static bool IsEnabled
    {
        get
        {
            using RegistryKey? key = Registry.CurrentUser.OpenSubKey(RunKey);
            return string.Equals(key?.GetValue(ValueName) as string, Command, StringComparison.OrdinalIgnoreCase);
        }
        set
        {
            using RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) key.SetValue(ValueName, Command);
            else key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }
}
