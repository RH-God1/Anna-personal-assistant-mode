import Foundation

struct AnnaHealthSnapshot: Codable, Equatable {
    var observedAt: Date?
    var todaySteps: Double?
    var heartRateBpm: Double?
    var sleepMinutesLastNight: Double?
    var sleepSamples: [AnnaSleepSample]
    var sleepSource: String
    var source: String

    static let empty = AnnaHealthSnapshot(
        observedAt: nil,
        todaySteps: nil,
        heartRateBpm: nil,
        sleepMinutesLastNight: nil,
        sleepSamples: [],
        sleepSource: "HealthKit",
        source: "Anna iOS HealthKit Companion"
    )

    var isComplete: Bool {
        observedAt != nil &&
        todaySteps != nil &&
        heartRateBpm != nil &&
        sleepMinutesLastNight != nil
    }

    var stepsText: String {
        guard let todaySteps else { return "Not read" }
        return "\(Int(todaySteps.rounded())) steps"
    }

    var heartRateText: String {
        guard let heartRateBpm else { return "Not read" }
        return "\(Int(heartRateBpm.rounded())) bpm"
    }

    var sleepText: String {
        guard let sleepMinutesLastNight else { return "Not read" }
        let total = Int(sleepMinutesLastNight.rounded())
        return "\(total / 60)h \(total % 60)m"
    }

    var latestSleepSampleText: String {
        sleepSamples.first?.displayText ?? "No sleep sample read"
    }
}
