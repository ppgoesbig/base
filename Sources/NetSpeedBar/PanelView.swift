import Charts
import SwiftUI

struct PanelView: View {
    @ObservedObject var monitor: NetworkMonitor
    @State private var showSettings = false
    @State private var hostDraft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            pingSection
            Divider()
            speedSection
            Divider()
            DisclosureGroup("Settings", isExpanded: $showSettings) {
                settings.padding(.top, 8)
            }
            Divider()
            HStack {
                Spacer()
                Button("Quit NetSpeedBar") { NSApplication.shared.terminate(nil) }
                    .keyboardShortcut("q")
            }
        }
        .padding(16)
        .frame(width: 310)
        .onAppear { hostDraft = monitor.pingHost }
        .onDisappear(perform: commitHost)
    }

    // MARK: - Ping

    private var pingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Ping", systemImage: "dot.radiowaves.left.and.right")
                    .font(.headline)
                Spacer()
                Text(monitor.effectiveHost)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                Circle()
                    .fill(pingColor(monitor.pings.last))
                    .frame(width: 10, height: 10)
                Text(currentPingText)
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    stat("avg", monitor.averagePing.map(Fmt.ms))
                    stat("jitter", monitor.jitter.map(Fmt.ms))
                    stat("loss", monitor.packetLoss.map { String(format: "%.0f%%", $0 * 100) })
                }
            }

            if monitor.chartPoints.count > 1 {
                Chart(monitor.chartPoints) { point in
                    LineMark(x: .value("Time", point.date), y: .value("Ping", point.ms))
                        .interpolationMethod(.monotone)
                }
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 3))
                }
                .frame(height: 60)
            }
        }
    }

    private var currentPingText: String {
        guard let sample = monitor.pings.last else { return "…" }
        return sample.ms.map(Fmt.ms) ?? "Timeout"
    }

    private func pingColor(_ sample: PingSample?) -> Color {
        guard let sample else { return .gray }
        guard let ms = sample.ms else { return .red }
        return ms < 50 ? .green : ms < 150 ? .yellow : .red
    }

    private func stat(_ name: String, _ value: String?) -> some View {
        HStack(spacing: 4) {
            Text(name).foregroundStyle(.secondary)
            Text(value ?? "–").monospacedDigit()
        }
        .font(.caption)
    }

    // MARK: - Speed

    private var speedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Speed", systemImage: "speedometer")
                    .font(.headline)
                Spacer()
                if let interface = monitor.lastSpeed?.interface {
                    Text(interface)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 16) {
                speedTile("Download", systemImage: "arrow.down.circle.fill",
                          value: monitor.lastSpeed?.download, tint: .blue)
                speedTile("Upload", systemImage: "arrow.up.circle.fill",
                          value: monitor.lastSpeed?.upload, tint: .purple)
            }

            if let result = monitor.lastSpeed {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        if let latency = result.latency {
                            Text("Idle latency \(Fmt.ms(latency))")
                        }
                        Spacer()
                        Text("Tested \(Text(result.date, style: .relative)) ago")
                    }
                    if let rpm = result.responsiveness {
                        Text("Responsiveness \(Int(rpm)) RPM")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if let error = monitor.speedError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if monitor.isTesting {
                HStack {
                    ProgressView().controlSize(.small)
                    Text("Testing… this takes ~20 s")
                        .font(.callout)
                    Spacer()
                    Button("Cancel", action: monitor.cancelSpeedTest)
                }
            } else {
                Button(action: monitor.startSpeedTest) {
                    Label("Run Speed Test", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
    }

    private func speedTile(_ title: String, systemImage: String, value: Double?, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: systemImage)
                .font(.caption)
                .foregroundStyle(tint)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value.map(Fmt.mbps) ?? "–")
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                Text("Mbps")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Settings

    private var settings: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Ping host")
                TextField(NetworkMonitor.defaultHost, text: $hostDraft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(commitHost)
            }

            Picker("Ping every", selection: $monitor.pingInterval) {
                ForEach([1.0, 2, 5, 10, 30], id: \.self) { seconds in
                    Text("\(Int(seconds)) s").tag(seconds)
                }
            }

            Picker("Auto speed test", selection: $monitor.autoTestMinutes) {
                Text("Off").tag(0)
                Text("Every 15 min").tag(15)
                Text("Every 30 min").tag(30)
                Text("Every hour").tag(60)
                Text("Every 6 hours").tag(360)
            }

            Picker("Menu bar shows", selection: $monitor.display) {
                ForEach(MenuBarDisplay.allCases) { option in
                    Text(option.label).tag(option)
                }
            }

            Toggle("Launch at login", isOn: $monitor.launchAtLogin)
        }
    }

    private func commitHost() {
        monitor.pingHost = hostDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
