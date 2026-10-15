# NetSpeedBar

> This repo also contains **[PureFrame](pureframe/)**, a marketplace product photo checker and fixer with a paid Pro edition. See [pureframe/LAUNCH.md](pureframe/LAUNCH.md).

A small macOS menu bar app that shows your live **ping**, plus **download / upload speed** from the last speed test.

```
18 ms · ↓245 ↑32
```

Click the menu bar item to open a panel with:

- **Ping**: the current round-trip time (with a color dot), average, jitter, packet loss, and a chart of the last 60 pings.
- **Speed**: download and upload in Mbps, idle latency, responsiveness (RPM), the interface used, and when the test ran.
- **Run Speed Test** button, which you can cancel while a test is running.
- **Settings**: ping host (default `1.1.1.1`), ping interval, automatic speed tests (off / 15 min to 6 h), what the menu bar shows, and launch at login.

The ping comes from `/sbin/ping`. The speed test uses Apple's built-in `networkQuality` tool, which tests against Apple's CDN, so you don't need an account or API key. A test takes about 20 seconds and uses real bandwidth. That's why automatic tests are off by default. The app runs one test on first launch so the menu bar has a number to show.

## Requirements

- macOS 13 Ventura or later
- To build it yourself: Xcode or the Command Line Tools (`xcode-select --install`)

## Build & run

```sh
./scripts/build-app.sh --install   # builds build/NetSpeedBar.app, copies it to /Applications and launches it
```

Leave out `--install` to just build `build/NetSpeedBar.app`. During development, `swift run` also works.

### Prebuilt download

Every push builds a universal (Apple Silicon + Intel) app on GitHub Actions. Download `NetSpeedBar.zip` from a run's **Artifacts** section and unzip it. The app is ad-hoc signed and not notarized, so macOS will block the first launch. Clear the quarantine flag once:

```sh
xattr -dr com.apple.quarantine NetSpeedBar.app
```

Alternatively, right-click the app → **Open**.
