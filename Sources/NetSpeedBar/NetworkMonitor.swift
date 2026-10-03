import Foundation
import ServiceManagement

struct PingSample: Identifiable {
    let id = UUID()
    let date: Date
    let ms: Double?  // nil = packet lost
}

struct ChartPoint: Identifiable {
    let id: UUID
    let date: Date
    let ms: Double
}

struct SpeedResult: Codable {
    var download: Double  // Mbps
    var upload: Double  // Mbps
    var latency: Double?  // idle RTT, ms
    var responsiveness: Double?  // round-trips per minute under load
    var interface: String?
    var date: Date
}

enum MenuBarDisplay: String, CaseIterable, Identifiable {
    case pingAndSpeed, ping, speed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pingAndSpeed: "Ping + Speed"
        case .ping: "Ping only"
        case .speed: "Speed only"
        }
    }
}

@MainActor
final class NetworkMonitor: ObservableObject {
    static let historyLimit = 60
    static let defaultHost = "1.1.1.1"

    private enum Key {
        static let pingHost = "pingHost"
        static let pingInterval = "pingInterval"
        static let autoTestMinutes = "autoTestMinutes"
        static let display = "display"
        static let lastSpeed = "lastSpeed"
    }

    @Published private(set) var pings: [PingSample] = []
    @Published private(set) var lastSpeed: SpeedResult?
    @Published private(set) var isTesting = false
    @Published private(set) var speedError: String?

    @Published var pingHost: String {
        didSet {
            guard pingHost != oldValue else { return }
            UserDefaults.standard.set(pingHost, forKey: Key.pingHost)
            pings.removeAll()
            startPingLoop()
        }
    }

    @Published var pingInterval: Double {
        didSet {
            guard pingInterval != oldValue else { return }
            UserDefaults.standard.set(pingInterval, forKey: Key.pingInterval)
            startPingLoop()
        }
    }

    @Published var autoTestMinutes: Int {
        didSet {
            guard autoTestMinutes != oldValue else { return }
            UserDefaults.standard.set(autoTestMinutes, forKey: Key.autoTestMinutes)
            startAutoTestLoop()
        }
    }

    @Published var display: MenuBarDisplay {
        didSet { UserDefaults.standard.set(display.rawValue, forKey: Key.display) }
    }

    private var pingTask: Task<Void, Never>?
    private var autoTestTask: Task<Void, Never>?
    private var speedTask: Task<Void, Never>?

    init() {
        let defaults = UserDefaults.standard
        defaults.register(defaults: [
            Key.pingHost: Self.defaultHost,
            Key.pingInterval: 5.0,
            Key.autoTestMinutes: 0,
            Key.display: MenuBarDisplay.pingAndSpeed.rawValue,
        ])
        pingHost = defaults.string(forKey: Key.pingHost) ?? Self.defaultHost
        pingInterval = defaults.double(forKey: Key.pingInterval)
        autoTestMinutes = defaults.integer(forKey: Key.autoTestMinutes)
        display = MenuBarDisplay(rawValue: defaults.string(forKey: Key.display) ?? "") ?? .pingAndSpeed
        if let data = defaults.data(forKey: Key.lastSpeed) {
            lastSpeed = try? JSONDecoder().decode(SpeedResult.self, from: data)
        }

        startPingLoop()
        startAutoTestLoop()
        if lastSpeed == nil { startSpeedTest() }
    }

    // MARK: - Derived values

    /// The host actually pinged; never passes something that `ping` could read as a flag.
    var effectiveHost: String {
        let host = pingHost.trimmingCharacters(in: .whitespacesAndNewlines)
        return host.isEmpty || host.hasPrefix("-") ? Self.defaultHost : host
    }

    var receivedPings: [Double] { pings.compactMap(\.ms) }

    var chartPoints: [ChartPoint] {
        pings.compactMap { sample in
            sample.ms.map { ChartPoint(id: sample.id, date: sample.date, ms: $0) }
        }
    }

    var averagePing: Double? {
        let values = receivedPings
        return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
    }

    /// Mean absolute difference between consecutive successful pings.
    var jitter: Double? {
        let values = receivedPings
        guard values.count > 1 else { return nil }
        let diffs = zip(values, values.dropFirst()).map { abs($1 - $0) }
        return diffs.reduce(0, +) / Double(diffs.count)
    }

    var packetLoss: Double? {
        guard !pings.isEmpty else { return nil }
        return Double(pings.count - receivedPings.count) / Double(pings.count)
    }

    var menuBarTitle: String {
        let ping: String
        if let sample = pings.last {
            ping = sample.ms.map(Fmt.ms) ?? "timeout"
        } else {
            ping = "… ms"
        }

        let speed: String
        if isTesting {
            speed = "testing…"
        } else if let result = lastSpeed {
            speed = "↓\(Fmt.compactMbps(result.download)) ↑\(Fmt.compactMbps(result.upload))"
        } else {
            speed = "↓– ↑–"
        }

        switch display {
        case .pingAndSpeed: return "\(ping) · \(speed)"
        case .ping: return ping
        case .speed: return speed
        }
    }

    var launchAtLogin: Bool {
        get { SMAppService.mainApp.status == .enabled }
        set {
            objectWillChange.send()
            do {
                if newValue {
                    try SMAppService.mainApp.register()
                } else {
                    try SMAppService.mainApp.unregister()
                }
            } catch {
                NSLog("NetSpeedBar: launch at login change failed: \(error)")
            }
        }
    }

    // MARK: - Speed test

    func startSpeedTest() {
        guard !isTesting else { return }
        isTesting = true
        speedError = nil
        speedTask = Task {
            defer {
                isTesting = false
                speedTask = nil
            }
            do {
                let result = try await SpeedTest.run()
                lastSpeed = result
                if let data = try? JSONEncoder().encode(result) {
                    UserDefaults.standard.set(data, forKey: Key.lastSpeed)
                }
            } catch {
                if !Task.isCancelled { speedError = error.localizedDescription }
            }
        }
    }

    func cancelSpeedTest() {
        speedTask?.cancel()
    }

    // MARK: - Loops

    private func startPingLoop() {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.pingOnce()
                try? await Task.sleep(for: .seconds(max(1, self.pingInterval)))
            }
        }
    }

    private func pingOnce() async {
        let ms = await Pinger.ping(host: effectiveHost)
        guard !Task.isCancelled else { return }
        pings.append(PingSample(date: .now, ms: ms))
        if pings.count > Self.historyLimit {
            pings.removeFirst(pings.count - Self.historyLimit)
        }
    }

    private func startAutoTestLoop() {
        autoTestTask?.cancel()
        guard autoTestMinutes > 0 else { return }
        autoTestTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let minutes = self?.autoTestMinutes, minutes > 0 else { return }
                try? await Task.sleep(for: .seconds(Double(minutes) * 60))
                guard !Task.isCancelled else { return }
                self?.startSpeedTest()
            }
        }
    }
}

enum Fmt {
    static func ms(_ value: Double) -> String {
        value < 10 ? String(format: "%.1f ms", value) : String(format: "%.0f ms", value)
    }

    static func mbps(_ value: Double) -> String {
        value < 10 ? String(format: "%.1f", value) : String(format: "%.0f", value)
    }

    /// Short form for the menu bar: 1.2G instead of 1234.
    static func compactMbps(_ value: Double) -> String {
        value >= 1000 ? String(format: "%.1fG", value / 1000) : mbps(value)
    }
}
