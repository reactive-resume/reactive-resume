import ExpoModulesCore
import UIKit
import ObjectiveC

private let keyCommandPressed = Notification.Name("ReactiveResumeKeyCommandPressed")

internal struct KeyCommandRecord: Record {
  @Field
  var id: String = ""

  @Field
  var input: String = ""

  @Field
  var shift: Bool = false

  @Field
  var title: String = ""

  @Field
  var modifier: String = "primary"
}

// Hardware keyboard shortcuts: ⌘-commands on the root view controller, so they are in the responder chain of every
// screen and modal. They show in the ⌘-hold overlay. A focused text field keeps its own ⌘Z / ⇧⌘Z.
public class KeyCommandsModule: Module {
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("KeyCommands")

    Constant("supportsUnmodifiedCommands") { true }

    Events("onKeyCommand")

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: keyCommandPressed, object: nil, queue: .main
      ) { [weak self] notification in
        guard let id = notification.object as? String else { return }
        self?.sendEvent("onKeyCommand", ["id": id])
      }
    }

    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      let installed = self.installed
      let host = self.host
      DispatchQueue.main.async {
        PressTracker.commands = []
        installed.forEach { host?.removeKeyCommand($0) }
      }
    }

    Function("setCommands") { (commands: [KeyCommandRecord]) in
      DispatchQueue.main.async { self.install(commands) }
    }
  }

  private func install(_ commands: [KeyCommandRecord]) {
    installed.forEach { host?.removeKeyCommand($0) }
    let root = UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }
      .first
    PressTracker.install()
    installed = commands.map { record in
      let flags: UIKeyModifierFlags = record.modifier == "none"
        ? (record.shift || record.input == "?" ? [.shift] : [])
        : (record.shift ? [.command, .shift] : [.command])
      return UIKeyCommand(
        title: record.title,
        action: #selector(UIViewController.rr_keyCommandPressed(_:)),
        input: record.input == "enter" ? "\r" : record.input == "?" ? "/" : record.input,
        modifierFlags: flags,
        propertyList: record.id
      )
    }
    PressTracker.commands = installed.filter { !$0.modifierFlags.contains(.command) }
    installed.forEach { root?.addKeyCommand($0) }
    host = root
  }
}

private weak var firstResponder: UIResponder?

extension UIResponder {
  @objc fileprivate func rr_reportFirstResponder(_ sender: Any?) {
    firstResponder = self
  }
}

extension UIViewController {
  @objc fileprivate func rr_canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(UIViewController.rr_keyCommandPressed(_:)),
      let command = sender as? UIKeyCommand,
      !command.modifierFlags.contains(.command), textInputHasFocus() { return false }
    return rr_canPerformAction(action, withSender: sender)
  }

  // Any view controller in the chain can receive the action; they all forward it to the module.
  @objc func rr_keyCommandPressed(_ sender: UIKeyCommand) {
    let editing = textInputHasFocus()
    let bare = !sender.modifierFlags.contains(.command)
    // Bare keys never intercept text/IME. UIKeyCommand has no repeat flag; claim a hardware press once until release.
    if bare && (editing || !PressTracker.claim(sender)) { return }
    // ⌘Z / ⇧⌘Z in a focused text field undo the typing, not the document.
    if sender.input == "z" {
      if let editor = firstResponder, editor is UITextInput {
        if let undo = editor.undoManager {
          sender.modifierFlags.contains(.shift) ? undo.redo() : undo.undo()
        }
        return
      }
    }
    NotificationCenter.default.post(name: keyCommandPressed, object: sender.propertyList as? String)
  }
}

private func textInputHasFocus() -> Bool {
  firstResponder = nil
  UIApplication.shared.sendAction(#selector(UIResponder.rr_reportFirstResponder(_:)), to: nil, from: nil, for: nil)
  return firstResponder is UITextInput
}

// Observe public UIKit press events without consuming them. UIKeyCommand actions still own dispatch; this only
// supplies the press/release identity UIKit omits from those actions, including when a text field consumes key-up.
private enum PressTracker {
  static var installed = false
  static var backgroundObserver: NSObjectProtocol?
  static var commands: [UIKeyCommand] = []
  static var held: [Int: (key: UIKey, claimed: Bool)] = [:]
  static let modifiers: UIKeyModifierFlags = [.command, .control, .alternate, .shift]

  static func install() {
    guard !installed,
      let original = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.sendEvent(_:))),
      let tracking = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.rr_trackPresses(_:)))
    else { return }
    method_exchangeImplementations(original, tracking)
    let action = #selector(UIViewController.canPerformAction(_:withSender:))
    if let inherited = class_getInstanceMethod(UIViewController.self, action),
      let checking = class_getInstanceMethod(UIViewController.self, #selector(UIViewController.rr_canPerformAction(_:withSender:))) {
      // Materialize an inherited method on this class before exchanging; never change UIResponder's implementation.
      class_addMethod(UIViewController.self, action, method_getImplementation(inherited), method_getTypeEncoding(inherited))
      if let original = class_getInstanceMethod(UIViewController.self, action) {
        method_exchangeImplementations(original, checking)
      }
    }
    backgroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
    ) { _ in held.removeAll() }
    installed = true
  }

  static func matches(_ key: UIKey, _ command: UIKeyCommand) -> Bool {
    key.charactersIgnoringModifiers.lowercased() == command.input &&
      key.modifierFlags.intersection(modifiers) == command.modifierFlags
  }

  static func claim(_ command: UIKeyCommand) -> Bool {
    guard let press = held.first(where: { matches($0.value.key, command) }),
      !press.value.claimed else { return false }
    held[press.key] = (press.value.key, true)
    return true
  }
}

extension UIApplication {
  @objc fileprivate func rr_trackPresses(_ event: UIEvent) {
    let presses = (event as? UIPressesEvent)?.allPresses ?? []
    for press in presses where press.phase == .began {
      if let key = press.key, PressTracker.held[key.keyCode.rawValue] == nil {
        let eligible = !textInputHasFocus() && PressTracker.commands.contains { PressTracker.matches(key, $0) }
        PressTracker.held[key.keyCode.rawValue] = (key, !eligible)
      }
    }
    rr_trackPresses(event)
    for press in presses where press.phase == .ended || press.phase == .cancelled {
      if let key = press.key { PressTracker.held.removeValue(forKey: key.keyCode.rawValue) }
    }
  }
}
