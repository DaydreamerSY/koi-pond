namespace KoiPaper;

/// <summary>A small rolling log in %LOCALAPPDATA%\KoiPaper, for when the wallpaper misbehaves.</summary>
internal static class Log
{
    private const long MaxBytes = 256 * 1024;
    private static readonly object Gate = new();

    public static string FilePath => Path.Combine(AppSettings.LocalDirectory, "koipaper.log");

    public static void Write(string message)
    {
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(AppSettings.LocalDirectory);
                var file = new FileInfo(FilePath);
                if (file.Exists && file.Length > MaxBytes) file.Delete();
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // Logging must never take the wallpaper down.
            }
        }
    }
}
