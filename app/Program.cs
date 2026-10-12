namespace KoiPaper;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using var instance = new Mutex(true, @"Local\KoiPaper.Instance", out bool firstInstance);
        using var showSettings = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\KoiPaper.ShowSettings");
        using var showResources = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\KoiPaper.ShowResources");
        bool resources = args.Contains("--resources", StringComparer.OrdinalIgnoreCase);
        if (!firstInstance)
        {
            // Already running in the tray: launching again opens its settings
            // window (or, with --resources, its resource monitor).
            (resources ? showResources : showSettings).Set();
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.ThreadException += (_, e) => Log.Write($"Unhandled: {e.Exception}");
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        if (resources) showResources.Set();
        Application.Run(new TrayApp(showSettings, showResources));
    }
}
