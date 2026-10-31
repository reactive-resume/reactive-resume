import Foundation

@main
struct IncomingShareTest {
  static func main() throws {
    let name = "rx74-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    let store = PendingPostingStore(defaults: defaults)
    let now = Date()
    let raw = SharePayload(type: .text, value: "Fictional posting", mimeType: "text/plain", metadata: nil)
    store.setContext(scope: "[server,alice]", server: "https://resume.example.test", now: now)
    let alice = store.context(now: now)!
    precondition(alice.scope != "[server,alice]")
    precondition(store.save([raw], for: alice, now: now))
    // Ordinary process recreation and same-account hydration preserve pending data until one-shot consumption.
    let reopened = PendingPostingStore(defaults: UserDefaults(suiteName: name)!)
    reopened.setContext(scope: "[server,alice]", server: "https://resume.example.test", now: now)
    precondition(reopened.consume(now: now).first?.value == raw.value)
    precondition(reopened.consume(now: now).isEmpty)
    precondition(store.save([raw], for: alice, now: now))
    store.discard() // Share cancellation / explicit review dismissal.
    precondition(store.consume(now: now).isEmpty)
    precondition(store.save([raw], for: alice, now: now))
    precondition(store.consume(now: now.addingTimeInterval(901)).isEmpty)
    precondition(store.save([raw], for: alice, now: now))
    precondition(store.save([raw], for: alice, now: now))
    precondition(store.consume(now: now.addingTimeInterval(-1)).isEmpty)
    store.setContext(scope: "[server,bob]", server: "https://resume.example.test", now: now)
    precondition(store.consume(now: now).isEmpty)
    precondition(!store.save([raw], for: alice, now: now)) // identity changed during NSItemProvider loading.
    let bob = store.context(now: now)!
    precondition(store.save([raw], for: bob, now: now))
    store.setContext(scope: "[other-server,bob]", server: "https://other.example.test", now: now)
    precondition(store.consume(now: now).isEmpty)
    store.setContext(scope: nil, server: nil, now: now)
    precondition(store.context(now: now) == nil)
    precondition(!store.save([raw], for: bob, now: now))
    store.setContext(scope: "[server,alice]", server: "https://resume.example.test", now: now)
    precondition(store.context(now: now.addingTimeInterval(86_401)) == nil)
    let file = SharePayload(type: .file, value: "file:///private/secret", mimeType: "text/plain", metadata: nil)
    precondition(!store.save([file], for: alice, now: now))
    precondition(!store.save([raw, raw, raw], for: alice, now: now))
    let huge = SharePayload(type: .text, value: String(repeating: "x", count: 100_001), mimeType: "text/plain", metadata: nil)
    precondition(!store.save([huge], for: alice, now: now))
    print("Native app-group pending store passed: completion/reopen, one shot, cancellation, stale/future limits, account/server/disconnect, in-flight identity, raw payload constraints.")
  }
}
