import Cocoa
import CryptoKit
import Darwin
import Foundation
import Security
import WebKit

private let readerPort = Int(ProcessInfo.processInfo.environment["READER_LAUNCHER_PORT"] ?? "") ?? 8737
private let readerAppName = "Reader"
private let readinessTimeout: TimeInterval = 12
private let dockIconLightName = "ReaderDockIcon-Light"
private let dockIconDarkName = "ReaderDockIcon-Dark"

/* The release feed. Reader asks GitHub for the latest release and reads the
   `manifest.json` asset attached to it, rather than trusting the release body
   or the asset list's own ordering. READER_UPDATE_FEED replaces the whole
   two-step lookup with a direct URL to a manifest, which is how the flow is
   exercised against a local server without publishing anything. */
private let readerReleaseFeed = "https://api.github.com/repos/anilkrc13/Reader/releases/latest"
private let readerReleasePage = "https://github.com/anilkrc13/Reader/releases"
private let readerReleasingDoc = "https://github.com/anilkrc13/Reader/blob/main/docs/releasing.md"
private let updateCheckInterval: TimeInterval = 24 * 60 * 60
/* Late enough that a check never competes with starting the server or loading
   the page: startup is the one moment Reader is asked to be quick. */
private let updateCheckDelay: TimeInterval = 20
private let lastUpdateCheckKey = "ReaderLastUpdateCheck"
private let skippedVersionKey = "ReaderSkippedUpdateVersion"
private let previousBundleSuffix = ".previous"

private enum ReaderProbe {
    case compatible
    case occupied
    case unreachable
}

/* What the release manifest promises. Only these fields are read; a manifest
   carrying more (published_at, signing_identity) is still valid. */
private struct UpdateManifest {
    let version: String
    let url: URL
    let sha256: String
    let size: Int
    let minimumMacOS: String
    let releasePage: URL
}

/* Every reason a check can end without an update. None of them are worth
   interrupting someone who did not ask, so they are only ever shown for a
   check started from the menu. */
private enum UpdateProblem: Error {
    case unreachable
    case malformed
    case tooOld(String)
}

/* Everything that can go wrong once an update is being installed. These are
   always shown: the person asked for this, and a half-applied update is
   exactly the thing they need to hear about. */
private enum InstallProblem: Error {
    case download(String)
    case sizeMismatch(expected: Int, actual: Int)
    case digestMismatch
    case extraction(String)
    case notOneApp
    case unreadableSignature
    case invalidSignature
    case identityMismatch
    case replace(String)
}

private final class ReaderAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var serverProcess: Process?
    private var ownsServer = false
    private var isFinishing = false
    private var readinessStartedAt: Date?
    private var appearanceObservation: NSKeyValueObservation?
    /* A document handed to us by Finder or `open`. AppKit can deliver it
       before the server is up and before the page has loaded, so it is held
       here until there is somewhere to send it. */
    private var pendingOpenPath: String?
    private var isPageLoaded = false
    private var isChoosingFolder = false
    /* One update at a time. A second check while a download is running would
       race the first one onto the same bundle path. */
    private var isUpdating = false
    private var updateProgressSheet: NSWindow?
    private var updateProgressBar: NSProgressIndicator?
    private var updateProgressLabel: NSTextField?
    private var updateProgressObservation: NSKeyValueObservation?
    /* Ephemeral, so nothing about this Mac is cached or sent back on the next
       request, and with exactly the two headers GitHub needs. */
    private lazy var updateSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpAdditionalHeaders = [
            "Accept": "application/vnd.github+json",
            "User-Agent": "\(readerAppName)/\(ReaderAppDelegate.currentVersion())"
        ]
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }()

    /* Window and menus are built in `will` rather than `did` so that an
       open-document request, which AppKit sends between the two, always finds
       a live window to attach itself to. */
    func applicationWillFinishLaunching(_ notification: Notification) {
        configureMainMenu()
        configureDockIconAppearance()
        makeWindow()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        probeAndOpen()
        discardPreviousBundle()
        scheduleUpdateCheck()
    }

    /* Info.plist declares the document types Reader renders; this is the other
       half of that contract. Without it macOS would launch Reader and then
       silently drop the file the user double-clicked. */
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let path = urls.first(where: { $0.isFileURL })?.standardizedFileURL.path else { return }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        if isPageLoaded {
            deliver(path: path)
        } else {
            pendingOpenPath = path
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window?.makeKeyAndOrderFront(nil)
        }
        return true
    }

    /// Ask the already-loaded page to open a document. The path is passed as a
    /// JSON-encoded literal so no filename can escape into the script itself.
    /// A reused server has no trusted launcher-to-server grant channel, so its
    /// backend reports an out-of-workspace file as read-only. When this launcher
    /// starts the server itself, the startup path is an initial server grant.
    private func deliver(path: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [path], options: []),
              let array = String(data: data, encoding: .utf8) else { return }
        let script = "window.reader && window.reader.openFromOS ? "
            + "(window.reader.openFromOS(\(array)[0]), true) : false"
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            // app.js publishes `window.reader` as the page finishes booting;
            // one bounded retry covers the case where we win that race.
            if (result as? Bool) != true {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    guard let self, self.isPageLoaded else { return }
                    self.webView.evaluateJavaScript(
                        "window.reader && window.reader.openFromOS && "
                        + "window.reader.openFromOS(\(array)[0])", completionHandler: nil)
                }
            }
        }
    }

    /* WKWebView's text system routes the standard editing commands through
       the AppKit responder chain. The native launcher previously installed no
       Edit menu at all, so the Reader window had no Copy/Paste key equivalents
       for that chain even though the page's textarea had a valid selection.
       Leave the menu items untargeted so AppKit forwards them to whichever
       first responder owns the selection. */
    private func configureMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: readerAppName)
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)
        appMenu.addItem(NSMenuItem(title: "About \(readerAppName)",
                                   action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                                   keyEquivalent: ""))
        let updateItem = NSMenuItem(title: "Check for Updates…",
                                    action: #selector(checkForUpdatesFromMenu(_:)),
                                    keyEquivalent: "")
        // Targeted rather than left to the responder chain: this one is ours,
        // not a command whichever view holds the selection should answer.
        updateItem.target = self
        appMenu.addItem(updateItem)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Quit \(readerAppName)",
                                   action: #selector(NSApplication.terminate(_:)),
                                   keyEquivalent: "q"))

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        func addEditCommand(_ title: String, _ selector: String, _ key: String) {
            let item = NSMenuItem(title: title,
                                  action: Selector((selector)),
                                  keyEquivalent: key)
            item.keyEquivalentModifierMask = .command
            editMenu.addItem(item)
        }

        addEditCommand("Undo", "undo:", "z")
        addEditCommand("Redo", "redo:", "Z")
        editMenu.addItem(.separator())
        addEditCommand("Cut", "cut:", "x")
        addEditCommand("Copy", "copy:", "c")
        addEditCommand("Paste", "paste:", "v")
        addEditCommand("Select All", "selectAll:", "a")

        NSApp.mainMenu = mainMenu
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
        guard ownsServer, serverProcess?.isRunning == true else {
            return .terminateNow
        }
        stopOwnedServerAndWait {
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    /// Stop the server this launcher started and call back on the main queue
    /// once it is gone. Quitting and installing an update both need exactly
    /// this, and an update that left a server holding port 8737 would leave the
    /// relaunched app talking to the version it just replaced.
    private func stopOwnedServerAndWait(_ completion: @escaping () -> Void) {
        guard ownsServer, let process = serverProcess, process.isRunning else {
            completion()
            return
        }

        isFinishing = true
        process.terminate()

        // A Python HTTP server exits promptly on SIGTERM. Keep a bounded
        // fallback so quitting the app never hangs forever, while checking
        // the same Process object before sending a stronger signal.
        DispatchQueue.global(qos: .userInitiated).async { [weak self, weak process] in
            if let process {
                let deadline = Date().addingTimeInterval(2.0)
                while process.isRunning && Date() < deadline {
                    Thread.sleep(forTimeInterval: 0.05)
                }
                if process.isRunning {
                    _ = kill(process.processIdentifier, SIGKILL)
                }
                process.waitUntilExit()
            }
            DispatchQueue.main.async {
                self?.ownsServer = false
                completion()
            }
        }
    }

    private func makeWindow() {
        let content = NSView(frame: .zero)
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        /* The page asks for native things through this one channel. It is the
           only route from the page into the app; everything else is one-way. */
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(
            self, contentWorld: .page, name: "reader")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        /* Without a UI delegate, WebKit answers a target="_blank" link by
           silently dropping it -- which is why a link to a Google Doc did
           nothing at all in the app while working in a browser. */
        webView.uiDelegate = self
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
        var arguments = ["python3", script.path, "--port", String(readerPort), "--no-browser"]
        // Handing the document to the server it is about to start makes that
        // file's folder part of the save workspace, so a document opened from
        // Finder outside the home folder stays editable.
        if let path = pendingOpenPath {
            arguments.append(path)
            // The server now reports it as the start document, so there is no
            // second delivery to make once the page loads.
            pendingOpenPath = nil
        }
        process.arguments = arguments
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

    // -- staying up to date --------------------------------------------------

    /* The only network request Reader makes. Once a day the launcher asks
       GitHub whether a newer release exists; if the answer is yes and this copy
       of Reader lives somewhere it may rewrite itself, it downloads, verifies
       and installs that release.

       Nothing in the manifest is trusted on its own. It names a size and a
       digest, which are checked before the archive is opened, and the bundle
       that comes out of the archive still has to satisfy the designated
       requirement of the running app before it is allowed anywhere near the
       Applications folder. That last check is what makes this safe: it is the
       same test macOS uses to decide two builds are the same app, so only a
       build signed with the identity this one was signed with can replace it. */

    private static func currentVersion() -> String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
    }

    /// A semantic version as integers. A pre-release or build suffix returns
    /// nil, which is how "pre-releases are never newer" is expressed: the
    /// comparison below refuses anything it cannot read as plain numbers.
    private static func versionNumbers(_ raw: String) -> [Int]? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let core = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
        guard !core.isEmpty, !core.contains("-"), !core.contains("+") else { return nil }
        var numbers: [Int] = []
        for part in core.split(separator: ".", omittingEmptySubsequences: false) {
            guard let value = Int(part), value >= 0 else { return nil }
            numbers.append(value)
        }
        // Compare 2.1 and 2.1.0 as the same version.
        while numbers.count < 3 { numbers.append(0) }
        return numbers.count >= 3 ? numbers : nil
    }

    private static func isNewer(_ candidate: String, than current: String) -> Bool {
        guard let new = versionNumbers(candidate) else { return false }
        /* The running version may itself carry a suffix, from a build made
           between releases. Read its numbers anyway, so such a build is offered
           the release it is a preview of only when that release is higher. */
        let currentCore = current.split(separator: "-").first.map(String.init) ?? current
        guard let old = versionNumbers(currentCore) else { return true }
        for index in 0..<max(new.count, old.count) {
            let a = index < new.count ? new[index] : 0
            let b = index < old.count ? old[index] : 0
            if a != b { return a > b }
        }
        return false
    }

    // -- preferences ---------------------------------------------------------

    /* The same file the page writes, read directly. The launcher has no
       authenticated route into the server, and the update preference is a
       property of this Mac's copy of Reader rather than of a document, so the
       file is the honest place to read it from. */
    private func preferencesFile() -> URL {
        let environment = ProcessInfo.processInfo.environment["READER_DATA_DIR"]
        let directory: URL
        if let environment, !environment.isEmpty {
            directory = URL(fileURLWithPath: (environment as NSString).expandingTildeInPath,
                            isDirectory: true)
        } else {
            directory = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/Reader", isDirectory: true)
        }
        return directory.appendingPathComponent("preferences.json")
    }

    private func readPreferences() -> [String: Any] {
        guard let data = try? Data(contentsOf: preferencesFile()),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return object
    }

    private func updateChecksAllowed() -> Bool {
        // Absent means on. A fresh install has no preferences file at all.
        (readPreferences()["updates.check"] as? Bool) ?? true
    }

    /* The skipped version is the launcher's own state, kept in UserDefaults
       beside the last-check time rather than in preferences.json. The page
       holds that file's whole document in memory and writes all of it back on
       every change, so a key the launcher added would be silently undone the
       next time the reader touched any setting. */
    private func skippedVersion() -> String? {
        UserDefaults.standard.string(forKey: skippedVersionKey)
    }

    private func rememberSkipped(version: String) {
        UserDefaults.standard.set(version, forKey: skippedVersionKey)
    }

    // -- the check -----------------------------------------------------------

    @objc private func checkForUpdatesFromMenu(_ sender: Any?) {
        checkForUpdates(userInitiated: true)
    }

    private func scheduleUpdateCheck() {
        DispatchQueue.main.asyncAfter(deadline: .now() + updateCheckDelay) { [weak self] in
            guard let self, !self.isFinishing, self.updateChecksAllowed() else { return }
            let defaults = UserDefaults.standard
            if let last = defaults.object(forKey: lastUpdateCheckKey) as? Date {
                // `last` in the future means the clock moved, not that we
                // checked; that must not silence the check for a year.
                let elapsed = Date().timeIntervalSince(last)
                if elapsed >= 0 && elapsed < updateCheckInterval { return }
            }
            self.checkForUpdates(userInitiated: false)
        }
    }

    private func checkForUpdates(userInitiated: Bool) {
        guard !isUpdating else {
            if userInitiated {
                showUpdateAlert(title: "Reader is already checking for updates.", body: nil)
            }
            return
        }
        isUpdating = true
        UserDefaults.standard.set(Date(), forKey: lastUpdateCheckKey)
        if userInitiated {
            showUpdateProgress("Checking for updates…", determinate: false)
        }
        fetchManifest { [weak self] result in
            guard let self else { return }
            self.endUpdateProgress()
            switch result {
            case .failure(let problem):
                self.isUpdating = false
                guard userInitiated else { return }
                self.showUpdateAlert(title: "Reader could not check for updates.",
                                     body: self.describe(problem))
            case .success(let manifest):
                self.consider(manifest, userInitiated: userInitiated)
            }
        }
    }

    private func describe(_ problem: UpdateProblem) -> String {
        switch problem {
        case .unreachable:
            return "GitHub could not be reached. Reader will try again tomorrow."
        case .malformed:
            return "The release information could not be read."
        case .tooOld(let minimum):
            return "The newest release needs macOS \(minimum) or later."
        }
    }

    private func consider(_ manifest: UpdateManifest, userInitiated: Bool) {
        let current = ReaderAppDelegate.currentVersion()
        guard ReaderAppDelegate.isNewer(manifest.version, than: current) else {
            isUpdating = false
            if userInitiated {
                showUpdateAlert(title: "You’re up to date.",
                                body: "Reader \(current) is the newest release.")
            }
            return
        }
        if let minimum = ReaderAppDelegate.versionNumbers(manifest.minimumMacOS), minimum.count >= 3 {
            let required = OperatingSystemVersion(majorVersion: minimum[0],
                                                  minorVersion: minimum[1],
                                                  patchVersion: minimum[2])
            guard ProcessInfo.processInfo.isOperatingSystemAtLeast(required) else {
                isUpdating = false
                if userInitiated {
                    showUpdateAlert(title: "Reader \(manifest.version) needs a newer macOS.",
                                    body: self.describe(.tooOld(manifest.minimumMacOS)))
                }
                return
            }
        }
        // A skipped version stays skipped until it is asked for by name.
        if !userInitiated, skippedVersion() == manifest.version {
            isUpdating = false
            return
        }
        guard canReplaceOwnBundle() else {
            isUpdating = false
            offerReleasePage(manifest)
            return
        }
        download(manifest)
    }

    // -- where Reader is allowed to replace itself ---------------------------

    /* Only a copy that lives in an Applications folder updates itself. A bundle
       inside a git checkout is somebody's build output, and quietly replacing
       it with a release would throw away the thing they were testing; a bundle
       on a read-only volume or a disk image cannot be replaced at all. */
    private func canReplaceOwnBundle() -> Bool {
        let bundle = Bundle.main.bundleURL.resolvingSymlinksInPath()
        let parent = bundle.deletingLastPathComponent()
        let home = FileManager.default.homeDirectoryForCurrentUser
        let allowed = [URL(fileURLWithPath: "/Applications", isDirectory: true),
                       home.appendingPathComponent("Applications", isDirectory: true)]
        let inApplications = allowed.contains {
            $0.resolvingSymlinksInPath().path == parent.path
        }
        guard inApplications else { return false }
        let manager = FileManager.default
        // Both: the bundle is moved aside, and the new one is moved in beside it.
        return manager.isWritableFile(atPath: bundle.path)
            && manager.isWritableFile(atPath: parent.path)
    }

    private func offerReleasePage(_ manifest: UpdateManifest) {
        let bundle = Bundle.main.bundleURL.resolvingSymlinksInPath()
        let alert = NSAlert()
        alert.messageText = "Reader \(manifest.version) is available."
        alert.informativeText = "This copy of Reader runs from \(bundle.deletingLastPathComponent().path), "
            + "so it does not install updates itself. Reader only replaces itself when it is in "
            + "your Applications folder and writable. Open the release page to download it, or move "
            + "Reader to Applications and check again."
        alert.addButton(withTitle: "View Release")
        alert.addButton(withTitle: "Later")
        alert.addButton(withTitle: "Skip This Version")
        runAlert(alert) { [weak self] response in
            guard let self else { return }
            switch response {
            case .alertFirstButtonReturn:
                self.handOff(manifest.releasePage)
            case .alertThirdButtonReturn:
                self.rememberSkipped(version: manifest.version)
            default:
                break
            }
        }
    }

    // -- fetching the manifest -----------------------------------------------

    private func fetchManifest(completion: @escaping (Result<UpdateManifest, UpdateProblem>) -> Void) {
        let finish: (Result<UpdateManifest, UpdateProblem>) -> Void = { result in
            DispatchQueue.main.async { completion(result) }
        }
        if let override = ProcessInfo.processInfo.environment["READER_UPDATE_FEED"],
           !override.isEmpty {
            guard let url = URL(string: override) else {
                finish(.failure(.malformed))
                return
            }
            fetchJSON(url) { result in
                switch result {
                case .failure(let problem):
                    finish(.failure(problem))
                case .success(let object):
                    guard let manifest = ReaderAppDelegate.manifest(from: object, releasePage: nil) else {
                        finish(.failure(.malformed))
                        return
                    }
                    finish(.success(manifest))
                }
            }
            return
        }
        guard let feed = URL(string: readerReleaseFeed) else {
            finish(.failure(.malformed))
            return
        }
        fetchJSON(feed) { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let problem):
                finish(.failure(problem))
            case .success(let release):
                let assets = release["assets"] as? [[String: Any]] ?? []
                guard let asset = assets.first(where: { $0["name"] as? String == "manifest.json" }),
                      let href = asset["browser_download_url"] as? String,
                      let url = URL(string: href) else {
                    finish(.failure(.malformed))
                    return
                }
                let page = (release["html_url"] as? String).flatMap(URL.init(string:))
                self.fetchJSON(url) { manifestResult in
                    switch manifestResult {
                    case .failure(let problem):
                        finish(.failure(problem))
                    case .success(let object):
                        guard let manifest = ReaderAppDelegate.manifest(from: object, releasePage: page) else {
                            finish(.failure(.malformed))
                            return
                        }
                        finish(.success(manifest))
                    }
                }
            }
        }
    }

    private func fetchJSON(_ url: URL, completion: @escaping (Result<[String: Any], UpdateProblem>) -> Void) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalCacheData
        updateSession.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            // A 404 is the ordinary answer for a repository with no release
            // yet, and reads the same as being offline: there is no update.
            guard status == 200, let data else {
                completion(.failure(.unreachable))
                return
            }
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(.failure(.malformed))
                return
            }
            completion(.success(object))
        }.resume()
    }

    private static func manifest(from object: [String: Any], releasePage: URL?) -> UpdateManifest? {
        guard let version = object["version"] as? String,
              let href = object["url"] as? String,
              let url = URL(string: href),
              let sha256 = object["sha256"] as? String,
              let size = object["size"] as? Int,
              size > 0 else { return nil }
        let digest = sha256.lowercased()
        // 32 bytes, hex. A manifest that cannot name a digest is not a manifest.
        guard digest.count == 64,
              digest.allSatisfy({ $0.isHexDigit }) else { return nil }
        let minimum = object["minimum_macos"] as? String ?? ""
        let page = releasePage
            ?? URL(string: "\(readerReleasePage)/tag/v\(version)")
            ?? URL(string: readerReleasePage)!
        return UpdateManifest(version: version, url: url, sha256: digest,
                              size: size, minimumMacOS: minimum, releasePage: page)
    }

    // -- downloading and verifying -------------------------------------------

    private func download(_ manifest: UpdateManifest) {
        showUpdateProgress("Downloading Reader \(manifest.version)…", determinate: true)
        let task = updateSession.downloadTask(with: manifest.url) { [weak self] location, response, error in
            guard let self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let location, status == 200 else {
                let reason = error?.localizedDescription ?? "The download did not complete (HTTP \(status))."
                DispatchQueue.main.async { self.installFailed(.download(reason), manifest: manifest) }
                return
            }
            /* URLSession deletes its temporary file the moment this closure
               returns, so the archive is moved somewhere Reader owns first. */
            let staging: URL
            do {
                staging = try self.makeStagingDirectory()
                try FileManager.default.moveItem(at: location,
                                                 to: staging.appendingPathComponent("Reader.zip"))
            } catch {
                DispatchQueue.main.async {
                    self.installFailed(.download(error.localizedDescription), manifest: manifest)
                }
                return
            }
            DispatchQueue.global(qos: .userInitiated).async {
                self.verifyAndStage(staging: staging, manifest: manifest)
            }
        }
        updateProgressObservation = task.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
            DispatchQueue.main.async {
                self?.updateProgressBar?.doubleValue = progress.fractionCompleted
            }
        }
        task.resume()
    }

    private func makeStagingDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ReaderUpdate-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Off the main queue: size, digest, unpack, signature. Nothing is unpacked
    /// before the bytes are known to be the bytes the manifest named.
    private func verifyAndStage(staging: URL, manifest: UpdateManifest) {
        let archive = staging.appendingPathComponent("Reader.zip")
        DispatchQueue.main.async {
            self.showUpdateProgress("Verifying Reader \(manifest.version)…", determinate: false)
        }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: archive.path)
            let actual = (attributes[.size] as? NSNumber)?.intValue ?? -1
            guard actual == manifest.size else {
                throw InstallProblem.sizeMismatch(expected: manifest.size, actual: actual)
            }
            guard try ReaderAppDelegate.sha256(of: archive) == manifest.sha256 else {
                throw InstallProblem.digestMismatch
            }

            let unpacked = staging.appendingPathComponent("unpacked", isDirectory: true)
            try FileManager.default.createDirectory(at: unpacked, withIntermediateDirectories: true)
            try ReaderAppDelegate.ditto(extract: archive, into: unpacked)

            let apps = (try FileManager.default.contentsOfDirectory(at: unpacked,
                                                                    includingPropertiesForKeys: nil))
                .filter { $0.pathExtension == "app" }
            guard apps.count == 1, let newApp = apps.first else { throw InstallProblem.notOneApp }

            try ReaderAppDelegate.verifySignature(of: newApp)
            DispatchQueue.main.async {
                self.endUpdateProgress()
                self.confirmInstall(of: newApp, staging: staging, manifest: manifest)
            }
        } catch let problem as InstallProblem {
            try? FileManager.default.removeItem(at: staging)
            DispatchQueue.main.async { self.installFailed(problem, manifest: manifest) }
        } catch {
            try? FileManager.default.removeItem(at: staging)
            DispatchQueue.main.async {
                self.installFailed(.extraction(error.localizedDescription), manifest: manifest)
            }
        }
    }

    /// Streamed, because the archive is tens of megabytes and there is no
    /// reason to hold all of it in memory to hash it.
    private static func sha256(of file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// ditto rather than a zip library: the archives are made with `ditto -c -k
    /// --keepParent`, and only ditto restores the resource forks, symlinks and
    /// permissions a signed bundle is made of.
    private static func ditto(extract archive: URL, into directory: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["-x", "-k", archive.path, directory.path]
        let errors = Pipe()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errors
        try process.run()
        let text = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw InstallProblem.extraction(text.isEmpty ? "ditto exited \(process.terminationStatus)" : text)
        }
    }

    /* The check that stands between a manifest and this Mac's Applications
       folder. First the bundle has to be internally consistent and completely
       signed, nested code included. Then it has to satisfy the running app's
       own designated requirement, which for a certificate-signed build names
       the certificate: only another build signed with the same identity passes.
       An ad-hoc signature's requirement is a hash of the running bundle's own
       bytes, so no other build can ever match it and the update is refused,
       which is the correct answer -- an ad-hoc build has nothing to say about
       who wrote the update. */
    private static func verifySignature(of app: URL) throws {
        var candidate: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &candidate) == errSecSuccess,
              let candidate else {
            throw InstallProblem.unreadableSignature
        }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures
                                | kSecCSStrictValidate
                                | kSecCSCheckNestedCode)
        guard SecStaticCodeCheckValidity(candidate, flags, nil) == errSecSuccess else {
            throw InstallProblem.invalidSignature
        }

        var running: SecCode?
        var runningStatic: SecStaticCode?
        var requirement: SecRequirement?
        guard SecCodeCopySelf([], &running) == errSecSuccess, let running,
              SecCodeCopyStaticCode(running, [], &runningStatic) == errSecSuccess,
              let runningStatic,
              SecCodeCopyDesignatedRequirement(runningStatic, [], &requirement) == errSecSuccess,
              let requirement else {
            throw InstallProblem.unreadableSignature
        }
        guard SecStaticCodeCheckValidity(candidate, flags, requirement) == errSecSuccess else {
            throw InstallProblem.identityMismatch
        }
    }

    // -- installing ----------------------------------------------------------

    private func confirmInstall(of newApp: URL, staging: URL, manifest: UpdateManifest) {
        let alert = NSAlert()
        alert.messageText = "Reader \(manifest.version) is available."
        alert.informativeText = "It has been downloaded and its signature checked. "
            + "Installing it closes this window, replaces Reader in your Applications folder "
            + "and opens the new version."
        alert.addButton(withTitle: "Install and Relaunch")
        alert.addButton(withTitle: "Later")
        alert.addButton(withTitle: "Skip This Version")
        runAlert(alert) { [weak self] response in
            guard let self else { return }
            switch response {
            case .alertFirstButtonReturn:
                self.install(newApp, staging: staging, manifest: manifest)
            case .alertThirdButtonReturn:
                self.rememberSkipped(version: manifest.version)
                try? FileManager.default.removeItem(at: staging)
                self.isUpdating = false
            default:
                try? FileManager.default.removeItem(at: staging)
                self.isUpdating = false
            }
        }
    }

    private func install(_ newApp: URL, staging: URL, manifest: UpdateManifest) {
        let current = Bundle.main.bundleURL.resolvingSymlinksInPath()
        let previous = current.deletingLastPathComponent()
            .appendingPathComponent(current.lastPathComponent + previousBundleSuffix)
        showUpdateProgress("Installing Reader \(manifest.version)…", determinate: false)
        // The server has to go first. It holds port 8737, and the relaunched
        // app would otherwise adopt a server running the code being replaced.
        stopOwnedServerAndWait { [weak self] in
            guard let self else { return }
            let manager = FileManager.default
            do {
                if manager.fileExists(atPath: previous.path) {
                    try manager.removeItem(at: previous)
                }
                try manager.moveItem(at: current, to: previous)
            } catch {
                self.endUpdateProgress()
                self.installFailed(.replace(error.localizedDescription), manifest: manifest)
                return
            }
            do {
                try manager.moveItem(at: newApp, to: current)
            } catch {
                // Put the running app back before saying anything: Reader is
                // still running out of it, and a missing bundle would mean the
                // next launch had nothing to launch.
                try? manager.moveItem(at: previous, to: current)
                self.endUpdateProgress()
                self.installFailed(.replace(error.localizedDescription), manifest: manifest)
                return
            }
            try? manager.removeItem(at: staging)
            self.relaunch(from: current)
        }
    }

    private func relaunch(from bundle: URL) {
        let open = Process()
        open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        // -n so the new copy starts rather than this one being reactivated.
        open.arguments = ["-n", bundle.path]
        try? open.run()
        endUpdateProgress()
        NSApp.terminate(nil)
    }

    /// The bundle moved aside by the last update, cleared once the version that
    /// replaced it has proved it can launch.
    private func discardPreviousBundle() {
        let current = Bundle.main.bundleURL.resolvingSymlinksInPath()
        let previous = current.deletingLastPathComponent()
            .appendingPathComponent(current.lastPathComponent + previousBundleSuffix)
        DispatchQueue.global(qos: .background).async {
            guard FileManager.default.fileExists(atPath: previous.path) else { return }
            try? FileManager.default.removeItem(at: previous)
        }
    }

    private func installFailed(_ problem: InstallProblem, manifest: UpdateManifest) {
        isUpdating = false
        endUpdateProgress()
        let body: String
        switch problem {
        case .download(let reason):
            body = "The download did not finish.\n\n\(reason)"
        case .sizeMismatch(let expected, let actual):
            body = "The download is \(actual) bytes but the release says \(expected). "
                + "Nothing was installed."
        case .digestMismatch:
            body = "The download does not match the checksum in the release. "
                + "Nothing was opened or installed."
        case .extraction(let reason):
            body = "The download could not be unpacked.\n\n\(reason)"
        case .notOneApp:
            body = "The download does not contain exactly one application."
        case .unreadableSignature:
            body = "The signature of the downloaded app could not be read."
        case .invalidSignature:
            body = "The downloaded app is not correctly signed."
        case .identityMismatch:
            body = "The downloaded app is signed by a different identity than this copy of Reader, "
                + "so installing it would be installing a different app. Updating in place needs "
                + "both builds signed with the same identity. See \(readerReleasingDoc)."
        case .replace(let reason):
            body = "Reader could not be replaced in your Applications folder.\n\n\(reason)"
        }
        showUpdateAlert(title: "Reader \(manifest.version) was not installed.", body: body)
    }

    // -- update dialogs and progress -----------------------------------------

    private func runAlert(_ alert: NSAlert, handler: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window, window.isVisible {
            alert.beginSheetModal(for: window, completionHandler: handler)
        } else {
            handler(alert.runModal())
        }
    }

    private func showUpdateAlert(title: String, body: String?) {
        let alert = NSAlert()
        alert.messageText = title
        if let body { alert.informativeText = body }
        alert.addButton(withTitle: "OK")
        runAlert(alert) { _ in }
    }

    /* A sheet rather than the status label: by the time an update is being
       downloaded the page has loaded and the label is hidden behind it, and a
       sheet is also the thing that says "this window is busy". */
    private func showUpdateProgress(_ message: String, determinate: Bool) {
        guard let window else { return }
        if updateProgressSheet == nil {
            let sheet = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 380, height: 96),
                                 styleMask: [.titled],
                                 backing: .buffered,
                                 defer: false)
            let content = sheet.contentView ?? NSView()
            let label = NSTextField(labelWithString: message)
            label.translatesAutoresizingMaskIntoConstraints = false
            label.lineBreakMode = .byTruncatingTail
            let bar = NSProgressIndicator()
            bar.translatesAutoresizingMaskIntoConstraints = false
            bar.style = .bar
            bar.minValue = 0
            bar.maxValue = 1
            content.addSubview(label)
            content.addSubview(bar)
            NSLayoutConstraint.activate([
                label.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20),
                label.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20),
                label.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),
                bar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20),
                bar.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20),
                bar.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 14)
            ])
            updateProgressSheet = sheet
            updateProgressLabel = label
            updateProgressBar = bar
            window.beginSheet(sheet, completionHandler: nil)
        }
        updateProgressLabel?.stringValue = message
        guard let bar = updateProgressBar else { return }
        bar.isIndeterminate = !determinate
        bar.doubleValue = 0
        if determinate {
            bar.stopAnimation(nil)
        } else {
            bar.startAnimation(nil)
        }
    }

    private func endUpdateProgress() {
        updateProgressObservation = nil
        guard let sheet = updateProgressSheet else { return }
        updateProgressBar?.stopAnimation(nil)
        window?.endSheet(sheet)
        updateProgressSheet = nil
        updateProgressBar = nil
        updateProgressLabel = nil
    }

    // -- requests from the page ----------------------------------------------

    /* One handler, dispatching on an action name, so a second native affordance
       later does not mean a second bridge.

       WKScriptMessageHandlerWithReply rather than the plain handler: WebKit ties
       the answer to the call that asked for it, so postMessage resolves a
       Promise on the page. A single global callback would have had to correlate
       replies itself, and would happily deliver a stale answer to a page that
       had since reloaded -- silently changing a destination under a reopened
       dialog. The reply must be made exactly once on every path. */
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        /* Only Reader's own page may ask. Documents cannot currently create a
           subframe -- the sanitiser strips them -- but that is a setting away
           from being untrue, and this is two lines. */
        guard message.frameInfo.isMainFrame,
              isReaderOrigin(message.frameInfo.securityOrigin) else {
            replyHandler(nil, "not Reader's own page")
            return
        }
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "malformed request")
            return
        }
        switch action {
        case "chooseFolder":
            chooseFolder(startingAt: body["current"] as? String, reply: replyHandler)
        default:
            replyHandler(nil, "unknown action")
        }
    }

    private func isReaderOrigin(_ origin: WKSecurityOrigin) -> Bool {
        let host = origin.host.lowercased()
        let loopback = host == "127.0.0.1" || host == "localhost" || host == "::1"
        // port 0 is what WebKit reports for a scheme's default port, which
        // Reader never uses; accepted so a future default-port run still works.
        return (origin.protocol == "http" || origin.protocol == "https")
            && loopback && (origin.port == readerPort || origin.port == 0)
    }

    /* Finder's own folder chooser: the sidebar, favourites, ⌘⇧G to type a path,
       and New Folder, none of which a picker drawn in the page can offer.
       Cancelling replies with null, which the page reads as "keep what you had". */
    private func chooseFolder(startingAt current: String?,
                              reply: @escaping (Any?, String?) -> Void) {
        guard let window else {
            reply(nil, "Reader has no window to attach the chooser to")
            return
        }
        /* A person cannot click Change twice, but a script can post twice, and
           two sheets would queue behind one another on the same window. */
        guard !isChoosingFolder else {
            reply(nil, "a folder is already being chosen")
            return
        }
        isChoosingFolder = true

        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        panel.message = "Choose a folder for the new document"
        if let current, !current.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: current, isDirectory: true)
        }

        // A sheet on a minimised window is invisible, and the page would wait
        // on a dialog nobody can see.
        window.makeKeyAndOrderFront(nil)
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            self.isChoosingFolder = false
            /* Standardised for the same reason application(_:open:) does it: the
               page compares this path against its own notion of home and of the
               folder being browsed, and a firmlinked /System/Volumes/Data path
               matches neither. */
            let chosen = (response == .OK) ? panel.url?.standardizedFileURL.path : nil
            // The sheet took first responder; the page cannot focus its field back
            // until the web view has it again.
            self.window.makeFirstResponder(self.webView)
            reply(chosen, nil)
        }
    }

    // -- links out of the document ------------------------------------------

    /* Reader's window only ever shows Reader's own local server. A document can
       link anywhere, and those links go to the browser the reader already uses:
       it is where they are signed in, and it keeps arbitrary web pages out of
       the process that holds Reader's Desktop/Documents/Downloads consent. */
    private func isReaderItself(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        guard scheme == "http" || scheme == "https" else { return false }
        guard let host = url.host?.lowercased() else { return false }
        let loopback = host == "127.0.0.1" || host == "localhost" || host == "::1"
        return loopback && (url.port ?? -1) == readerPort
    }

    /* A deliberately short list. A markdown document is untrusted content, and
       NSWorkspace opens whatever it is handed -- a file:// URL to an .app, or a
       custom scheme wired to another program, would be a way for a document to
       start something merely by being clicked. The same reasoning keeps
       /api/open-external on a whitelist. */
    private static let handOffSchemes: Set<String> = ["http", "https", "mailto", "tel"]

    @discardableResult
    private func handOff(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              ReaderAppDelegate.handOffSchemes.contains(scheme) else { return false }
        return NSWorkspace.shared.open(url)
    }

    /* target="_blank", and window.open. Returning nil means no view is created;
       the destination has already gone to the browser. */
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, !isReaderItself(url) {
            handOff(url)
        }
        return nil
    }

    /* A link without target="_blank" would otherwise replace Reader's entire
       window with a web page, and there is no back button to return from that. */
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if isReaderItself(url) {
            decisionHandler(.allow)
            return
        }
        handOff(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        statusLabel.isHidden = true
        webView.isHidden = false
        isPageLoaded = true
        if let path = pendingOpenPath {
            pendingOpenPath = nil
            deliver(path: path)
        }
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
