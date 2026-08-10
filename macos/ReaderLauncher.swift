import Cocoa
import Darwin
import Foundation
import WebKit

private let readerPort = Int(ProcessInfo.processInfo.environment["READER_LAUNCHER_PORT"] ?? "") ?? 8737
private let readerAppName = "Reader"
private let readinessTimeout: TimeInterval = 12
private let dockIconLightName = "ReaderDockIcon-Light"
private let dockIconDarkName = "ReaderDockIcon-Dark"

private enum ReaderProbe {
    case compatible
    case occupied
    case unreachable
}

private final class ReaderAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var serverProcess: Process?
    private var ownsServer = false
    private var isFinishing = false
    private var readinessStartedAt: Date?
    private var appearanceObservation: NSKeyValueObservation?

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureDockIconAppearance()
        makeWindow()
        probeAndOpen()
    }

    /// The Icon Composer asset remains the system-managed Finder and
    /// non-running-app icon. While Reader is running, AppKit lets the Dock
    /// tile follow the app's effective light or dark appearance independently
    /// of Tahoe's Icon & Widget Style setting.
    private func configureDockIconAppearance() {
        appearanceObservation = NSApp.observe(\.effectiveAppearance, options: [.initial, .new]) { [weak self] application, _ in
            DispatchQueue.main.async {
                self?.updateDockIcon(for: application.effectiveAppearance)
            }
        }
    }

    private func updateDockIcon(for appearance: NSAppearance) {
        let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let resourceName = isDark ? dockIconDarkName : dockIconLightName
        guard let image = Bundle.main.image(forResource: NSImage.Name(resourceName)) else {
            return
        }
        NSApp.applicationIconImage = image
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard ownsServer, let process = serverProcess, process.isRunning else {
            return .terminateNow
        }

        isFinishing = true
        process.terminate()

        // A Python HTTP server exits promptly on SIGTERM. Keep a bounded
        // fallback so quitting the app never hangs forever, while checking
        // the same Process object before sending a stronger signal.
        DispatchQueue.global(qos: .userInitiated).async { [weak self, weak process] in
            guard let self, let process else { return }
            let deadline = Date().addingTimeInterval(2.0)
            while process.isRunning && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.05)
            }
            if process.isRunning {
                _ = kill(process.processIdentifier, SIGKILL)
            }
            process.waitUntilExit()
            DispatchQueue.main.async {
                self.ownsServer = false
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    private func makeWindow() {
        let content = NSView(frame: .zero)
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isHidden = true
        content.addSubview(webView)

        statusLabel = NSTextField(labelWithString: "Starting Reader…")
        statusLabel.alignment = .center
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            statusLabel.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            statusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: content.leadingAnchor, constant: 32),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -32)
        ])

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered,
                          defer: false)
        window.title = readerAppName
        window.contentView = content
        window.delegate = self
        window.minSize = NSSize(width: 720, height: 480)
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    private func probeAndOpen() {
        statusLabel.stringValue = "Checking for an existing Reader server…"
        probeServer { [weak self] result in
            guard let self, !self.isFinishing else { return }
            switch result {
            case .compatible:
                self.statusLabel.stringValue = "Connecting to Reader…"
                self.loadReaderPage()
            case .occupied:
                self.showError("Port 8737 is in use by another app. Reader was not started.")
            case .unreachable:
                self.startOwnedServer()
            }
        }
    }

    private func startOwnedServer() {
        guard let resourceURL = Bundle.main.resourceURL else {
            showError("Reader’s bundled server resources are missing.")
            return
        }
        let script = resourceURL.appendingPathComponent("reader.py")
        guard FileManager.default.fileExists(atPath: script.path) else {
            showError("Reader’s bundled server script is missing.")
            return
        }

        statusLabel.stringValue = "Starting Reader’s local server…"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["python3", script.path, "--port", String(readerPort), "--no-browser"]
        process.currentDirectoryURL = resourceURL
        var environment = ProcessInfo.processInfo.environment
        let support = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Reader", isDirectory: true)
        environment["READER_DATA_DIR"] = support.path
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self, !self.isFinishing else { return }
                if self.serverProcess === process && process.terminationStatus != 0 {
                    self.showError("Reader’s local server stopped before it was ready.")
                }
            }
        }

        do {
            try process.run()
        } catch {
            showError("Reader could not start its local server.\n\n\(error.localizedDescription)")
            return
        }

        serverProcess = process
        ownsServer = true
        readinessStartedAt = Date()
        waitUntilReady()
    }

    private func waitUntilReady() {
        guard !isFinishing else { return }
        probeServer { [weak self] result in
            guard let self, !self.isFinishing else { return }
            switch result {
            case .compatible:
                self.loadReaderPage()
            case .occupied:
                self.stopOwnedServer()
                self.showError("A different service took port 8737 while Reader was starting.")
            case .unreachable:
                if let started = self.readinessStartedAt,
                   Date().timeIntervalSince(started) >= readinessTimeout {
                    self.stopOwnedServer()
                    self.showError("Reader did not become ready within 12 seconds.")
                } else if self.serverProcess?.isRunning == true {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self.waitUntilReady()
                    }
                } else {
                    self.showError("Reader’s local server exited before it was ready.")
                }
            }
        }
    }

    private func probeServer(completion: @escaping (ReaderProbe) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(readerPort)/api/ping") else {
            completion(.unreachable)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { data, response, error in
            let result: ReaderProbe
            if let data,
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               object["app"] as? String == readerAppName {
                result = .compatible
            } else if response != nil || (error as NSError?)?.code == NSURLErrorTimedOut {
                result = .occupied
            } else {
                result = .unreachable
            }
            DispatchQueue.main.async {
                completion(result)
            }
        }.resume()
    }

    private func loadReaderPage() {
        guard let token = readerToken(),
              let url = URL(string: "http://127.0.0.1:\(readerPort)/?t=\(token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token)") else {
            showError("Reader is running, but its local access token could not be found.")
            return
        }
        webView.load(URLRequest(url: url))
    }

    private func readerToken() -> String? {
        var locations: [URL] = []
        if let resources = Bundle.main.resourceURL {
            locations.append(resources)
            locations.append(resources.deletingLastPathComponent())
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        locations.append(home.appendingPathComponent("Library/Application Support/Reader"))
        locations.append(home)

        for directory in locations {
            for name in [".reader-token", ".mdview-token"] {
                let path = directory.appendingPathComponent(name)
                if let token = try? String(contentsOf: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
                   token.count >= 24 {
                    return token
                }
            }
        }
        return nil
    }

    private func stopOwnedServer() {
        guard ownsServer, let process = serverProcess, process.isRunning else { return }
        process.terminate()
        ownsServer = false
    }

    private func showError(_ message: String) {
        statusLabel.stringValue = message
        statusLabel.textColor = .systemRed
        statusLabel.maximumNumberOfLines = 4
        statusLabel.lineBreakMode = .byWordWrapping
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        statusLabel.isHidden = true
        webView.isHidden = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError("Reader’s page could not be loaded.\n\n\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError("Reader’s page could not be loaded.\n\n\(error.localizedDescription)")
    }
}

let application = NSApplication.shared
private let delegate = ReaderAppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.activate(ignoringOtherApps: true)
application.run()
