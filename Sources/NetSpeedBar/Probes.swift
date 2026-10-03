import Foundation

struct AppError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct ShellResult {
    let status: Int32
    let output: String
}

enum Shell {
    /// Runs an executable (no shell involved) and returns its exit status and stdout.
    /// The process is terminated if it exceeds `timeout` or the calling task is cancelled.
    static func run(_ path: String, _ arguments: [String], timeout: TimeInterval) async throws -> ShellResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .utility).async {
                    do {
                        try process.run()
                    } catch {
                        continuation.resume(throwing: error)
                        return
                    }
                    let watchdog = DispatchWorkItem {
                        if process.isRunning { process.terminate() }
                    }
                    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: watchdog)
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit()
                    watchdog.cancel()
                    continuation.resume(returning: ShellResult(
                        status: process.terminationStatus,
                        output: String(decoding: data, as: UTF8.self)
                    ))
                }
            }
        } onCancel: {
            if process.isRunning { process.terminate() }
        }
    }
}

enum Pinger {
    /// Sends a single ICMP echo and returns the round-trip time in ms, or nil if it was lost.
    static func ping(host: String) async -> Double? {
        guard let result = try? await Shell.run("/sbin/ping", ["-c", "1", "-t", "2", "-n", host], timeout: 5),
              result.status == 0,
              let range = result.output.range(of: #"time[=<][0-9.]+ ms"#, options: .regularExpression)
        else { return nil }
        let digits = result.output[range]
            .drop(while: { !$0.isNumber })
            .prefix(while: { $0.isNumber || $0 == "." })
        return Double(digits)
    }
}

enum SpeedTest {
    static let tool = "/usr/bin/networkQuality"

    /// Runs Apple's built-in `networkQuality` tool (macOS 12+), which measures against Apple's CDN.
    static func run() async throws -> SpeedResult {
        guard FileManager.default.isExecutableFile(atPath: tool) else {
            throw AppError("networkQuality isn't available on this Mac.")
        }
        let result = try await Shell.run(tool, ["-c"], timeout: 120)
        return try parse(result.output)
    }

    static func parse(_ text: String) throws -> SpeedResult {
        let failure = AppError("Speed test failed — check your connection.")
        guard let start = text.firstIndex(of: "{"),
              let end = text.lastIndex(of: "}"),
              let json = try? JSONSerialization.jsonObject(with: Data(text[start...end].utf8)) as? [String: Any]
        else { throw failure }

        func number(_ key: String) -> Double? { (json[key] as? NSNumber)?.doubleValue }

        guard let down = number("dl_throughput"), let up = number("ul_throughput"), down > 0 || up > 0 else {
            throw failure
        }
        return SpeedResult(
            download: down / 1_000_000,
            upload: up / 1_000_000,
            latency: number("base_rtt"),
            responsiveness: number("responsiveness") ?? number("dl_responsiveness"),
            interface: json["interface_name"] as? String,
            date: .now
        )
    }
}
