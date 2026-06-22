# Anna HealthKit Companion

This folder contains the minimal iOS-side source needed to bind Anna Personal Assistant
Mode to Apple Health through the official HealthKit authorization path.

## What It Does

- Requests read-only HealthKit authorization for today's steps, latest heart rate, and sleep analysis.
- Reads a minimal current snapshot from HealthKit.
- Sends the snapshot to a local Anna bridge endpoint in the same shape expected by the Node provider contract.
- Can keep sending refreshed snapshots while the companion remains open in the foreground.
- Keeps diagnosis and medical interpretation out of the app.
- Does not write Apple Health data and does not upload HealthKit data to a server unless a later backend sync feature is explicitly enabled.

## What Still Requires Xcode And The Phone

The current machine only has Command Line Tools, not full Xcode, so this repo cannot compile or
install the iOS app here. To run on your iPhone:

1. Install full Xcode.
2. Open `AnnaHealthCompanion.xcodeproj`.
3. Select the `AnnaHealthCompanion` target.
4. Set a signing team and, if needed, a bundle identifier you control.
5. Confirm the HealthKit capability is enabled in Signing & Capabilities and through `AnnaHealthCompanion.entitlements`.
6. Run on your iPhone.
7. Confirm `Info.plist` contains the Health usage descriptions for reading today's steps, latest heart rate, and sleep data.
8. Tap "Request Health Permission" and approve the Health app system prompt.
9. Tap "Read Today Health Data".
10. Paste the Bridge URL/token manually, or open the `anna-healthkit://pair?...` pairing link from `npm run healthkit:bind` on the iPhone.
11. Send the snapshot to Anna bridge, and approve the iOS local network prompt if it appears.
12. For live testing, tap "开始前台实时同步". Keep the companion open while testing; background sync needs a separate Apple background-mode design.
13. Watch the "实时同步" and "上次同步" rows to confirm that foreground sync is running and that Anna received a recent snapshot.

## Bridge Payload

The app posts JSON to your Mac's LAN bridge endpoint. Do not use `127.0.0.1` on the
iPhone, because that points to the phone itself.

```text
http://YOUR_MAC_LAN_IP:8808/api/healthkit/snapshot
```

Generate the bridge URL, token, and start command:

```bash
npm run healthkit:pairing
```

Pairing links are intentionally local-only. The companion accepts only `http` bridge
URLs whose path is `/api/healthkit/snapshot` and whose host is `localhost`, a `.local`
host, or a private LAN IPv4 address (`10.x.x.x`, `172.16.x.x` through `172.31.x.x`,
or `192.168.x.x`). The pairing script follows the same rule when printing iPhone
links.

Check whether the Mac-side pieces are ready:

```bash
npm run healthkit:doctor
```

`healthkit:doctor` reports the Xcode project, shared scheme, HealthKit entitlement,
local-network permissions, LAN address, full Xcode selection, Xcode.app candidates,
the iOS `simctl` toolchain, and local code-signing identities. A real iPhone install
needs full Xcode plus an Apple Development signing identity; Command Line Tools alone
cannot build or install the HealthKit companion.

To run the full local binding preflight in one command:

```bash
npm run healthkit:bind
```

This command runs the readiness checks, prints the bridge start command, prints the
iPhone Bridge URL, token, and `anna-healthkit://pair?...` link, and stops with explicit
blockers if full Xcode, the iOS toolchain, or code-signing identity are missing. After
those are resolved, rerun it or use `ANNA_OPEN_XCODE=1 npm run healthkit:bind` to open
the companion project.

The command prints one or more `http://YOUR_MAC_LAN_IP:8808/api/healthkit/snapshot`
URLs and a private bridge token. Start Anna's local preview with the printed command,
which uses an explicit LAN host and bridge token:

```bash
HOST=0.0.0.0 HEALTHKIT_BRIDGE_TOKEN=replace-with-a-long-random-token npm run serve
```

Then enter the same URL and token in the iOS companion.

The companion includes `NSLocalNetworkUsageDescription` and `NSAllowsLocalNetworking`
for development-time communication with your Mac on the same LAN.

Payload shape:

```json
{
  "observed_at": "2026-06-18T10:00:00Z",
  "today_steps": 6420,
  "heart_rate_bpm": 72,
  "sleep_minutes_last_night": 446,
  "sleep_samples": [],
  "sleep_source": "HealthKit",
  "source": "Anna iOS HealthKit Companion",
  "device_types": ["iphone", "apple_watch"]
}
```

The Node side already has the matching provider contract:

```js
readSnapshot({ observedAt, now, supportedDevices, sessionId? })
```

## Safety Boundary

Anna cannot and should not read the Health app until the user authorizes HealthKit on the
iPhone or Apple Watch. This companion is only the user-authorized bridge and reads only
today's steps, latest heart rate, and sleep samples in the first stage.
