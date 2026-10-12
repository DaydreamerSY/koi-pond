import AppKit
import WebKit

/// Builds the web views that show the pond. The built pond (web/dist) is bundled
/// as Resources/wwwroot and served at koipaper://app/, one origin shared by the
/// wallpapers and the settings window so they share localStorage.
@MainActor
enum PondWeb {
    static let scheme = "koipaper"

    static var root: URL {
        Bundle.main.resourceURL!.appendingPathComponent("wwwroot", isDirectory: true)
    }

    static func url(wallpaper: Bool) -> URL {
        URL(string: "\(scheme)://app/index.html\(wallpaper ? "?wallpaper" : "")")!
    }

    private static let schemeHandler = PondSchemeHandler(root: root)
    private static let navigator = PondNavigator()

    /// The pond's web code talks to `window.chrome.webview` (WebView2's API, used on
    /// Windows). This shim gives WKWebView the same shape, so web/ stays shared.
    private static let bridgeShim = """
    (() => {
      const listeners = new Set();
      window.chrome = window.chrome || {};
      window.chrome.webview = {
        postMessage: (message) => window.webkit.messageHandlers.koipaper.postMessage(message),
        addEventListener: (type, listener) => { if (type === "message") listeners.add(listener); },
        removeEventListener: (type, listener) => { listeners.delete(listener); },
      };
      window.__koipaperDeliver = (data) => { for (const listener of listeners) listener({ data }); };
    })();
    """

    static func makeWebView(wallpaper: Bool, onMessage: @escaping ([String: Any]) -> Void) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: scheme)
        configuration.websiteDataStore = .default()
        // The river ambience starts from the menu, not from a click on the page.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.suppressesIncrementalRendering = true

        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: bridgeShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(ScriptMessageForwarder(onMessage), name: "koipaper")
        configuration.userContentController = content

        let webView = WKWebView(frame: .zero, configuration: configuration)
        // Dark (the window's color) until the pond's first frame, not a white flash.
        // A long-standing but private WebKit switch: only flip it while it exists.
        if webView.responds(to: NSSelectorFromString("setDrawsBackground:")) {
            webView.setValue(false, forKey: "drawsBackground")
        }
        webView.navigationDelegate = navigator
        webView.uiDelegate = navigator
        if #available(macOS 13.3, *) {
            // Safari › Develop can inspect the settings window when something looks off.
            webView.isInspectable = !wallpaper
        }
        return webView
    }

    /// Sends a message to the page (it arrives like a WebView2 web message).
    static func post(_ message: [String: Any], to webView: WKWebView) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__koipaperDeliver && window.__koipaperDeliver(\(json))", completionHandler: nil)
    }
}

/// Serves files from wwwroot for koipaper:// requests.
final class PondSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!)
            urlSchemeTask.didFinish()
            return
        }
        let headers = [
            "Content-Type": Self.mimeType(of: file.pathExtension),
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        urlSchemeTask.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func mimeType(of pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "m4a", "mp4": return "audio/mp4"
        case "txt": return "text/plain; charset=utf-8"
        case "xml": return "application/xml"
        default: return "application/octet-stream"
        }
    }
}

/// Opens links (GitHub, the upstream project) in the default browser, and
/// reloads a page whose web process crashed.
final class PondNavigator: NSObject, WKNavigationDelegate, WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

/// Hands script messages to a closure; WKUserContentController retains this
/// object, not the window that owns the closure.
final class ScriptMessageForwarder: NSObject, WKScriptMessageHandler {
    private let onMessage: ([String: Any]) -> Void

    init(_ onMessage: @escaping ([String: Any]) -> Void) {
        self.onMessage = onMessage
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any] { onMessage(body) }
    }
}
