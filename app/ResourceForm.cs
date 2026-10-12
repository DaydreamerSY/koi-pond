using System.Drawing.Drawing2D;

namespace KoiPaper;

/// <summary>Live CPU, memory, and GPU use of Koi Paper and its WebView2 processes.</summary>
internal sealed class ResourceForm : Form
{
    private const int HistoryLength = 120;

    private readonly Func<int> browserProcessId;
    private readonly Func<string> pondStatus;
    private readonly ResourceSampler sampler = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private readonly Tile cpuTile = new("CPU");
    private readonly Tile memoryTile = new("RAM");
    private readonly Tile gpuTile = new("GPU");
    private readonly Tile gpuMemoryTile = new("VRAM");
    private readonly Label statusLabel = new() { AutoSize = true, Margin = new Padding(3, 6, 3, 6) };
    private readonly HistoryChart chart = new() { Dock = DockStyle.Fill, Height = 130 };
    private readonly ListView list = new BufferedListView
    {
        Dock = DockStyle.Fill,
        View = View.Details,
        FullRowSelect = true,
        HeaderStyle = ColumnHeaderStyle.Nonclickable,
    };
    private bool sampling;

    public ResourceForm(Icon icon, Func<int> browserProcessId, Func<string> pondStatus)
    {
        this.browserProcessId = browserProcessId;
        this.pondStatus = pondStatus;
        Text = "Koi Paper — Tài nguyên đang dùng";
        Icon = icon;
        Font = SystemFonts.MessageBoxFont;
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(680, 600);
        MinimumSize = new Size(520, 460);

        list.Columns.Add("Tiến trình", 230);
        list.Columns.Add("PID", 64, HorizontalAlignment.Right);
        list.Columns.Add("CPU %", 70, HorizontalAlignment.Right);
        list.Columns.Add("RAM", 84, HorizontalAlignment.Right);
        list.Columns.Add("GPU %", 64, HorizontalAlignment.Right);
        list.Columns.Add("VRAM", 84, HorizontalAlignment.Right);

        var tiles = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 4 };
        for (int column = 0; column < 4; column += 1) tiles.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        tiles.Controls.AddRange([cpuTile, memoryTile, gpuTile, gpuMemoryTile]);

        var note = new Label
        {
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
            Margin = new Padding(3, 6, 3, 3),
            Text = $"CPU tính theo % toàn bộ CPU ({Environment.ProcessorCount} luồng), giống cột CPU của Task Manager. " +
                   "RAM là bộ nhớ riêng (private bytes). Chỉ đo khi cửa sổ này đang mở.",
        };

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(10), ColumnCount = 1 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 140));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(tiles);
        layout.Controls.Add(statusLabel);
        layout.Controls.Add(chart);
        layout.Controls.Add(list);
        layout.Controls.Add(note);
        note.MaximumSize = new Size(640, 0);
        Controls.Add(layout);

        timer.Tick += (_, _) => Sample();
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Sample();
        timer.Start();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        timer.Dispose();
        // A sample still in flight disposes the sampler when it returns.
        if (!sampling) sampler.Dispose();
        base.OnFormClosed(e);
    }

    private async void Sample()
    {
        if (sampling) return;
        sampling = true;
        try
        {
            int browser = browserProcessId();
            string status = pondStatus();
            ResourceSampler.Sample sample = await Task.Run(() => sampler.Take(browser));
            if (IsDisposed) return;
            Display(sample, status);
        }
        catch (Exception e)
        {
            Log.Write($"Resource sampling failed: {e}");
        }
        finally
        {
            sampling = false;
            if (IsDisposed) sampler.Dispose();
        }
    }

    private void Display(ResourceSampler.Sample sample, string status)
    {
        cpuTile.Set($"{sample.Cpu:0.0} %", $"{sample.Cpu * Environment.ProcessorCount:0} % của 1 luồng");
        memoryTile.Set(Megabytes(sample.Memory), $"{sample.Rows.Count} tiến trình");
        gpuTile.Set(sample.Gpu is { } gpu ? $"{gpu:0.0} %" : "—", sample.Gpu is null ? "không đọc được" : "toàn bộ GPU");
        gpuMemoryTile.Set(sample.GpuMemory is { } vram ? Megabytes(vram) : "—", "bộ nhớ GPU riêng");
        statusLabel.Text = status;
        chart.Add(sample.Cpu, sample.Gpu ?? 0);

        list.BeginUpdate();
        list.Items.Clear();
        foreach (ResourceSampler.Row row in sample.Rows.OrderByDescending(row => row.Cpu))
        {
            list.Items.Add(new ListViewItem(
            [
                row.Name,
                row.Pid.ToString(),
                $"{row.Cpu:0.0}",
                Megabytes(row.Memory),
                row.Gpu is { } rowGpu ? $"{rowGpu:0.0}" : "—",
                row.GpuMemory is { } rowVram ? Megabytes(rowVram) : "—",
            ]));
        }
        list.EndUpdate();
    }

    private static string Megabytes(long bytes) => $"{bytes / 1024.0 / 1024.0:0} MB";

    private sealed class BufferedListView : ListView
    {
        public BufferedListView() => DoubleBuffered = true;
    }

    /// <summary>A big number with a caption above and a hint below.</summary>
    private sealed class Tile : TableLayoutPanel
    {
        private readonly Label value = new() { AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont!.FontFamily, 16f, FontStyle.Bold) };
        private readonly Label hint = new() { AutoSize = true, ForeColor = SystemColors.GrayText };

        public Tile(string caption)
        {
            Dock = DockStyle.Fill;
            AutoSize = true;
            ColumnCount = 1;
            Margin = new Padding(3);
            Padding = new Padding(8);
            BackColor = SystemColors.ControlLight;
            Controls.Add(new Label { AutoSize = true, Text = caption, ForeColor = SystemColors.GrayText });
            Controls.Add(value);
            Controls.Add(hint);
            Set("…", "");
        }

        public void Set(string text, string detail)
        {
            value.Text = text;
            hint.Text = detail;
        }
    }

    /// <summary>The last two minutes of CPU and GPU use.</summary>
    private sealed class HistoryChart : Control
    {
        private static readonly Color CpuColor = Color.FromArgb(37, 99, 235);
        private static readonly Color GpuColor = Color.FromArgb(234, 88, 12);
        private readonly List<(double Cpu, double Gpu)> points = [];

        public HistoryChart()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = SystemColors.Window;
        }

        public void Add(double cpu, double gpu)
        {
            points.Add((cpu, gpu));
            if (points.Count > HistoryLength) points.RemoveAt(0);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle plot = Rectangle.FromLTRB(40, 8, Width - 8, Height - 20);
            if (plot.Width <= 0 || plot.Height <= 0) return;

            double peak = points.Count == 0 ? 0 : points.Max(point => Math.Max(point.Cpu, point.Gpu));
            double top = Math.Max(5, Math.Ceiling(peak * 1.25 / 5) * 5);
            using var gridPen = new Pen(SystemColors.ControlLight);
            using var textBrush = new SolidBrush(SystemColors.GrayText);
            for (int step = 0; step <= 4; step += 1)
            {
                float y = plot.Bottom - plot.Height * step / 4f;
                g.DrawLine(gridPen, plot.Left, y, plot.Right, y);
                g.DrawString($"{top * step / 4:0.#}%", Font, textBrush, 2, y - Font.Height / 2f);
            }
            g.DrawString("2 phút trước", Font, textBrush, plot.Left, plot.Bottom + 3);
            TextRenderer.DrawText(g, "bây giờ", Font, new Point(plot.Right - 50, plot.Bottom + 3), SystemColors.GrayText);

            DrawSeries(g, plot, top, point => point.Gpu, GpuColor);
            DrawSeries(g, plot, top, point => point.Cpu, CpuColor);

            using var cpuBrush = new SolidBrush(CpuColor);
            using var gpuBrush = new SolidBrush(GpuColor);
            g.DrawString("● CPU", Font, cpuBrush, plot.Right - 120, plot.Top);
            g.DrawString("● GPU", Font, gpuBrush, plot.Right - 60, plot.Top);
        }

        private void DrawSeries(Graphics g, Rectangle plot, double top, Func<(double Cpu, double Gpu), double> value, Color color)
        {
            if (points.Count < 2) return;
            var line = new PointF[points.Count];
            for (int index = 0; index < points.Count; index += 1)
            {
                float x = plot.Right - (points.Count - 1 - index) * plot.Width / (float)(HistoryLength - 1);
                float y = plot.Bottom - (float)(Math.Min(value(points[index]), top) / top * plot.Height);
                line[index] = new PointF(x, y);
            }
            using var pen = new Pen(color, 2f);
            g.DrawLines(pen, line);
        }
    }
}
