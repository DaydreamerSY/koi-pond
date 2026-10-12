import AppKit
import Darwin

/// CPU and memory of Koi Paper and the WebKit processes that run its web
/// views, counted the way Activity Monitor counts them.
final class ResourceSampler {
    struct Row {
        let pid: pid_t
        let name: String
        let cpu: Double
        let memory: UInt64
    }

    struct Sample {
        let rows: [Row]
        var cpu: Double { rows.reduce(0) { $0 + $1.cpu } }
        var memory: UInt64 { rows.reduce(0) { $0 + $1.memory } }
    }

    private typealias ResponsiblePID = @convention(c) (pid_t) -> pid_t

    private var last: [pid_t: (cpu: UInt64, time: UInt64)] = [:]
    private let timebase: mach_timebase_info_data_t = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return info
    }()
    /// WebKit's helper processes are launched by launchd, not by us, but macOS
    /// records which app they work for ("responsible process").
    private let responsiblePID: ResponsiblePID? = {
        guard let handle = dlopen(nil, RTLD_NOW),
              let symbol = dlsym(handle, "responsibility_get_pid_responsible_for_pid") else { return nil }
        return unsafeBitCast(symbol, to: ResponsiblePID.self)
    }()

    /// `knownWebProcesses` are WebContent PIDs the web views reported themselves,
    /// in case the responsible-process lookup isn't available.
    func take(knownWebProcesses: [pid_t]) -> Sample {
        let me = getpid()
        var pids = [me]
        for pid in webKitProcesses(of: me) + knownWebProcesses where !pids.contains(pid) {
            pids.append(pid)
        }

        let now = DispatchTime.now().uptimeNanoseconds
        var rows: [Row] = []
        for pid in pids {
            var info = rusage_info_v4()
            let result = withUnsafeMutablePointer(to: &info) {
                $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
                    proc_pid_rusage(pid, RUSAGE_INFO_V4, $0)
                }
            }
            guard result == 0 else { continue }
            // On Apple silicon these times are in Mach ticks, not nanoseconds.
            let cpuTime = (info.ri_user_time + info.ri_system_time) * UInt64(timebase.numer) / UInt64(max(timebase.denom, 1))
            var cpu = 0.0
            if let previous = last[pid], now > previous.time, cpuTime >= previous.cpu {
                cpu = Double(cpuTime - previous.cpu) / Double(now - previous.time) * 100
            }
            last[pid] = (cpuTime, now)
            rows.append(Row(pid: pid, name: name(of: pid, me: me), cpu: cpu, memory: info.ri_phys_footprint))
        }
        last = last.filter { pids.contains($0.key) }
        return Sample(rows: rows)
    }

    private func webKitProcesses(of owner: pid_t) -> [pid_t] {
        guard let responsiblePID else { return [] }
        let capacity = Int(proc_listallpids(nil, 0)) + 64
        guard capacity > 64 else { return [] }
        var pids = [pid_t](repeating: 0, count: capacity)
        let count = pids.withUnsafeMutableBufferPointer { buffer in
            proc_listallpids(buffer.baseAddress, Int32(buffer.count * MemoryLayout<pid_t>.size))
        }
        guard count > 0 else { return [] }
        return pids.prefix(min(Int(count), capacity)).filter { pid in
            pid > 0 && pid != owner && path(of: pid).contains("com.apple.WebKit") && responsiblePID(pid) == owner
        }
    }

    private func name(of pid: pid_t, me: pid_t) -> String {
        if pid == me { return "Koi Paper (app)" }
        let path = path(of: pid)
        if path.contains("WebContent") { return "WebKit · vẽ trang" }
        if path.contains("GPU") { return "WebKit · GPU" }
        if path.contains("Networking") { return "WebKit · mạng" }
        return (path as NSString).lastPathComponent
    }

    private func path(of pid: pid_t) -> String {
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        return length > 0 ? String(cString: buffer) : ""
    }
}

/// A small window that refreshes the numbers every second while it's open.
@MainActor
final class ResourceWindowController: NSObject, NSWindowDelegate {
    private let window: NSWindow
    // A non-wrapping label keeps the monospaced columns lined up.
    private let text = NSTextField(labelWithString: "")
    private let sampler = ResourceSampler()
    private let status: () -> String
    private let webProcesses: () -> [pid_t]
    private var timer: Timer?
    var onClose: (() -> Void)?

    init(status: @escaping () -> String, webProcesses: @escaping () -> [pid_t]) {
        self.status = status
        self.webProcesses = webProcesses
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 600, height: 380),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        super.init()

        window.title = "Koi Paper — Tài nguyên đang dùng"
        window.isReleasedWhenClosed = false
        window.delegate = self
        text.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        text.isSelectable = true
        text.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(text)
        NSLayoutConstraint.activate([
            text.topAnchor.constraint(equalTo: content.topAnchor, constant: 16),
            text.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            text.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -16),
        ])
        window.contentView = content
        window.center()
    }

    func show() {
        refresh()
        if timer == nil {
            timer = Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
        }
        AppDelegate.bringToFront(window)
    }

    func windowWillClose(_ notification: Notification) {
        timer?.invalidate()
        timer = nil
        onClose?()
    }

    @objc private func refresh() {
        let sample = sampler.take(knownWebProcesses: webProcesses())
        let cores = ProcessInfo.processInfo.activeProcessorCount
        var lines = [
            "Tổng CPU   \(format(sample.cpu)) %  của 1 nhân  (≈ \(format(sample.cpu / Double(cores))) % toàn máy, \(cores) nhân)",
            "Bộ nhớ     \(megabytes(sample.memory))  (\(sample.rows.count) tiến trình)",
            status(),
            "",
            "Tiến trình".padding(toLength: 26, withPad: " ", startingAt: 0) + "PID".leftPadded(8) + "CPU %".leftPadded(9) + "Bộ nhớ".leftPadded(11),
        ]
        for row in sample.rows.sorted(by: { $0.cpu > $1.cpu }) {
            lines.append(
                row.name.padding(toLength: 26, withPad: " ", startingAt: 0)
                    + String(row.pid).leftPadded(8)
                    + format(row.cpu).leftPadded(9)
                    + megabytes(row.memory).leftPadded(11))
        }
        lines += [
            "",
            "CPU tính như cột \"% CPU\" của Activity Monitor (100 % = một nhân).",
            "Bộ nhớ là \"memory footprint\", như cột \"Memory\" của Activity Monitor.",
            "GPU: macOS không cho app tự đo; xem Activity Monitor › Window › GPU History.",
            "Chỉ đo khi cửa sổ này đang mở.",
        ]
        text.stringValue = lines.joined(separator: "\n")
    }

    private func format(_ value: Double) -> String {
        String(format: "%.1f", value)
    }

    private func megabytes(_ bytes: UInt64) -> String {
        "\(bytes / 1_048_576) MB"
    }
}

private extension String {
    func leftPadded(_ width: Int) -> String {
        count >= width ? self : String(repeating: " ", count: width - count) + self
    }
}
