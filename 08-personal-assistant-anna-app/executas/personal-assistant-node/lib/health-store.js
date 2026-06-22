import { randomUUID } from "node:crypto";

export const HEALTHKIT_SUPPORTED_DEVICES = Object.freeze(["iphone", "apple_watch"]);

export function createDemoHealthKitProvider() {
  return {
    kind: "demo",
    realtime: false,
    readSnapshot({ observedAt }) {
      return {
        observed_at: observedAt,
        today_steps: 6420,
        heart_rate_bpm: 72,
        sleep_minutes_last_night: 446,
        sleep_samples: [],
        sleep_source: "模拟数据",
        source: "HealthKit companion bridge fixture"
      };
    }
  };
}

export function createMutableHealthKitProvider() {
  let latest = null;
  return {
    kind: "ios-watchos-companion",
    realtime: true,
    updateSnapshot(snapshot = {}) {
      latest = {
        observed_at: snapshot.observed_at,
        today_steps: snapshot.today_steps,
        heart_rate_bpm: snapshot.heart_rate_bpm,
        sleep_minutes_last_night: snapshot.sleep_minutes_last_night,
        sleep_samples: Array.isArray(snapshot.sleep_samples) ? snapshot.sleep_samples : [],
        sleep_source: snapshot.sleep_source || "HealthKit",
        source: snapshot.source || "Anna iOS HealthKit Companion"
      };
      return normalizeSnapshot(latest, new Date().toISOString());
    },
    readSnapshot({ observedAt }) {
      if (!latest) {
        return {
          observed_at: observedAt,
          today_steps: null,
          heart_rate_bpm: null,
          sleep_minutes_last_night: null,
          sleep_samples: [],
          sleep_source: "HealthKit",
          source: "Anna iOS HealthKit Companion pending authorization"
        };
      }
      return {
        ...latest,
        observed_at: latest.observed_at || observedAt
      };
    }
  };
}

export function createBridgeableHealthKitProvider() {
  const demo = createDemoHealthKitProvider();
  const mutable = createMutableHealthKitProvider();
  let hasCompanionSnapshot = false;
  return {
    get kind() {
      return hasCompanionSnapshot ? mutable.kind : demo.kind;
    },
    get realtime() {
      return hasCompanionSnapshot ? mutable.realtime : demo.realtime;
    },
    updateSnapshot(snapshot = {}) {
      hasCompanionSnapshot = true;
      return mutable.updateSnapshot(snapshot);
    },
    readSnapshot(args) {
      return hasCompanionSnapshot ? mutable.readSnapshot(args) : demo.readSnapshot(args);
    }
  };
}

export function createHealthStore({
  now = () => new Date(),
  sessionTtlMs = 30 * 60 * 1000,
  maxSessions = 32,
  healthKitProvider = createDemoHealthKitProvider()
} = {}) {
  const sessions = new Map();
  const ttlMs = Math.max(1000, Number(sessionTtlMs) || 30 * 60 * 1000);
  const limit = Math.max(1, Number(maxSessions) || 32);

  function prune() {
    const current = now().getTime();
    for (const [id, record] of sessions) {
      if (record.expires_at_ms <= current) sessions.delete(id);
    }
  }

  return {
    connectHealthKit({
      consent,
      deviceLabel = "iPhone + Apple Watch HealthKit 桥接",
      deviceTypes = HEALTHKIT_SUPPORTED_DEVICES
    } = {}) {
      if (consent !== true) {
        throw new Error("health data connection requires explicit consent");
      }
      const normalizedDevices = normalizeDeviceTypes(deviceTypes);
      prune();
      while (sessions.size >= limit) {
        sessions.delete(sessions.keys().next().value);
      }
      const id = `health_${randomUUID().replace(/-/g, "")}`;
      const connected = now();
      const connectedAt = connected.toISOString();
      const snapshot = healthKitProvider.readSnapshot({
        observedAt: connectedAt,
        now,
        supportedDevices: normalizedDevices
      });
      const record = {
        id,
        connected_at: connectedAt,
        expires_at_ms: connected.getTime() + ttlMs,
        device_label: String(deviceLabel).slice(0, 120),
        mode: "healthkit-companion-bridge",
        bridge_kind: String(healthKitProvider.kind || "custom").slice(0, 80),
        realtime: healthKitProvider.realtime === true,
        supported_devices: normalizedDevices,
        health_data_source: "healthkit",
        snapshot: normalizeSnapshot(snapshot, connectedAt)
      };
      sessions.set(id, record);
      return publicView(record);
    },

    connectDemo(args = {}) {
      return this.connectHealthKit({
        deviceLabel: "iPhone + Apple Watch 模拟桥接",
        ...args
      });
    },

    snapshot(sessionId) {
      prune();
      const record = sessions.get(String(sessionId || ""));
      if (!record) throw new Error("health session not found");
      const observedAt = now().toISOString();
      if (record.realtime && typeof healthKitProvider.readSnapshot === "function") {
        record.snapshot = normalizeSnapshot(
          healthKitProvider.readSnapshot({
            observedAt,
            now,
            supportedDevices: record.supported_devices,
            sessionId: record.id
          }),
          observedAt
        );
      } else {
        record.snapshot.observed_at = observedAt;
      }
      return publicView(record);
    },

    disconnect(sessionId) {
      prune();
      const id = String(sessionId || "");
      const existed = sessions.delete(id);
      return { disconnected: existed, session_id: id || null };
    },

    updateHealthKitSnapshot(snapshot = {}) {
      if (typeof healthKitProvider.updateSnapshot !== "function") {
        throw new Error("healthkit provider does not accept pushed snapshots");
      }
      const updated = healthKitProvider.updateSnapshot(snapshot);
      return {
        accepted: true,
        bridge_kind: String(healthKitProvider.kind || "custom").slice(0, 80),
        snapshot: updated
      };
    },

    status() {
      prune();
      return {
        mode: "healthkit-companion-bridge",
        bridge_kind: String(healthKitProvider.kind || "custom").slice(0, 80),
        realtime: healthKitProvider.realtime === true,
        supported_devices: HEALTHKIT_SUPPORTED_DEVICES,
        active_sessions: sessions.size,
        persistent_storage: false,
        medical_diagnosis: false,
        session_ttl_ms: ttlMs,
        max_sessions: limit
      };
    }
  };
}

function publicView(record) {
  return JSON.parse(JSON.stringify({
    session_id: record.id,
    connected_at: record.connected_at,
    device_label: record.device_label,
    mode: record.mode,
    bridge_kind: record.bridge_kind,
    realtime: record.realtime,
    supported_devices: record.supported_devices,
    health_data_source: record.health_data_source,
    snapshot: record.snapshot,
    privacy: {
      storage: "memory_only",
      transmitted_to_weather_provider: false,
      requires_user_action: true
    },
    disclaimer: record.bridge_kind === "demo"
      ? "这些是界面流程使用的模拟数据，不能用于医疗判断。"
      : "这些是用户授权 HealthKit 桥接提供的快照，不能用于医疗判断。"
  }));
}

function normalizeDeviceTypes(deviceTypes) {
  const values = Array.isArray(deviceTypes) ? deviceTypes : [deviceTypes];
  const normalized = [...new Set(values.map((item) => String(item || "").toLowerCase()))]
    .filter(Boolean);
  if (normalized.length === 0) return HEALTHKIT_SUPPORTED_DEVICES;
  const unsupported = normalized.filter((item) => !HEALTHKIT_SUPPORTED_DEVICES.includes(item));
  if (unsupported.length > 0) {
    throw new Error(`health connection only supports iPhone and Apple Watch: ${unsupported.join(", ")}`);
  }
  return normalized;
}

function normalizeSnapshot(snapshot, fallbackObservedAt) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    observed_at: String(source.observed_at || fallbackObservedAt),
    today_steps: finiteOrNull(source.today_steps),
    heart_rate_bpm: finiteOrNull(source.heart_rate_bpm),
    sleep_minutes_last_night: finiteOrNull(source.sleep_minutes_last_night),
    sleep_samples: normalizeSleepSamples(source.sleep_samples),
    sleep_source: String(source.sleep_source || "HealthKit").slice(0, 120),
    source: String(source.source || "HealthKit companion bridge").slice(0, 160)
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSleepSamples(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).map((item) => ({
    start_at: String(item?.start_at || "").slice(0, 40),
    end_at: String(item?.end_at || "").slice(0, 40),
    value: String(item?.value || "sleep").slice(0, 40),
    minutes: finiteOrNull(item?.minutes),
    source: String(item?.source || "HealthKit").slice(0, 120)
  }));
}
