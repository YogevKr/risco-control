import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Start the server
        let binary = Bundle.main.executableURL!.deletingLastPathComponent().appendingPathComponent("risco-control")
        serverProcess = Process()
        serverProcess.executableURL = binary
        serverProcess.environment = ProcessInfo.processInfo.environment
        serverProcess.standardOutput = FileHandle.nullDevice
        serverProcess.standardError = FileHandle.nullDevice
        try? serverProcess.run()

        // Create window
        let screenSize = NSScreen.main?.frame.size ?? NSSize(width: 1200, height: 800)
        let windowWidth: CGFloat = min(1300, screenSize.width * 0.85)
        let windowHeight: CGFloat = min(900, screenSize.height * 0.85)
        let windowRect = NSRect(
            x: (screenSize.width - windowWidth) / 2,
            y: (screenSize.height - windowHeight) / 2,
            width: windowWidth,
            height: windowHeight
        )

        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Risco Control Panel"
        window.minSize = NSSize(width: 800, height: 500)
        window.isReleasedWhenClosed = false

        // Create WebView
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground") // transparent while loading
        window.contentView?.addSubview(webView)
        window.backgroundColor = NSColor(red: 0.04, green: 0.055, blue: 0.1, alpha: 1.0) // match UI bg

        window.makeKeyAndOrderFront(nil)

        // Wait for server, then load
        pollServer()
    }

    func pollServer(attempt: Int = 0) {
        let url = URL(string: "http://localhost:3580")!
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                DispatchQueue.main.async {
                    self?.webView.load(URLRequest(url: url))
                }
            } else if attempt < 60 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self?.pollServer(attempt: attempt + 1)
                }
            }
        }
        task.resume()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverProcess?.terminate()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
