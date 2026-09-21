import AppKit
import SwiftUI

struct CommandEntry: Codable, Identifiable, Equatable {
    var id = ""
    var title = ""
    var mode = "ssh"
    var host = ""
    var command = ""
    var cwd = ""
}

struct Catalog: Decodable {
    var entries: [CommandEntry]
    var revision: String
    var changed: [String]?
}

struct Runtime: Decodable {
    var python: String
    var launcher: String
    var manager: String
}

struct CodeEditor: NSViewRepresentable {
    @Binding var text: String

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CodeEditor
        init(_ parent: CodeEditor) { self.parent = parent }
        func textDidChange(_ notification: Notification) {
            guard let editor = notification.object as? NSTextView else { return }
            parent.text = editor.string
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        let editor = scroll.documentView as! NSTextView
        editor.delegate = context.coordinator
        editor.isRichText = false
        editor.allowsUndo = true
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.isAutomaticTextReplacementEnabled = false
        editor.isAutomaticSpellingCorrectionEnabled = false
        editor.isContinuousSpellCheckingEnabled = false
        editor.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        editor.textContainerInset = NSSize(width: 8, height: 8)
        editor.string = text
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let editor = scroll.documentView as? NSTextView else { return }
        if editor.string != text { editor.string = text }
    }
}

enum Backend {
    static func execute(_ action: String, payload: [String: String] = [:], launch: Bool = false) throws -> Data {
        let runtimeURL = Bundle.main.url(forResource: "runtime", withExtension: "json")!
        let runtime = try JSONDecoder().decode(Runtime.self, from: Data(contentsOf: runtimeURL))
        let process = Process()
        process.executableURL = URL(fileURLWithPath: runtime.python)
        process.arguments = launch ? [runtime.launcher, "open", action] : [runtime.manager, action]
        let output = Pipe()
        let input = Pipe()
        process.standardOutput = output
        process.standardError = output
        process.standardInput = input
        try process.run()
        if !payload.isEmpty {
            try input.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: payload))
        }
        try input.fileHandleForWriting.close()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            throw NSError(domain: "Terminal Jump", code: Int(process.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: String(data: data, encoding: .utf8) ?? "操作失败"
            ])
        }
        return data
    }
}

final class CommandStore: ObservableObject {
    @Published var entries: [CommandEntry] = []
    @Published var draft = CommandEntry()
    @Published var baseline = CommandEntry()
    @Published var originalID = ""
    @Published var message = "保存仅更新配置；点击「打开终端」才会执行。"
    @Published var error: String?
    @Published var busy = false
    @Published var batchText = ""
    @Published var showBatch = false
    private var revision = ""
    var dirty: Bool { draft != baseline }
    var saved: Bool { !originalID.isEmpty && !dirty }
    var link: String { "terminal-jump://open/\(originalID)" }

    func allowDiscard() -> Bool {
        if !dirty { return true }
        let alert = NSAlert()
        alert.messageText = "放弃未保存的修改？"
        alert.informativeText = "当前内容尚未写入配置。"
        alert.addButton(withTitle: "放弃修改")
        alert.addButton(withTitle: "继续编辑")
        return alert.runModal() == .alertFirstButtonReturn
    }

    func select(_ entry: CommandEntry?) {
        guard allowDiscard() else { return }
        applySelection(entry)
    }

    private func applySelection(_ entry: CommandEntry?) {
        draft = entry ?? CommandEntry()
        baseline = draft
        originalID = entry?.id ?? ""
    }

    func perform(_ action: String, payload: [String: String] = [:]) {
        guard !busy else { return }
        busy = true
        var request = payload
        request["revision"] = revision
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let data = try Backend.execute(action, payload: action == "list" ? [:] : request)
                let result = try JSONDecoder().decode(Catalog.self, from: data)
                DispatchQueue.main.async {
                    self.entries = result.entries
                    self.revision = result.revision
                    let preferred = result.changed?.first ?? self.originalID
                    self.applySelection(result.entries.first(where: { $0.id == preferred }) ?? result.entries.first)
                    self.busy = false
                    if action == "batch" {
                        self.showBatch = false
                        self.batchText = ""
                        self.message = "已新增 \(result.changed?.count ?? 0) 条命令，未执行任何指令。"
                    } else if action == "save" {
                        self.message = "已保存，链接可直接粘贴到 TODO。活跃终端不会被重启。"
                    } else if action == "delete" {
                        self.message = "已删除配置；不会终止已打开的终端。"
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.busy = false
                    self.error = error.localizedDescription
                }
            }
        }
    }

    func save() {
        perform("save", payload: [
            "id": draft.id, "original_id": originalID, "title": draft.title,
            "mode": draft.mode, "host": draft.host, "command": draft.command, "cwd": draft.cwd
        ])
    }

    func delete() {
        let alert = NSAlert()
        alert.messageText = "删除 \(draft.title)？"
        alert.informativeText = "旧链接将失效，但不会关闭终端或删除远端 tmux session。"
        alert.addButton(withTitle: "删除配置")
        alert.addButton(withTitle: "取消")
        if alert.runModal() == .alertFirstButtonReturn {
            perform("delete", payload: ["id": originalID])
        }
    }

    func copy(markdown: Bool = false) {
        let title = draft.title.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")
            .replacingOccurrences(of: "\n", with: " ")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(markdown ? "[\(title)](\(link))" : link, forType: .string)
        message = markdown ? "已复制 Markdown，可粘贴到 Obsidian。" : "已复制 URL。"
    }

    func launch(_ target: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let output = try Backend.execute(target, launch: true)
                DispatchQueue.main.async { self.message = String(data: output, encoding: .utf8) ?? "已打开" }
            } catch {
                DispatchQueue.main.async { self.error = error.localizedDescription }
            }
        }
    }
}

struct EditorView: View {
    @ObservedObject var store: CommandStore

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                Label("Terminal Jump", systemImage: "terminal.fill")
                    .font(.system(size: 20, weight: .semibold))
                Text("把命令变成一个链接").foregroundStyle(.secondary)
                HStack {
                    Button("新增", systemImage: "plus") { store.select(nil) }
                    Button("批量添加") {
                        if store.allowDiscard() { store.showBatch = true }
                    }
                }
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(store.entries) { entry in
                            Button { store.select(entry) } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(entry.title).fontWeight(.medium).lineLimit(1)
                                    Text(entry.id).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(store.originalID == entry.id ? Color.accentColor.opacity(0.14) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }.buttonStyle(.plain)
                        }
                    }
                }
                HStack {
                    Text("\(store.entries.count) 条命令").foregroundStyle(.secondary)
                    Spacer()
                    Button("刷新") { if store.allowDiscard() { store.perform("list") } }
                }.font(.caption)
            }
            .padding(20).frame(width: 238)
            .background(Color(nsColor: .controlBackgroundColor))
            Divider()
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text(store.originalID.isEmpty ? "新建命令" : "编辑命令").font(.title2.bold())
                    if store.dirty { Text("未保存").font(.caption).foregroundStyle(.orange) }
                    Spacer()
                    if store.busy { ProgressView().controlSize(.small) }
                }
                HStack {
                    VStack(alignment: .leading) {
                        Text("名称").font(.caption).foregroundStyle(.secondary)
                        TextField("例如：Retrieve 开发", text: $store.draft.title)
                    }
                    VStack(alignment: .leading) {
                        Text("链接 ID（新建时可留空自动生成）").font(.caption).foregroundStyle(.secondary)
                        TextField("demo-shell", text: $store.draft.id).disabled(!store.originalID.isEmpty)
                    }
                }
                Picker("执行方式", selection: $store.draft.mode) {
                    Text("SSH 远程指令").tag("ssh")
                    Text("本地 Shell 脚本").tag("shell")
                }.pickerStyle(.segmented)
                if store.draft.mode == "ssh" {
                    HStack {
                        Text("SSH 主机").frame(width: 82, alignment: .leading)
                        TextField("SSH 别名或 user@host", text: $store.draft.host)
                    }
                    Text("下面的多行指令都在远端执行，无需再写 ssh。")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("多行指令在本机 zsh 中顺序执行；不要把 ssh 登录与远端指令分写两行。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text(store.draft.mode == "ssh" ? "远端指令（支持多行）" : "本地脚本（支持多行）")
                    .font(.headline)
                CodeEditor(text: $store.draft.command)
                    .font(.system(size: 13, design: .monospaced))
                    .padding(8).frame(minHeight: 130)
                    .background(Color(nsColor: .textBackgroundColor))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.2)))
                HStack {
                    Text("本地目录").frame(width: 82, alignment: .leading)
                    TextField("可选，默认 ~", text: $store.draft.cwd)
                }
                HStack {
                    Image(systemName: "link").foregroundStyle(.teal)
                    Text(store.originalID.isEmpty ? "保存后自动生成 URL" : store.link)
                        .font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                    Spacer()
                    Button("复制 URL") { store.copy() }.disabled(!store.saved)
                    Button("复制 Markdown") { store.copy(markdown: true) }.disabled(!store.saved)
                }.padding(12).background(Color.teal.opacity(0.07)).cornerRadius(8)
                HStack {
                    if !store.originalID.isEmpty {
                        Button("删除", role: .destructive) { store.delete() }
                    }
                    Spacer()
                    Button("保存配置") { store.save() }.keyboardShortcut("s", modifiers: .command)
                    Button("打开终端") { store.launch(store.link) }
                        .buttonStyle(.borderedProminent).disabled(!store.saved)
                }
                Text(store.message).font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).lineLimit(3)
            }.padding(24).textFieldStyle(.roundedBorder)
        }
        .disabled(store.busy).tint(.teal)
        .frame(minWidth: 980, minHeight: 680)
        .sheet(isPresented: $store.showBatch) {
            VStack(alignment: .leading, spacing: 16) {
                Text("批量添加命令").font(.title2.bold())
                Text("每行一个独立入口，自动生成 ID。也可以使用：ID :: 完整命令")
                Text("例如：\ndemo-shell :: printf 'Hello terminal\\n'\ndemo-remote :: ssh -t demo-dev 'tmux -u a -t workspace'")
                    .font(.system(.callout, design: .monospaced)).foregroundStyle(.secondary)
                CodeEditor(text: $store.batchText).font(.system(size: 13, design: .monospaced))
                    .frame(height: 220).border(Color.secondary.opacity(0.2))
                Text("保存不会执行。已有 ID 不会被覆盖；任意一行出错则整批不保存。多行步骤请使用主窗口新建一个命令。")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Spacer()
                    Button("取消") { store.showBatch = false }
                    Button("全部保存") { store.perform("batch", payload: ["text": store.batchText]) }
                        .buttonStyle(.borderedProminent).disabled(store.batchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }.padding(24).frame(width: 650).disabled(store.busy)
        }
        .onChange(of: store.error) { _, value in
            guard let value else { return }
            let alert = NSAlert()
            alert.messageText = "操作未完成"
            alert.informativeText = value
            alert.runModal()
            store.error = nil
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let store = CommandStore()
    var window: NSWindow?
    var receivedURL = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let applicationItem = NSMenuItem()
        menu.addItem(applicationItem)
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "退出 Terminal Jump", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu
        let editItem = NSMenuItem()
        editItem.title = "编辑"
        let editMenu = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApp.mainMenu = menu
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            if !self.receivedURL { self.showWindow() }
        }
    }

    func showWindow() {
        NSApp.setActivationPolicy(.regular)
        if window == nil {
            let created = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1040, height: 720),
                                   styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            created.title = "Terminal Jump · 命令配置"
            created.contentView = NSHostingView(rootView: EditorView(store: store))
            created.isReleasedWhenClosed = false
            created.delegate = self
            created.center()
            window = created
            store.perform("list")
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        receivedURL = true
        for url in urls {
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    _ = try Backend.execute(url.absoluteString, launch: true)
                } catch {
                    DispatchQueue.main.async {
                        let alert = NSAlert()
                        alert.messageText = "无法打开终端"
                        alert.informativeText = error.localizedDescription
                        NSApp.activate(ignoringOtherApps: true)
                        alert.runModal()
                    }
                }
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { store.allowDiscard() }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if store.busy { return .terminateCancel }
        return store.allowDiscard() ? .terminateNow : .terminateCancel
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
