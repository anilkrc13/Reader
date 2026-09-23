import Cocoa
import CryptoKit
import Darwin
import Foundation
import Security
import WebKit

private let readerPort = Int(ProcessInfo.processInfo.environment["READER_LAUNCHER_PORT"] ?? "") ?? 8737
/* Every window and tab this launch had open, rebuilt on the next one. */
private let sessionKey = "ReaderSession"
/* Windows share it so AppKit lets their tabs merge and move between them. */
private let tabbingIdentifier = "ReaderDocument"
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
    /* Answers /api/ping as Reader, but cannot serve the app. A server whose
       bundle has been deleted or replaced keeps running on the code already in
       memory: the ping route is pure code and still replies, while everything
       that reads from disk does not. Reusing one of those put a plain-text
       "not found" in the window in place of Reader. */
    case stale(String)
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

private final class ReaderAppDelegate: NSObject, NSApplicationDelegate {
    /* Every window and tab. Each is one Reader page on the one server this
       app starts or reuses, so tabs can merge and move between windows. */
    private var pages: [ReaderPage] = []
    private var serverProcess: Process?
    private var ownsServer = false
    private var isFinishing = false
    private var readinessStartedAt: Date?
    private var appearanceObservation: NSKeyValueObservation?
    /* A document handed to us by Finder or `open`. AppKit can deliver it
       before the server is up and before the page has loaded, so it is held
       here until there is somewhere to send it. */
    private var pendingOpenPath: String?
    /* A Finder open that arrived while a session was being restored. It still
       becomes the server's startup grant, but opens in a tab of its own rather
       than over a restored tab's document. */
    private var startupGrantPath: String?
    /* The page's address once the server is ready. Pages made before then
       show the startup status and load when it arrives. */
    private var readerPageURL: URL?
    private var statusMessage = "Starting Reader…"
    private var serverError: String?
    /* Set once quitting has begun and the session is saved, so windows closing
       on the way out cannot overwrite it. */
    private var isTerminating = false
    /* The window an update's progress sheet is attached to, so it ends on the
       same window it began on. */
    private var updateSheetWindow: NSWindow?
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
        if !restoreSession() {
            openPage(intent: nil)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !pages.isEmpty, pages.contains(where: { $0.intent != nil }), let path = pendingOpenPath {
            // A restored session: the Finder document gets its own tab.
            startupGrantPath = path
            pendingOpenPath = nil
            openTab(from: nil, openPath: path)
        }
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
        let page = keyPage
        page?.window.makeKeyAndOrderFront(nil)
        if let page, page.isPageLoaded {
            page.deliver(path: path)
        } else {
            pendingOpenPath = path
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            keyPage?.window.makeKeyAndOrderFront(nil)
        }
        return true
    }

    // -- windows and tabs ----------------------------------------------------

    /* The page the menus act on: the key window's, else the frontmost. */
    private var keyPage: ReaderPage? {
        pages.first { $0.window.isKeyWindow }
            ?? pages.first { $0.window.isMainWindow }
            ?? NSApp.orderedWindows.lazy.compactMap { window in
                self.pages.first { $0.window === window }
            }.first
            ?? pages.last
    }

    /// Make one window or tab. `host` tabs it into that window; otherwise it
    /// is a window of its own, cascaded from the front one.
    @discardableResult
    private func openPage(intent: [String: Any]?, tabbedWith host: NSWindow? = nil) -> ReaderPage {
        let front = keyPage?.window
        let page = ReaderPage(app: self, intent: intent)
        pages.append(page)
        if let host {
            host.addTabbedWindow(page.window, ordered: .above)
        } else {
            if let front {
                page.window.setFrame(front.frame, display: false)
                page.window.setFrameTopLeftPoint(
                    front.cascadeTopLeft(from: NSPoint(x: front.frame.minX, y: front.frame.maxY)))
            } else {
                page.window.center()
            }
            // A window asked for as a window stays one, whatever the macOS
            // "prefer tabs" setting says.
            page.window.tabbingMode = .disallowed
        }
        page.window.makeKeyAndOrderFront(nil)
        page.window.tabbingMode = .automatic
        if let serverError {
            page.showError(serverError)
        } else if let readerPageURL {
            page.load(readerPageURL)
        } else {
            page.showStatus(statusMessage)
        }
        return page
    }

    /* A new tab starts in the folder of the tab it was opened from, with no
       document, like a new Finder tab. A link or a Finder document opened
       into it is delivered once its page has loaded. */
    fileprivate func openTab(from source: ReaderPage?, linkPath: String? = nil, openPath: String? = nil) {
        let source = source ?? keyPage
        let page = openPage(intent: freshIntent(from: source), tabbedWith: source?.window)
        page.pendingLinkPath = linkPath
        page.pendingOpenPath = openPath
    }

    fileprivate func openWindow(from source: ReaderPage?, linkPath: String? = nil) {
        let page = openPage(intent: freshIntent(from: source ?? keyPage))
        page.pendingLinkPath = linkPath
    }

    private func freshIntent(from source: ReaderPage?) -> [String: Any] {
        var intent: [String: Any] = ["fresh": true]
        if let root = source?.tabState["rootDir"] as? String {
            intent["root"] = root
        }
        return intent
    }

    fileprivate func pageDidLoad(_ page: ReaderPage) {
        if let path = pendingOpenPath {
            pendingOpenPath = nil
            page.deliver(path: path)
        }
    }

    /* Saved a turn later: closing a window closes its tabs one by one, and
       saving between them would shrink a last window to one tab before Reader
       quits. By then an emptied app keeps the session it last saved. */
    fileprivate func pageWillClose(_ page: ReaderPage) {
        pages.removeAll { $0 === page }
        DispatchQueue.main.async { [weak self] in self?.saveSession() }
    }

    // -- the saved session ---------------------------------------------------

    /* Windows front to back, each with its tabs in order, the selected tab and
       each tab's place as its page last reported it. The last window to close
       is kept: closing it quits Reader, and the next launch reopens it. */
    fileprivate func saveSession() {
        guard !isTerminating, !pages.isEmpty else { return }
        var windows = NSApp.orderedWindows.filter { window in pages.contains { $0.window === window } }
        for page in pages where !windows.contains(where: { $0 === page.window }) {
            windows.append(page.window)          // minimised windows are not on screen
        }
        var groups: [[String: Any]] = []
        var seen = Set<ObjectIdentifier>()
        for window in windows {
            let tabs = window.tabGroup?.windows ?? [window]
            let key = ObjectIdentifier(window.tabGroup ?? window)
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            let tabPages = tabs.compactMap { tab in pages.first { $0.window === tab } }
            guard !tabPages.isEmpty else { continue }
            let selected = window.tabGroup?.selectedWindow ?? window
            groups.append([
                "frame": window.frameDescriptor,
                "selected": tabPages.firstIndex { $0.window === selected } ?? 0,
                "tabs": tabPages.map { $0.tabState }
            ])
        }
        UserDefaults.standard.set(groups, forKey: sessionKey)
    }

    /* Built back to front, so the window that was in front ends up there. */
    private func restoreSession() -> Bool {
        guard let groups = UserDefaults.standard.array(forKey: sessionKey) as? [[String: Any]] else {
            return false
        }
        var restored = false
        for group in groups.reversed() {
            guard let tabs = group["tabs"] as? [[String: Any]], !tabs.isEmpty else { continue }
            var tabPages: [ReaderPage] = []
            for tab in tabs {
                let page = openPage(intent: ["restore": tab], tabbedWith: tabPages.last?.window)
                if tabPages.isEmpty, let frame = group["frame"] as? String {
                    page.window.setFrame(from: frame)
                }
                tabPages.append(page)
            }
            let selected = min(max(group["selected"] as? Int ?? 0, 0), tabPages.count - 1)
            tabPages[selected].window.makeKeyAndOrderFront(nil)
            restored = true
        }
        return restored
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

        /* File sits between the app menu and Edit, where macOS puts it. New
           Document is the page's own ⌘N: claiming it here would take the key
           away from the web view, so the item hands it straight back. */
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        let newDocItem = NSMenuItem(title: "New Document…",
                                    action: #selector(newDocumentFromMenu(_:)),
                                    keyEquivalent: "n")
        newDocItem.keyEquivalentModifierMask = .command
        newDocItem.target = self
        fileMenu.addItem(newDocItem)

        /* AppKit's own tab action, so the tab bar's + button and ⌘T are one
           command. Untargeted: it reaches the key window's page. */
        let newTabItem = NSMenuItem(title: "New Tab",
                                    action: #selector(NSResponder.newWindowForTab(_:)),
                                    keyEquivalent: "t")
        newTabItem.keyEquivalentModifierMask = .command
        fileMenu.addItem(newTabItem)

        /* ⇧⌘N, because ⌘N already makes a document. The same split VS Code
           draws: ⌘N a new file, ⇧⌘N a new window. */
        let newWindowItem = NSMenuItem(title: "New Window",
                                       action: #selector(newWindowFromMenu(_:)),
                                       keyEquivalent: "N")
        newWindowItem.keyEquivalentModifierMask = [.command, .shift]
        newWindowItem.target = self
        fileMenu.addItem(newWindowItem)
        fileMenu.addItem(.separator())
        // Closes the tab, or the window when it has one tab.
        fileMenu.addItem(NSMenuItem(title: "Close",
                                    action: #selector(NSWindow.performClose(_:)),
                                    keyEquivalent: "w"))

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

        /* Registered as the windows menu, AppKit adds the tab commands to it:
           Show Previous and Next Tab, Move Tab to New Window, Merge All Windows. */
        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)
        windowMenu.addItem(NSMenuItem(title: "Minimize",
                                      action: #selector(NSWindow.performMiniaturize(_:)),
                                      keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Zoom",
                                      action: #selector(NSWindow.performZoom(_:)),
                                      keyEquivalent: ""))
        windowMenu.addItem(.separator())
        windowMenu.addItem(NSMenuItem(title: "Bring All to Front",
                                      action: #selector(NSApplication.arrangeInFront(_:)),
                                      keyEquivalent: ""))
        NSApp.windowsMenu = windowMenu

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
        saveSession()
        isTerminating = true
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

    private func probeAndOpen() {
        setStatus("Checking for an existing Reader server…")
        probeServer { [weak self] result in
            guard let self, !self.isFinishing else { return }
            switch result {
            case .compatible:
                self.setStatus("Connecting to Reader…")
                self.loadReaderPage()
            case .stale(let version):
                /* The port is held, so Reader cannot start its own server on it,
                   and the one that is there cannot serve. Say which, and say what
                   ends it -- the alternative is the window the reader actually
                   saw: the other server's plain-text 404. */
                self.showError("A Reader server from an earlier build (version "
                    + version + ") is holding port \(readerPort) and can no longer "
                    + "serve the app. Quit that copy of Reader, then open this one again.")
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

        setStatus("Starting Reader’s local server…")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        var arguments = ["python3", script.path, "--port", String(readerPort), "--no-browser"]
        // Handing the document to the server it is about to start makes that
        // file's folder part of the save workspace, so a document opened from
        // Finder outside the home folder stays editable.
        if let path = startupGrantPath {
            // Restored session: the grant, while its own tab delivers it.
            arguments.append(path)
        } else if let path = pendingOpenPath {
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
            case .stale:
                /* Our own server, answering before it can read its own folder.
                   Keep waiting; the readiness timeout is the backstop. */
                if let started = self.readinessStartedAt,
                   Date().timeIntervalSince(started) >= readinessTimeout {
                    self.stopOwnedServer()
                    self.showError("Reader's server started but cannot read its own files.")
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self.waitUntilReady()
                    }
                }
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

    private func probeRequest(_ path: String) -> URLRequest? {
        guard let url = URL(string: "http://127.0.0.1:\(readerPort)\(path)") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    /* Identifying the thing on the port is not the same as establishing that it
       can do the job. Answering as Reader only proves some Reader is running;
       the second request proves it can still reach its own files, which is what
       actually decides whether reusing it will produce the app or a 404. */
    private func probeServer(completion: @escaping (ReaderProbe) -> Void) {
        guard let request = probeRequest("/api/ping") else {
            completion(.unreachable)
            return
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let object = data.flatMap {
                try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
            } ?? nil
            guard let object, object["app"] as? String == readerAppName else {
                let verdict: ReaderProbe =
                    (response != nil || (error as NSError?)?.code == NSURLErrorTimedOut)
                    ? .occupied : .unreachable
                DispatchQueue.main.async { completion(verdict) }
                return
            }
            let version = object["version"] as? String ?? "an unknown version"
            self?.probeCanServe(version: version, completion: completion)
        }.resume()
    }

    /* The icon is served from the same folder as the page and its scripts, and
       needs no session, so it answers this question without a token in hand. */
    private func probeCanServe(version: String,
                               completion: @escaping (ReaderProbe) -> Void) {
        guard let request = probeRequest("/favicon.ico") else {
            DispatchQueue.main.async { completion(.stale(version)) }
            return
        }
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let served = code == 200 && (data?.isEmpty == false)
            DispatchQueue.main.async {
                completion(served ? .compatible : .stale(version))
            }
        }.resume()
    }

    private func loadReaderPage() {
        guard let token = readerToken(),
              let url = URL(string: "http://127.0.0.1:\(readerPort)/?t=\(token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token)") else {
            showError("Reader is running, but its local access token could not be found.")
            return
        }
        readerPageURL = url
        for page in pages { page.load(url) }
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

    private func setStatus(_ message: String) {
        statusMessage = message
        for page in pages { page.showStatus(message) }
    }

    /* A server problem belongs to every page waiting on it. */
    private func showError(_ message: String) {
        serverError = message
        for page in pages { page.showError(message) }
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

    /* When About asked for the check, the outcome goes back to the page and the
       modal alerts for "nothing to do" outcomes are left unshown: the person is
       already looking at a status line, and an alert on top of it would be the
       same sentence twice. An outcome worth acting on still runs the ordinary
       flow, alerts and all, so there is only ever one install path. */
    private func checkForUpdates(userInitiated: Bool,
                                 report: (([String: Any]) -> Void)? = nil) {
        guard !isUpdating else {
            if let report {
                report(["state": "busy"])
            } else if userInitiated {
                showUpdateAlert(title: "Reader is already checking for updates.", body: nil)
            }
            return
        }
        isUpdating = true
        UserDefaults.standard.set(Date(), forKey: lastUpdateCheckKey)
        if userInitiated, report == nil {
            showUpdateProgress("Checking for updates…", determinate: false)
        }
        fetchManifest { [weak self] result in
            guard let self else { return }
            self.endUpdateProgress()
            switch result {
            case .failure(let problem):
                self.isUpdating = false
                if let report {
                    report(["state": "error", "message": self.describe(problem)])
                } else if userInitiated {
                    self.showUpdateAlert(title: "Reader could not check for updates.",
                                         body: self.describe(problem))
                }
            case .success(let manifest):
                self.consider(manifest, userInitiated: userInitiated, report: report)
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

    private func consider(_ manifest: UpdateManifest, userInitiated: Bool,
                          report: (([String: Any]) -> Void)? = nil) {
        let current = ReaderAppDelegate.currentVersion()
        guard ReaderAppDelegate.isNewer(manifest.version, than: current) else {
            isUpdating = false
            if let report {
                report(["state": "current", "version": current])
            } else if userInitiated {
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
                if let report {
                    report(["state": "error",
                            "message": self.describe(.tooOld(manifest.minimumMacOS))])
                } else if userInitiated {
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
            report?(["state": "available", "version": manifest.version, "installable": false])
            offerReleasePage(manifest)
            return
        }
        report?(["state": "available", "version": manifest.version, "installable": true])
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
                handOff(manifest.releasePage)
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
        if let window = keyPage?.window, window.isVisible {
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
        guard let window = updateSheetWindow ?? keyPage?.window else { return }
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
            updateSheetWindow = window
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
        updateSheetWindow?.endSheet(sheet)
        updateSheetWindow = nil
        updateProgressSheet = nil
        updateProgressBar = nil
        updateProgressLabel = nil
    }

    // -- File menu -----------------------------------------------------------

    /* The page owns this dialog; the menu item only asks for it. Claiming ⌘N in
       the menu bar takes the key from the web view, so handing it back is what
       keeps the shortcut working at all. */
    @objc private func newDocumentFromMenu(_ sender: Any?) {
        keyPage?.callPage("newDocument", [])
    }

    /* A window in this app, on the same server as the others, so its tabs
       can be merged with theirs. */
    @objc private func newWindowFromMenu(_ sender: Any?) {
        openWindow(from: keyPage)
    }

    // -- requests from the page ----------------------------------------------

    /* About's button runs exactly the check the menu item runs. The request
       carries nothing: no URL, no version, no permission to skip a step, so the
       page cannot aim the updater at something of its own choosing. What comes
       back is the outcome in words, for the status line.

       The daily check is the thing `updates.check` switches off. This one is a
       button somebody pressed, so it is answered the same way the menu item
       answers it. */
    fileprivate func checkForUpdatesForPage(reply: @escaping (Any?, String?) -> Void) {
        // WebKit tolerates no second reply, and an update can end in more than
        // one place, so only the first outcome is handed back.
        var answered = false
        checkForUpdates(userInitiated: true) { outcome in
            guard !answered else { return }
            answered = true
            reply(outcome, nil)
        }
    }

}

// -- links out of the document ----------------------------------------------

/* Reader's windows only ever show Reader's own local server. A document can
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

private func isReaderOrigin(_ origin: WKSecurityOrigin) -> Bool {
    let host = origin.host.lowercased()
    let loopback = host == "127.0.0.1" || host == "localhost" || host == "::1"
    // port 0 is what WebKit reports for a scheme's default port, which
    // Reader never uses; accepted so a future default-port run still works.
    return (origin.protocol == "http" || origin.protocol == "https")
        && loopback && (origin.port == readerPort || origin.port == 0)
}

/* app.js gives a link to another local document the href
   /open?path=<absolute path>. The server has no such page; only the native
   context menu ever navigates there, and that is caught here. */
private func documentLinkPath(_ url: URL) -> String? {
    guard isReaderItself(url), url.path == "/open",
          let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?
              .queryItems?.first(where: { $0.name == "path" })?.value,
          path.hasPrefix("/") else { return nil }
    return path
}

/* A deliberately short list. A markdown document is untrusted content, and
   NSWorkspace opens whatever it is handed -- a file:// URL to an .app, or a
   custom scheme wired to another program, would be a way for a document to
   start something merely by being clicked. The same reasoning keeps
   /api/open-external on a whitelist. */
private let handOffSchemes: Set<String> = ["http", "https", "mailto", "tel"]

@discardableResult
private func handOff(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased(), handOffSchemes.contains(scheme) else { return false }
    return NSWorkspace.shared.open(url)
}

/* A title bar button that says when the pointer rests on it: the panel
   button floats the hidden panel out on hover, as the page's own one does. */
private final class HoverButton: NSButton {
    var onHover: ((Bool) -> Void)?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds,
                                       options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }

    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
}

/* WebKit's link menu has Open Link in New Window but no tab. The added item
   runs WebKit's own new-window command with the page told to make a tab of
   it, so the link WebKit resolved is the one that opens. */
private final class ReaderWebView: WKWebView {
    weak var page: ReaderPage?

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        registerForDraggedTypes([.fileURL])
    }

    /* Files dragged in from Finder or another app. A drag from inside Reader's
       own page -- the file panel -- has this view as its source and is left
       to the page, which already knows those paths. Folders are skipped. */
    private func externalFiles(_ info: NSDraggingInfo) -> [String]? {
        guard info.draggingSource == nil,
              let urls = info.draggingPasteboard.readObjects(
                  forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] else {
            return nil
        }
        let files = urls.map { $0.standardizedFileURL }.filter {
            (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) != true
        }.map(\.path)
        return files.isEmpty ? nil : files
    }

    /* The pointer in the page's own coordinates, top-left origin. */
    private func pagePoint(_ info: NSDraggingInfo) -> [Double] {
        let point = convert(info.draggingLocation, from: nil)
        return [Double(point.x), Double(isFlipped ? point.y : bounds.height - point.y)]
    }

    override func draggingEntered(_ info: NSDraggingInfo) -> NSDragOperation {
        guard externalFiles(info) != nil else { return super.draggingEntered(info) }
        page?.callPage("fileDropHover", pagePoint(info))
        return .copy
    }

    override func draggingUpdated(_ info: NSDraggingInfo) -> NSDragOperation {
        guard externalFiles(info) != nil else { return super.draggingUpdated(info) }
        page?.callPage("fileDropHover", pagePoint(info))
        return .copy
    }

    override func draggingExited(_ info: NSDraggingInfo?) {
        if let info, externalFiles(info) != nil {
            page?.callPage("fileDropHover", [NSNull(), NSNull()])
            return
        }
        super.draggingExited(info)
    }

    override func prepareForDragOperation(_ info: NSDraggingInfo) -> Bool {
        externalFiles(info) != nil ? true : super.prepareForDragOperation(info)
    }

    /* The first file opens in the pane under the pointer; any others in tabs
       of their own. Each opens as a Finder open does, never as a grant. */
    override func performDragOperation(_ info: NSDraggingInfo) -> Bool {
        guard let files = externalFiles(info) else { return super.performDragOperation(info) }
        page?.callPage("dropFile", [files[0]] + pagePoint(info))
        for path in files.dropFirst() {
            page?.openInNewTab(path: path)
        }
        return true
    }

    override func concludeDragOperation(_ info: NSDraggingInfo?) {
        if let info, externalFiles(info) != nil { return }
        super.concludeDragOperation(info)
    }

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        guard let index = menu.items.firstIndex(where: {
            $0.identifier?.rawValue == "WKMenuItemIdentifierOpenLinkInNewWindow"
                || $0.title == "Open Link in New Window"
        }) else { return }
        let original = menu.items[index]
        let tab = NSMenuItem(title: "Open Link in New Tab",
                             action: #selector(openLinkInNewTab(_:)), keyEquivalent: "")
        tab.target = self
        tab.representedObject = original
        menu.insertItem(tab, at: index)
        /* Beside the document in this tab, splitting it if it shows one. */
        let side = NSMenuItem(title: "Open to the Side",
                              action: #selector(openLinkToTheSide(_:)), keyEquivalent: "")
        side.target = self
        side.representedObject = original
        menu.insertItem(side, at: index)
    }

    @objc private func openLinkInNewTab(_ sender: NSMenuItem) {
        run(sender, as: .tab)
    }

    @objc private func openLinkToTheSide(_ sender: NSMenuItem) {
        run(sender, as: .side)
    }

    private func run(_ sender: NSMenuItem, as destination: ReaderPage.LinkDestination) {
        guard let original = sender.representedObject as? NSMenuItem,
              let action = original.action else { return }
        page?.expectNextNewWindow(as: destination)
        NSApp.sendAction(action, to: original.target, from: original)
    }
}

/* One window or tab: its own page on the shared server, its own status while
   the server starts, and its own route from the page into the app. */
private final class ReaderPage: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    let window: NSWindow
    private let webView: ReaderWebView
    private let statusLabel: NSTextField
    private weak var app: ReaderAppDelegate?
    /* What the app made this page for; injected into the page before it runs. */
    let intent: [String: Any]?
    private(set) var isPageLoaded = false
    private var loadedURL: URL?
    /* A Finder document, opened with openFromOS once the page has loaded. */
    var pendingOpenPath: String?
    /* A document link this tab was opened for. Unlike a Finder open it is never
       a server startup path: the document's author chose the target, so it
       must not become a write grant. */
    var pendingLinkPath: String?
    /* This tab's place as the page last reported it, for the saved session.
       Plist types only: strings and booleans. */
    private(set) var tabState: [String: Any] = [:]
    private var isChoosingFolder = false
    private var titleObservation: NSKeyValueObservation?
    enum LinkDestination { case window, tab, side }
    private var nextNewWindow: LinkDestination = .window
    /* The title bar's own buttons: the panel, back and forward after the window
       buttons, theme and settings at the far end. The page hides its copies. */
    private var panelButton: NSButton!
    private var backButton: NSButton!
    private var forwardButton: NSButton!
    private var themeButton: NSButton!
    private var splitButton: NSButton!

    init(app: ReaderAppDelegate, intent: [String: Any]?) {
        self.app = app
        self.intent = intent
        if let restore = intent?["restore"] as? [String: Any] {
            tabState = ReaderPage.cleanTabState(restore)
        } else if let root = intent?["root"] as? String {
            tabState = ["rootDir": root]
        }

        let content = NSView(frame: .zero)
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        /* The page asks for native things through this one channel. It is the
           only route from the page into the app; everything else is one-way.
           A configuration per page, so a request arrives at the page that
           made it. */
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__readerChrome = true;",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let intent,
           let data = try? JSONSerialization.data(withJSONObject: intent, options: []),
           let json = String(data: data, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__readerTab = \(json);",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = ReaderWebView(frame: .zero, configuration: configuration)

        statusLabel = NSTextField(labelWithString: "Starting Reader…")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered,
                          defer: false)
        super.init()

        configuration.userContentController.addScriptMessageHandler(
            self, contentWorld: .page, name: "reader")
        webView.page = self
        webView.navigationDelegate = self
        /* Without a UI delegate, WebKit answers a target="_blank" link by
           silently dropping it -- which is why a link to a Google Doc did
           nothing at all in the app while working in a browser. */
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isHidden = true
        content.addSubview(webView)

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

        window.title = readerAppName
        /* The toolbar already names the document, and the tab names it again
           when there are tabs; a third copy in the title bar is noise. */
        window.titleVisibility = .hidden
        window.tabbingIdentifier = tabbingIdentifier
        window.isReleasedWhenClosed = false
        window.contentView = content
        window.delegate = self
        window.minSize = NSSize(width: 720, height: 480)
        addTitlebarButtons()
        styleTab()

        /* The page titles itself after its document, with "• " in front while
           there are unsaved edits; the tab and the Window menu show that. */
        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] view, _ in
            guard let self else { return }
            let title = view.title ?? ""
            self.window.title = title.isEmpty ? readerAppName : title
            self.styleTab()
        }
    }

    private func titlebarButton(_ symbol: String, _ label: String, _ action: Selector) -> NSButton {
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)?
            .withSymbolConfiguration(.init(pointSize: 14, weight: .regular))
        let button = HoverButton(image: image ?? NSImage(), target: self, action: action)
        button.isBordered = false
        button.contentTintColor = .secondaryLabelColor
        button.toolTip = label
        button.setAccessibilityLabel(label)
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 28),
            button.heightAnchor.constraint(equalToConstant: 24)
        ])
        return button
    }

    private func titlebarAccessory(_ buttons: [NSButton], _ side: NSLayoutConstraint.Attribute) {
        let stack = NSStackView(views: buttons)
        stack.orientation = .horizontal
        stack.spacing = 2
        stack.edgeInsets = NSEdgeInsets(top: 0, left: side == .left ? 8 : 0, bottom: 0, right: side == .right ? 8 : 0)
        let height: CGFloat = 28
        stack.frame = NSRect(x: 0, y: 0, width: stack.fittingSize.width, height: height)
        let accessory = NSTitlebarAccessoryViewController()
        accessory.view = stack
        accessory.layoutAttribute = side
        window.addTitlebarAccessoryViewController(accessory)
    }

    private func addTitlebarButtons() {
        panelButton = titlebarButton("sidebar.left", "Hide panel (⌘\\)", #selector(chromePanel(_:)))
        (panelButton as? HoverButton)?.onHover = { [weak self] inside in
            self?.callPage("peek", [inside])
        }
        backButton = titlebarButton("chevron.left", "Back (⌘←)", #selector(chromeBack(_:)))
        forwardButton = titlebarButton("chevron.right", "Forward (⌘→)", #selector(chromeForward(_:)))
        backButton.isEnabled = false
        forwardButton.isEnabled = false
        themeButton = titlebarButton("circle.lefthalf.filled", "Appearance: match system", #selector(chromeTheme(_:)))
        let settings = titlebarButton("gearshape", "Settings (⌘,)", #selector(chromeSettings(_:)))
        splitButton = titlebarButton("rectangle.split.2x1", "Show two documents side by side (⌥⌘\\)",
                                     #selector(chromeSplit(_:)))
        titlebarAccessory([panelButton, backButton, forwardButton], .left)
        titlebarAccessory([splitButton, themeButton, settings], .right)
    }

    @objc private func chromePanel(_ sender: Any?) { callPage("chrome", ["panel"]) }
    @objc private func chromeBack(_ sender: Any?) { callPage("chrome", ["back"]) }
    @objc private func chromeForward(_ sender: Any?) { callPage("chrome", ["forward"]) }
    @objc private func chromeTheme(_ sender: Any?) { callPage("chrome", ["theme"]) }
    @objc private func chromeSettings(_ sender: Any?) { callPage("chrome", ["settings"]) }
    @objc private func chromeSplit(_ sender: Any?) { callPage("chrome", ["split"]) }

    /* What the page says its buttons should show. */
    private func applyChrome(_ body: [String: Any]) {
        backButton.isEnabled = body["canBack"] as? Bool ?? false
        forwardButton.isEnabled = body["canForward"] as? Bool ?? false
        let shown = body["panelShown"] as? Bool ?? true
        let side = body["side"] as? String == "right" ? "right" : "left"
        panelButton.image = NSImage(systemSymbolName: "sidebar.\(side)",
                                    accessibilityDescription: shown ? "Hide panel" : "Show panel")?
            .withSymbolConfiguration(.init(pointSize: 14, weight: .regular))
        panelButton.toolTip = shown ? "Hide panel (⌘\\)" : "Show panel (⌘\\)"
        panelButton.contentTintColor = shown ? .labelColor : .secondaryLabelColor
        let split = body["split"] as? Bool ?? false
        splitButton.contentTintColor = split ? .controlAccentColor : .secondaryLabelColor
        splitButton.toolTip = split ? "Close the second document (⌥⌘\\)" : "Show two documents side by side (⌥⌘\\)"
        let theme = body["theme"] as? String
        let symbol: String
        switch theme {
        case "dark":
            window.appearance = NSAppearance(named: .darkAqua)
            symbol = "moon"
        case "light":
            window.appearance = NSAppearance(named: .aqua)
            symbol = "sun.max"
        default:
            window.appearance = nil
            symbol = "circle.lefthalf.filled"
        }
        let label = "Appearance: " + (theme == "dark" || theme == "light" ? theme! : "match system")
        themeButton.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)?
            .withSymbolConfiguration(.init(pointSize: 14, weight: .regular))
        themeButton.toolTip = label
    }

    /* macOS draws inactive tab titles small and faint, so several tabs blur
       into one strip. Each tab's title is set in the ordinary text colour at
       medium weight, with an icon for the kind of document, so every tab reads
       on its own. The bar's highlight still marks the selected tab. */
    private func styleTab() {
        let title = window.title
        window.tab.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: NSFont.smallSystemFontSize, weight: .medium),
            .foregroundColor: NSColor.labelColor
        ])
        let name = title.hasPrefix("• ") ? String(title.dropFirst(2)) : title
        let ext = (name as NSString).pathExtension.lowercased()
        let symbol: String
        switch ext {
        case "md", "markdown", "mdown", "txt": symbol = "doc.text"
        case "csv", "tsv": symbol = "tablecells"
        case "pdf": symbol = "doc.richtext"
        case "": symbol = name == readerAppName ? "folder" : "doc"
        default: symbol = "chevron.left.forwardslash.chevron.right"
        }
        let icon = NSImageView(image: NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 11, weight: .regular)) ?? NSImage())
        icon.contentTintColor = .secondaryLabelColor
        icon.frame = NSRect(x: 0, y: 0, width: 16, height: 14)
        window.tab.accessoryView = icon
    }

    /* Only the keys and value types the session can hold. */
    private static func cleanTabState(_ raw: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        for key in ["mode", "rootDir", "lastFile", "previewLayout"] {
            if let value = raw[key] as? String, !value.isEmpty { out[key] = value }
        }
        for key in ["hidden", "editPreview"] {
            if let value = raw[key] as? Bool { out[key] = value }
        }
        /* A split tab: the divider's place and the second document's own. */
        if let split = raw["split"] as? [String: Any] {
            var kept: [String: Any] = ["pane": cleanTabState(split["pane"] as? [String: Any] ?? [:])]
            if let ratio = split["ratio"] as? Double { kept["ratio"] = ratio }
            out["split"] = kept
        }
        return out
    }

    func load(_ url: URL) {
        guard loadedURL == nil else { return }
        loadedURL = url
        webView.load(URLRequest(url: url))
    }

    func showStatus(_ message: String) {
        guard !isPageLoaded else { return }
        statusLabel.stringValue = message
    }

    func showError(_ message: String) {
        statusLabel.isHidden = false
        webView.isHidden = true
        statusLabel.stringValue = message
        statusLabel.textColor = .systemRed
        statusLabel.maximumNumberOfLines = 4
        statusLabel.lineBreakMode = .byWordWrapping
    }

    /// Ask the loaded page to open a document the OS handed over. A reused
    /// server has no trusted launcher-to-server grant channel, so its backend
    /// reports an out-of-workspace file as read-only. When this launcher starts
    /// the server itself, the startup path is an initial server grant.
    func deliver(path: String) {
        callPage("openFromOS", [path])
    }

    /// Call one of the page's `window.reader` hooks. `name` is always a
    /// literal from this file; the arguments are JSON-encoded so no path can
    /// escape into the script itself.
    func callPage(_ name: String, _ arguments: [Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: arguments, options: []),
              let array = String(data: data, encoding: .utf8) else { return }
        let call = "window.reader.\(name).apply(null, \(array))"
        let script = "window.reader && window.reader.\(name) ? (\(call), true) : false"
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            // app.js publishes `window.reader` as the page finishes booting;
            // one bounded retry covers the case where we win that race.
            if (result as? Bool) != true {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    guard let self, self.isPageLoaded else { return }
                    self.webView.evaluateJavaScript(
                        "window.reader && window.reader.\(name) && \(call)", completionHandler: nil)
                }
            }
        }
    }

    /* A dropped Finder document beyond the first: a tab of its own, opened as
       a Finder open would be. */
    func openInNewTab(path: String) {
        app?.openTab(from: self, openPath: path)
    }

    /* WebKit asks for the new window a moment after the menu item runs, in a
       separate round trip, so the request is remembered briefly rather than
       for the next window.open. */
    func expectNextNewWindow(as destination: LinkDestination) {
        nextNewWindow = destination
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.nextNewWindow = .window
        }
    }

    // -- the window ----------------------------------------------------------

    /* AppKit's tab action: ⌘T, and the tab bar's + button. */
    @objc func newWindowForTab(_ sender: Any?) {
        app?.openTab(from: self)
    }

    func windowDidBecomeKey(_ notification: Notification) {
        app?.saveSession()
    }

    /* macOS hides the title bar in full screen, and with it these buttons, so
       the page shows its own until the window comes back out. */
    func windowDidEnterFullScreen(_ notification: Notification) {
        callPage("setNativeChrome", [false])
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        callPage("setNativeChrome", [true])
    }

    func windowWillClose(_ notification: Notification) {
        titleObservation = nil
        // The controller holds this page as its handler; release it.
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "reader", contentWorld: .page)
        app?.pageWillClose(self)
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
        case "checkForUpdates":
            if let app {
                app.checkForUpdatesForPage(reply: replyHandler)
            } else {
                replyHandler(nil, "Reader is closing")
            }
        case "chrome":
            // The title bar buttons' state, and Reader's theme (not the
            // system's) for this window's title and tab bar.
            applyChrome(body)
            replyHandler(true, nil)
        case "tabState":
            if let state = body["state"] as? [String: Any] {
                tabState = ReaderPage.cleanTabState(state)
                app?.saveSession()
            }
            replyHandler(true, nil)
        case "openInNewTab":
            // A document link's resolved path, as for the context menu: opened
            // as a click would, never a grant.
            if let path = body["path"] as? String, path.hasPrefix("/") {
                app?.openTab(from: self, linkPath: path)
                replyHandler(true, nil)
            } else {
                replyHandler(nil, "malformed path")
            }
        default:
            replyHandler(nil, "unknown action")
        }
    }

    /* Finder's own folder chooser: the sidebar, favourites, ⌘⇧G to type a path,
       and New Folder, none of which a picker drawn in the page can offer.
       Cancelling replies with null, which the page reads as "keep what you had". */
    private func chooseFolder(startingAt current: String?,
                              reply: @escaping (Any?, String?) -> Void) {
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

    // -- navigation ----------------------------------------------------------

    /* target="_blank", window.open, and the link menu's new-window and new-tab
       items. Returning nil means no view is created: a document link opens in
       a Reader tab or window of its own, anything else goes to the browser. */
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        let destination = nextNewWindow
        nextNewWindow = .window
        if let url = navigationAction.request.url {
            if let path = documentLinkPath(url) {
                switch destination {
                case .tab: app?.openTab(from: self, linkPath: path)
                case .side: callPage("openBeside", [path])
                case .window: app?.openWindow(from: self, linkPath: path)
                }
            } else if !isReaderItself(url) {
                handOff(url)
            }
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
        /* The native menu's Open Link on a document link. The page opens it
           exactly as a click would, and the window keeps showing Reader. */
        if let path = documentLinkPath(url) {
            decisionHandler(.cancel)
            guard isPageLoaded, let frame = navigationAction.targetFrame else { return }
            if frame.isMainFrame {
                callPage("openLink", [path])
            } else {
                // A link in the split's second pane opens in that pane.
                callPage("openInPane", ["side", path])
            }
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
        app?.pageDidLoad(self)
        if let path = pendingOpenPath {
            pendingOpenPath = nil
            deliver(path: path)
        }
        if let path = pendingLinkPath {
            pendingLinkPath = nil
            callPage("openLink", [path, true])
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
