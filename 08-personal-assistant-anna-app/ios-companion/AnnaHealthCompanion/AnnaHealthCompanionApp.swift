import SwiftUI

@main
struct AnnaHealthCompanionApp: App {
    @StateObject private var healthKit = HealthKitManager()
    @StateObject private var bridge = AnnaBridgeClient()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(healthKit)
                .environmentObject(bridge)
        }
    }
}
