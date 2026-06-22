import Foundation
import HealthKit

struct AnnaSleepSample: Codable, Equatable, Identifiable {
    var id: String { "\(startDate.timeIntervalSince1970)-\(endDate.timeIntervalSince1970)-\(value)" }
    let startDate: Date
    let endDate: Date
    let value: String
    let minutes: Double
    let source: String

    var displayText: String {
        let total = Int(minutes.rounded())
        return "\(value) · \(total / 60)h \(total % 60)m · \(startDate.formatted(date: .omitted, time: .shortened))-\(endDate.formatted(date: .omitted, time: .shortened))"
    }
}

@MainActor
final class HealthKitManager: ObservableObject {
    @Published private(set) var isHealthDataAvailable = false
    @Published private(set) var isAuthorized = false
    @Published private(set) var authorizationLabel = "Not checked"
    @Published private(set) var todaySteps: Double?
    @Published private(set) var latestHeartRateBpm: Double?
    @Published private(set) var sleepSamples: [AnnaSleepSample] = []
    @Published private(set) var snapshot = AnnaHealthSnapshot.empty

    private let store = HKHealthStore()

    func refreshAvailability() async {
        isHealthDataAvailable = HKHealthStore.isHealthDataAvailable()
        authorizationLabel = isHealthDataAvailable
            ? "HealthKit available. Permission not requested."
            : "HealthKit is not available on this device."
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationLabel = "HealthKit is not available on this device."
            return
        }

        do {
            try await store.requestAuthorization(toShare: [], read: Self.readTypes)
            isAuthorized = true
            authorizationLabel = "Health permission requested. Apple controls the final per-type grant."
        } catch {
            isAuthorized = false
            authorizationLabel = "Health permission failed: \(error.localizedDescription)"
        }
    }

    func refreshSnapshot() async {
        guard isAuthorized else {
            authorizationLabel = "Request Health permission first."
            return
        }

        async let steps = fetchTodaySteps()
        async let heartRate = fetchLatestHeartRate()
        async let sleep = fetchSleepSamples()

        todaySteps = await steps
        latestHeartRateBpm = await heartRate
        sleepSamples = await sleep

        snapshot = AnnaHealthSnapshot(
            observedAt: Date(),
            todaySteps: todaySteps,
            heartRateBpm: latestHeartRateBpm,
            sleepMinutesLastNight: sleepSamples.reduce(0.0) { total, sample in
                total + sample.minutes
            },
            sleepSamples: sleepSamples,
            sleepSource: "HealthKit",
            source: "Anna iOS HealthKit Companion"
        )
    }

    func fetchTodaySteps() async -> Double? {
        guard let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            return nil
        }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(
            withStart: startOfDay,
            end: Date(),
            options: [.strictStartDate]
        )

        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: stepType,
                quantitySamplePredicate: predicate,
                options: [.cumulativeSum]
            ) { _, statistics, _ in
                let steps = statistics?
                    .sumQuantity()?
                    .doubleValue(for: HKUnit.count())
                continuation.resume(returning: steps)
            }
            store.execute(query)
        }
    }

    func fetchLatestHeartRate() async -> Double? {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            return nil
        }

        let sort = NSSortDescriptor(
            key: HKSampleSortIdentifierEndDate,
            ascending: false
        )

        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: heartRateType,
                predicate: nil,
                limit: 1,
                sortDescriptors: [sort]
            ) { _, samples, _ in
                let bpm = (samples?.first as? HKQuantitySample)?
                    .quantity
                    .doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                continuation.resume(returning: bpm)
            }
            store.execute(query)
        }
    }

    func fetchSleepSamples() async -> [AnnaSleepSample] {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            return []
        }

        let calendar = Calendar.current
        let end = Date()
        let start = calendar.date(byAdding: .hour, value: -36, to: end) ?? end
        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: end,
            options: [.strictStartDate]
        )
        let sort = NSSortDescriptor(
            key: HKSampleSortIdentifierEndDate,
            ascending: false
        )

        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, _ in
                let sleepSamples = (samples as? [HKCategorySample] ?? [])
                    .filter(Self.isAsleepSample)
                    .map { sample in
                        AnnaSleepSample(
                            startDate: sample.startDate,
                            endDate: sample.endDate,
                            value: Self.sleepValueLabel(sample.value),
                            minutes: sample.endDate.timeIntervalSince(sample.startDate) / 60.0,
                            source: sample.sourceRevision.source.name
                        )
                    }
                continuation.resume(returning: sleepSamples)
            }
            store.execute(query)
        }
    }

    private static var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        if let steps = HKObjectType.quantityType(forIdentifier: .stepCount) {
            types.insert(steps)
        }
        if let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) {
            types.insert(heartRate)
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleep)
        }
        return types
    }

    private static func isAsleepSample(_ sample: HKCategorySample) -> Bool {
        if #available(iOS 16.0, *) {
            return sample.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue ||
                sample.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue ||
                sample.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue ||
                sample.value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
        }
        return sample.value == HKCategoryValueSleepAnalysis.asleep.rawValue
    }

    private static func sleepValueLabel(_ value: Int) -> String {
        if #available(iOS 16.0, *) {
            switch value {
            case HKCategoryValueSleepAnalysis.asleepCore.rawValue:
                return "Core sleep"
            case HKCategoryValueSleepAnalysis.asleepDeep.rawValue:
                return "Deep sleep"
            case HKCategoryValueSleepAnalysis.asleepREM.rawValue:
                return "REM sleep"
            case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue:
                return "Asleep"
            default:
                return "Sleep"
            }
        }
        return "Asleep"
    }
}
