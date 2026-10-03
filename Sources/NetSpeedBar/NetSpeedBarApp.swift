import SwiftUI

@main
struct NetSpeedBarApp: App {
    @StateObject private var monitor = NetworkMonitor()

    init() {
        // No Dock icon, even when launched outside the .app bundle (e.g. `swift run`).
        NSApplication.shared.setActivationPolicy(.accessory)
    }

    var body: some Scene {
        MenuBarExtra {
            PanelView(monitor: monitor)
        } label: {
            MenuBarLabel(monitor: monitor)
        }
        .menuBarExtraStyle(.window)
    }
}

struct MenuBarLabel: View {
    @ObservedObject var monitor: NetworkMonitor

    var body: some View {
        Text(monitor.menuBarTitle)
            .monospacedDigit()
    }
}
