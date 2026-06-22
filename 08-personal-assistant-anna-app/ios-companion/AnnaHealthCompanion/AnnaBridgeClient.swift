import Foundation

@MainActor
final class AnnaBridgeClient: ObservableObject {
    @Published var bridgeURL = "http://YOUR_MAC_LAN_IP:8808/api/healthkit/snapshot"
    @Published var bridgeToken = ""
    @Published private(set) var statusLabel = "未同步"

    func applyPairingURL(_ url: URL) {
        guard url.scheme == "anna-healthkit", url.host == "pair" else {
            statusLabel = "Pairing 链接无效"
            return
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            statusLabel = "Pairing 链接无法解析"
            return
        }
        let items = Dictionary(uniqueKeysWithValues: components.queryItems?.compactMap { item in
            item.value.map { (item.name, $0) }
        } ?? [])
        guard let bridge = items["bridge_url"], let bridgeURL = URL(string: bridge) else {
            statusLabel = "Pairing 链接缺少 Bridge URL"
            return
        }
        guard Self.isAllowedBridgeURL(bridgeURL) else {
            statusLabel = "Bridge URL 必须是本地 Anna bridge"
            return
        }
        guard let token = items["token"], !token.isEmpty else {
            statusLabel = "Pairing 链接缺少 token"
            return
        }
        bridgeURL = bridge
        bridgeToken = token
        statusLabel = "已从 Pairing 链接配置"
    }

    private static func isAllowedBridgeURL(_ url: URL) -> Bool {
        guard url.scheme == "http",
              url.path == "/api/healthkit/snapshot",
              let host = url.host else {
            return false
        }
        if host == "localhost" || host.hasSuffix(".local") {
            return true
        }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else {
            return false
        }
        return parts[0] == 10 ||
            (parts[0] == 172 && (16...31).contains(parts[1])) ||
            (parts[0] == 192 && parts[1] == 168) ||
            (parts[0] == 127)
    }

    func send(snapshot: AnnaHealthSnapshot) async {
        guard let url = URL(string: bridgeURL) else {
            statusLabel = "Bridge URL 无效"
            return
        }
        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if !bridgeToken.isEmpty {
                request.setValue(bridgeToken, forHTTPHeaderField: "X-Anna-Bridge-Token")
            }
            request.httpBody = try JSONEncoder.bridgeEncoder.encode(BridgeSnapshot(snapshot: snapshot))
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                statusLabel = "Anna bridge 拒绝了快照"
                return
            }
            statusLabel = "已同步给 Anna"
        } catch {
            statusLabel = "同步失败：\(error.localizedDescription)"
        }
    }
}

private struct BridgeSnapshot: Encodable {
    let observed_at: String?
    let today_steps: Double?
    let heart_rate_bpm: Double?
    let sleep_minutes_last_night: Double?
    let sleep_samples: [BridgeSleepSample]
    let sleep_source: String
    let source: String
    let device_types: [String]

    init(snapshot: AnnaHealthSnapshot) {
        observed_at = snapshot.observedAt.map { ISO8601DateFormatter().string(from: $0) }
        today_steps = snapshot.todaySteps
        heart_rate_bpm = snapshot.heartRateBpm
        sleep_minutes_last_night = snapshot.sleepMinutesLastNight
        sleep_samples = snapshot.sleepSamples.map(BridgeSleepSample.init)
        sleep_source = snapshot.sleepSource
        source = snapshot.source
        device_types = ["iphone", "apple_watch"]
    }
}

private struct BridgeSleepSample: Encodable {
    let start_at: String
    let end_at: String
    let value: String
    let minutes: Double
    let source: String

    init(sample: AnnaSleepSample) {
        start_at = ISO8601DateFormatter().string(from: sample.startDate)
        end_at = ISO8601DateFormatter().string(from: sample.endDate)
        value = sample.value
        minutes = sample.minutes
        source = sample.source
    }
}

private extension JSONEncoder {
    static var bridgeEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
