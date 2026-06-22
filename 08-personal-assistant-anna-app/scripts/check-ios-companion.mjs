import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const companion = path.join(root, "ios-companion", "AnnaHealthCompanion");

const files = {
  content: await read("ContentView.swift"),
  manager: await read("HealthKitManager.swift"),
  bridge: await read("AnnaBridgeClient.swift"),
  snapshot: await read("AnnaHealthSnapshot.swift"),
  plist: await read("Info.plist"),
  entitlements: await read("AnnaHealthCompanion.entitlements"),
  project: await readProject(),
  scheme: await readScheme()
};

assert.match(files.manager, /import HealthKit/);
assert.match(files.manager, /requestAuthorization\(toShare:\s*\[\],\s*read:\s*Self\.readTypes\)/);
assert.match(files.manager, /\.stepCount/);
assert.match(files.manager, /\.heartRate/);
assert.match(files.manager, /\.sleepAnalysis/);
assert.match(files.manager, /HKSampleQuery/);
assert.match(files.manager, /HKStatisticsQuery/);
assert.match(files.manager, /func fetchTodaySteps\(\)/);
assert.match(files.manager, /func fetchLatestHeartRate\(\)/);
assert.match(files.manager, /func fetchSleepSamples\(\)/);
assert.doesNotMatch(files.manager, /\.respiratoryRate/);

assert.match(files.bridge, /today_steps/);
assert.match(files.bridge, /heart_rate_bpm/);
assert.doesNotMatch(files.bridge, /respiratory_rate_per_min/);
assert.match(files.bridge, /sleep_minutes_last_night/);
assert.match(files.bridge, /sleep_samples/);
assert.match(files.bridge, /device_types = \["iphone", "apple_watch"\]/);
assert.match(files.bridge, /\/api\/healthkit\/snapshot/);
assert.match(files.bridge, /YOUR_MAC_LAN_IP/);
assert.match(files.bridge, /X-Anna-Bridge-Token/);
assert.match(files.bridge, /bridgeToken/);
assert.match(files.bridge, /applyPairingURL/);
assert.match(files.bridge, /anna-healthkit/);
assert.match(files.bridge, /bridge_url/);
assert.match(files.bridge, /isAllowedBridgeURL/);
assert.match(files.bridge, /url\.scheme == "http"/);
assert.match(files.bridge, /url\.path == "\/api\/healthkit\/snapshot"/);
assert.match(files.bridge, /host == "localhost"/);
assert.match(files.bridge, /host\.hasSuffix\("\.local"\)/);
assert.match(files.bridge, /parts\[0\] == 10/);
assert.match(files.bridge, /parts\[0\] == 172/);
assert.match(files.bridge, /parts\[0\] == 192 && parts\[1\] == 168/);
assert.match(files.bridge, /Bridge URL 必须是本地 Anna bridge/);
assert.doesNotMatch(files.bridge, /127\.0\.0\.1:8808\/api\/healthkit\/snapshot/);
assert.match(files.manager, /requestAuthorization/);

assert.match(files.content, /Request Health Permission/);
assert.match(files.content, /Read Today Health Data/);
assert.match(files.content, /今日步数/);
assert.match(files.content, /最近心率/);
assert.match(files.content, /最近睡眠记录/);
assert.match(files.content, /开始前台实时同步/);
assert.match(files.content, /\.onOpenURL/);
assert.match(files.content, /liveSyncTask/);
assert.match(files.content, /liveSyncStatus/);
assert.match(files.content, /lastLiveSyncAt/);
assert.match(files.content, /guard liveSyncTask == nil else \{ return \}/);
assert.match(files.content, /refreshSnapshot\(\)/);
assert.match(files.content, /bridge\.send\(snapshot:\s*healthKit\.snapshot\)/);
assert.match(files.content, /Task\.sleep\(nanoseconds:\s*liveSyncIntervalNanoseconds\)/);

assert.match(files.snapshot, /AnnaHealthSnapshot: Codable/);
assert.match(files.snapshot, /todaySteps/);
assert.match(files.snapshot, /sleepSamples/);
assert.doesNotMatch(files.snapshot, /respiratoryRatePerMinute/);
assert.match(files.plist, /NSHealthShareUsageDescription/);
assert.match(files.plist, /今日步数、最近心率和睡眠记录/);
assert.match(files.plist, /Anna 不会写入健康数据/);
assert.match(files.plist, /CFBundleURLTypes/);
assert.match(files.plist, /anna-healthkit/);
assert.match(files.plist, /NSLocalNetworkUsageDescription/);
assert.match(files.plist, /NSAllowsLocalNetworking/);
assert.match(files.entitlements, /com\.apple\.developer\.healthkit/);

assert.match(files.project, /AnnaHealthCompanion\.xcodeproj|AnnaHealthCompanion/);
assert.match(files.project, /HealthKit\.framework/);
assert.match(files.project, /CODE_SIGN_ENTITLEMENTS = AnnaHealthCompanion\/AnnaHealthCompanion\.entitlements/);
assert.match(files.project, /INFOPLIST_FILE = AnnaHealthCompanion\/Info\.plist/);
assert.match(files.project, /PRODUCT_BUNDLE_IDENTIFIER = com\.anna\.personalassistant\.healthcompanion/);
for (const source of [
  "AnnaHealthCompanionApp.swift",
  "ContentView.swift",
  "HealthKitManager.swift",
  "AnnaHealthSnapshot.swift",
  "AnnaBridgeClient.swift"
]) {
  assert.match(files.project, new RegExp(source.replace(".", "\\.")));
}
assert.match(files.scheme, /BlueprintName = "AnnaHealthCompanion"/);
assert.match(files.scheme, /BuildableName = "AnnaHealthCompanion\.app"/);
assert.match(files.scheme, /ReferencedContainer = "container:AnnaHealthCompanion\.xcodeproj"/);

console.log("iOS HealthKit companion static checks passed.");

async function read(name) {
  return readFile(path.join(companion, name), "utf8");
}

async function readProject() {
  return readFile(
    path.join(root, "ios-companion", "AnnaHealthCompanion.xcodeproj", "project.pbxproj"),
    "utf8"
  );
}

async function readScheme() {
  return readFile(
    path.join(
      root,
      "ios-companion",
      "AnnaHealthCompanion.xcodeproj",
      "xcshareddata",
      "xcschemes",
      "AnnaHealthCompanion.xcscheme"
    ),
    "utf8"
  );
}
