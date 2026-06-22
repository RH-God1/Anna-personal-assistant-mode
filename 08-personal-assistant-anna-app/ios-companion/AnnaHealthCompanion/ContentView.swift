import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var healthKit: HealthKitManager
    @EnvironmentObject private var bridge: AnnaBridgeClient
    @State private var liveSyncTask: Task<Void, Never>?
    @State private var isLiveSyncing = false
    @State private var liveSyncStatus = "未启动"
    @State private var lastLiveSyncAt: Date?

    private let liveSyncIntervalNanoseconds: UInt64 = 300_000_000_000

    var body: some View {
        NavigationStack {
            Form {
                Section("HealthKit") {
                    LabeledContent("Permission", value: healthKit.authorizationLabel)
                    Button("Request Health Permission") {
                        Task { await healthKit.requestAuthorization() }
                    }
                    .disabled(!healthKit.isHealthDataAvailable)
                }

                Section("Today Health Data") {
                    LabeledContent("今日步数", value: healthKit.snapshot.stepsText)
                    LabeledContent("最近心率", value: healthKit.snapshot.heartRateText)
                    LabeledContent("最近睡眠记录", value: healthKit.snapshot.latestSleepSampleText)
                    Button("Read Today Health Data") {
                        Task { await healthKit.refreshSnapshot() }
                    }
                    .disabled(!healthKit.isAuthorized)
                }

                Section("Privacy") {
                    Text("This first-stage companion reads only today's steps, latest heart rate, and sleep samples after Apple HealthKit permission. It does not write Health data.")
                    Text("No Health data is uploaded to a server unless you explicitly enable a later backend sync feature.")
                }

                Section("Optional Local Anna Bridge") {
                    TextField("Bridge URL", text: $bridge.bridgeURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Bridge Token", text: $bridge.bridgeToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    LabeledContent("同步状态", value: bridge.statusLabel)
                    LabeledContent("实时同步", value: liveSyncStatus)
                    LabeledContent("上次同步", value: lastLiveSyncText)
                    Button("发送快照给 Anna") {
                        Task { await bridge.send(snapshot: healthKit.snapshot) }
                    }
                    .disabled(!healthKit.snapshot.isComplete)
                    Button(isLiveSyncing ? "停止前台实时同步" : "开始前台实时同步") {
                        toggleLiveSync()
                    }
                    .disabled(!healthKit.isAuthorized)
                }
            }
            .navigationTitle("Anna Health")
            .task {
                await healthKit.refreshAvailability()
            }
            .onDisappear {
                stopLiveSync()
            }
            .onOpenURL { url in
                bridge.applyPairingURL(url)
            }
        }
    }

    private func toggleLiveSync() {
        if isLiveSyncing {
            stopLiveSync()
        } else {
            startLiveSync()
        }
    }

    private func startLiveSync() {
        guard liveSyncTask == nil else { return }
        isLiveSyncing = true
        liveSyncStatus = "运行中"
        liveSyncTask = Task {
            while !Task.isCancelled {
                await healthKit.refreshSnapshot()
                if healthKit.snapshot.isComplete {
                    await bridge.send(snapshot: healthKit.snapshot)
                    lastLiveSyncAt = Date()
                    liveSyncStatus = "运行中"
                } else {
                    liveSyncStatus = "等待完整 HealthKit 快照"
                }
                try? await Task.sleep(nanoseconds: liveSyncIntervalNanoseconds)
            }
        }
    }

    private func stopLiveSync() {
        liveSyncTask?.cancel()
        liveSyncTask = nil
        isLiveSyncing = false
        liveSyncStatus = "已停止"
    }

    private var lastLiveSyncText: String {
        guard let lastLiveSyncAt else {
            return "尚未同步"
        }
        return lastLiveSyncAt.formatted(date: .omitted, time: .shortened)
    }
}
