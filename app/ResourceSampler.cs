using System.Diagnostics;
using System.Runtime.InteropServices;

namespace KoiPaper;

/// <summary>
/// Measures what Koi Paper costs: this process plus the WebView2 processes it
/// runs the pond in (browser, GPU, renderers, utilities), the way Task Manager
/// counts them.
/// </summary>
internal sealed class ResourceSampler : IDisposable
{
    public sealed record Row(int Pid, string Name, double Cpu, long Memory, double? Gpu, long? GpuMemory);

    public sealed record Sample(
        IReadOnlyList<Row> Rows,
        double Cpu,
        long Memory,
        double? Gpu,
        long? GpuMemory);

    private readonly Dictionary<int, (TimeSpan Cpu, long Timestamp)> lastCpu = [];
    private readonly Dictionary<int, string> names = [];
    private readonly Dictionary<string, PerformanceCounter> engineCounters = [];
    private readonly Dictionary<string, PerformanceCounter> memoryCounters = [];
    private long lastCounterScan;
    private bool gpuCountersAvailable = true;

    /// <summary>Takes one sample. Slow-ish (performance counters): call off the UI thread.</summary>
    public Sample Take(int browserProcessId)
    {
        var pids = new List<int> { Environment.ProcessId };
        if (browserProcessId > 0)
        {
            pids.Add(browserProcessId);
            pids.AddRange(ChildProcesses(browserProcessId));
        }

        Dictionary<int, double> gpu = [];
        Dictionary<int, long> gpuMemory = [];
        if (gpuCountersAvailable) ReadGpu(pids, gpu, gpuMemory);

        var rows = new List<Row>();
        long now = Stopwatch.GetTimestamp();
        foreach (int pid in pids)
        {
            try
            {
                using Process process = Process.GetProcessById(pid);
                TimeSpan cpuTime = process.TotalProcessorTime;
                double cpu = 0;
                if (lastCpu.TryGetValue(pid, out var last))
                {
                    double wall = Stopwatch.GetElapsedTime(last.Timestamp, now).TotalMilliseconds;
                    if (wall > 0) cpu = (cpuTime - last.Cpu).TotalMilliseconds / wall * 100 / Environment.ProcessorCount;
                }
                lastCpu[pid] = (cpuTime, now);
                rows.Add(new Row(
                    pid,
                    NameOf(pid),
                    Math.Max(0, cpu),
                    process.PrivateMemorySize64,
                    gpuCountersAvailable ? gpu.GetValueOrDefault(pid) : null,
                    gpuCountersAvailable ? gpuMemory.GetValueOrDefault(pid) : null));
            }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                // The process exited between listing and reading it.
            }
        }
        foreach (int stale in lastCpu.Keys.Except(pids).ToList()) lastCpu.Remove(stale);

        return new Sample(
            rows,
            rows.Sum(row => row.Cpu),
            rows.Sum(row => row.Memory),
            gpuCountersAvailable ? Math.Min(100, rows.Sum(row => row.Gpu ?? 0)) : null,
            gpuCountersAvailable ? rows.Sum(row => row.GpuMemory ?? 0) : null);
    }

    // ---- processes -------------------------------------------------------------------

    private string NameOf(int pid)
    {
        if (pid == Environment.ProcessId) return "Koi Paper (app)";
        if (names.TryGetValue(pid, out string? name)) return name;
        string? commandLine = CommandLine(pid);
        name = commandLine switch
        {
            null => "WebView2",
            _ when commandLine.Contains("--type=renderer") => "WebView2 · vẽ trang (renderer)",
            _ when commandLine.Contains("--type=gpu-process") => "WebView2 · GPU",
            _ when commandLine.Contains("network.mojom.NetworkService") => "WebView2 · mạng",
            _ when commandLine.Contains("audio.mojom.AudioService") => "WebView2 · âm thanh",
            _ when commandLine.Contains("storage.mojom.StorageService") => "WebView2 · lưu trữ",
            _ when commandLine.Contains("--type=utility") => "WebView2 · tiện ích",
            _ when commandLine.Contains("--type=crashpad-handler") => "WebView2 · báo lỗi",
            _ when !commandLine.Contains("--type=") => "WebView2 · trình duyệt",
            _ => "WebView2",
        };
        names[pid] = name;
        return name;
    }

    private static List<int> ChildProcesses(int parentId)
    {
        var children = new List<int>();
        nint snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == -1) return children;
        try
        {
            var entry = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
            for (bool ok = Process32FirstW(snapshot, ref entry); ok; ok = Process32NextW(snapshot, ref entry))
            {
                if (entry.th32ParentProcessID == parentId) children.Add((int)entry.th32ProcessID);
            }
        }
        finally
        {
            CloseHandle(snapshot);
        }
        return children;
    }

    private static string? CommandLine(int pid)
    {
        nint handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (handle == 0) return null;
        try
        {
            NtQueryInformationProcess(handle, ProcessCommandLineInformation, 0, 0, out int size);
            if (size <= 0) return null;
            nint buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (NtQueryInformationProcess(handle, ProcessCommandLineInformation, buffer, size, out _) != 0) return null;
                var text = Marshal.PtrToStructure<UNICODE_STRING>(buffer);
                return Marshal.PtrToStringUni(text.Buffer, text.Length / 2);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    // ---- GPU (Windows performance counters, as Task Manager reads them) ----------------

    private void ReadGpu(List<int> pids, Dictionary<int, double> gpu, Dictionary<int, long> gpuMemory)
    {
        try
        {
            // Instances come and go with processes and engines; re-list them now and then.
            if (Stopwatch.GetElapsedTime(lastCounterScan).TotalSeconds > 5)
            {
                lastCounterScan = Stopwatch.GetTimestamp();
                Sync(engineCounters, "GPU Engine", "Utilization Percentage", pids);
                Sync(memoryCounters, "GPU Process Memory", "Dedicated Usage", pids);
            }

            // Task Manager's GPU column: the busiest engine type (3D, copy, video…) of each process.
            var perEngine = new Dictionary<(int Pid, string Engine), double>();
            foreach ((string instance, PerformanceCounter counter) in engineCounters.ToList())
            {
                if (!TryRead(engineCounters, instance, counter, out float value)) continue;
                int pid = PidOf(instance);
                string engine = instance[(instance.LastIndexOf("engtype_", StringComparison.Ordinal) + 8)..];
                perEngine[(pid, engine)] = perEngine.GetValueOrDefault((pid, engine)) + value;
            }
            foreach (((int pid, _), double value) in perEngine) gpu[pid] = Math.Max(gpu.GetValueOrDefault(pid), Math.Min(100, value));

            foreach ((string instance, PerformanceCounter counter) in memoryCounters.ToList())
            {
                if (!TryRead(memoryCounters, instance, counter, out float value)) continue;
                int pid = PidOf(instance);
                gpuMemory[pid] = gpuMemory.GetValueOrDefault(pid) + (long)value;
            }
        }
        catch (Exception e) when (e is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            Log.Write($"GPU counters unavailable: {e.Message}");
            gpuCountersAvailable = false;
        }
    }

    private static void Sync(Dictionary<string, PerformanceCounter> counters, string category, string counterName, List<int> pids)
    {
        var wanted = new PerformanceCounterCategory(category).GetInstanceNames()
            .Where(instance => pids.Contains(PidOf(instance)))
            .ToHashSet();
        foreach (string gone in counters.Keys.Where(instance => !wanted.Contains(instance)).ToList())
        {
            counters[gone].Dispose();
            counters.Remove(gone);
        }
        foreach (string instance in wanted.Where(instance => !counters.ContainsKey(instance)))
        {
            var counter = new PerformanceCounter(category, counterName, instance, readOnly: true);
            counter.NextValue(); // Rate counters need a first reading to compare against.
            counters[instance] = counter;
        }
    }

    private static bool TryRead(Dictionary<string, PerformanceCounter> counters, string instance, PerformanceCounter counter, out float value)
    {
        try
        {
            value = counter.NextValue();
            return true;
        }
        catch (InvalidOperationException)
        {
            // The engine or process went away.
            counter.Dispose();
            counters.Remove(instance);
            value = 0;
            return false;
        }
    }

    /// <summary>"pid_1234_luid_…" → 1234.</summary>
    private static int PidOf(string instance)
    {
        if (!instance.StartsWith("pid_", StringComparison.Ordinal)) return -1;
        int end = instance.IndexOf('_', 4);
        return end > 4 && int.TryParse(instance.AsSpan(4, end - 4), out int pid) ? pid : -1;
    }

    public void Dispose()
    {
        foreach (PerformanceCounter counter in engineCounters.Values.Concat(memoryCounters.Values)) counter.Dispose();
        engineCounters.Clear();
        memoryCounters.Clear();
    }

    // ---- interop -----------------------------------------------------------------------

    private const uint TH32CS_SNAPPROCESS = 0x2;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const int ProcessCommandLineInformation = 60;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public nint th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public nint Buffer;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Process32FirstW(nint snapshot, ref PROCESSENTRY32W entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Process32NextW(nint snapshot, ref PROCESSENTRY32W entry);

    [DllImport("kernel32.dll")]
    private static extern nint OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(nint handle);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(nint process, int informationClass, nint buffer, int length, out int returnLength);
}
