import { randomUUID } from "node:crypto";

const DEFAULT_PERMISSIONS = Object.freeze([
  {
    id: "healthkit.read_snapshot",
    label: "Read user-authorized HealthKit snapshot",
    scope: "health",
    status: "requires_user_consent",
    external_api: false,
    reads_sensitive_data: true,
    writes_external: false,
    allowed_data: ["steps", "heart_rate_bpm", "sleep_minutes_last_night", "sleep_samples"],
    forbidden_data: ["diagnosis", "medical_advice", "raw_identifier", "icloud_account"]
  },
  {
    id: "travel.search.duffel_sandbox",
    label: "Search Duffel sandbox/test travel offers",
    scope: "travel",
    status: "allowed",
    external_api: true,
    reads_sensitive_data: false,
    writes_external: false,
    allowed_data: ["origin", "destination", "dates", "passenger_count", "cabin", "rough_budget"],
    forbidden_data: ["name", "passport", "phone", "email", "payment_card"]
  },
  {
    id: "travel.search.amadeus_sandbox",
    label: "Search Amadeus sandbox travel offers",
    scope: "travel",
    status: "allowed",
    external_api: true,
    reads_sensitive_data: false,
    writes_external: false,
    allowed_data: ["origin", "destination", "dates", "passenger_count", "cabin", "rough_budget"],
    forbidden_data: ["name", "passport", "phone", "email", "payment_card"]
  },
  {
    id: "booking.prepare_confirmation",
    label: "Prepare a local booking review record",
    scope: "booking",
    status: "allowed",
    external_api: false,
    reads_sensitive_data: false,
    writes_external: false,
    allowed_data: ["offer_id", "price_snapshot", "inventory_snapshot", "masked_traveler_label"],
    forbidden_data: ["passport", "id_card", "phone", "email", "payment_card", "cvv"]
  },
  {
    id: "booking.create_order",
    label: "Create supplier order",
    scope: "booking",
    status: "blocked_in_this_runtime",
    external_api: true,
    reads_sensitive_data: true,
    writes_external: true,
    allowed_data: [],
    forbidden_data: ["all_real_order_creation"]
  },
  {
    id: "payment.confirm",
    label: "Confirm payment",
    scope: "payment",
    status: "blocked_in_this_runtime",
    external_api: true,
    reads_sensitive_data: true,
    writes_external: true,
    allowed_data: [],
    forbidden_data: ["all_payment_actions"]
  }
]);

export function createSafetyState({ now = () => new Date(), maxConfirmations = 128 } = {}) {
  const permissions = new Map(DEFAULT_PERMISSIONS.map((item) => [item.id, { ...item }]));
  const queue = [];
  const limit = Math.max(1, Number(maxConfirmations) || 128);

  function prune() {
    while (queue.length > limit) queue.shift();
  }

  return {
    permissions() {
      return [...permissions.values()].map(clone);
    },

    permission(id) {
      const record = permissions.get(String(id || ""));
      if (!record) throw new Error(`permission not found: ${id}`);
      return clone(record);
    },

    assertAllowed(id) {
      const record = this.permission(id);
      if (record.status === "blocked_in_this_runtime") {
        const error = new Error(`permission ${id} is blocked in this runtime`);
        error.code = "permission_blocked";
        throw error;
      }
      return record;
    },

    requestConfirmation(input = {}) {
      prune();
      const createdAt = now().toISOString();
      const record = {
        id: `confirm_${randomUUID().replace(/-/g, "")}`,
        status: "waiting_user_confirmation",
        created_at: createdAt,
        updated_at: createdAt,
        kind: String(input.kind || "human_review").slice(0, 80),
        permission_id: String(input.permissionId || input.permission_id || "").slice(0, 120) || null,
        risk_level: String(input.riskLevel || input.risk_level || "medium").slice(0, 40),
        summary: String(input.summary || "User review is required before continuing.").slice(0, 500),
        required_human_action: String(input.requiredHumanAction || input.required_human_action || "review").slice(0, 240),
        payload_ref: sanitizePayloadRef(input.payloadRef || input.payload_ref || input.payload),
        resolved_at: null,
        resolution: null
      };
      queue.push(record);
      return clone(record);
    },

    listConfirmations({ status } = {}) {
      const wanted = status ? String(status) : null;
      return queue
        .filter((item) => !wanted || item.status === wanted)
        .map(clone);
    },

    getConfirmation(id) {
      const record = queue.find((item) => item.id === String(id || ""));
      if (!record) throw new Error(`confirmation queue item not found: ${id}`);
      return clone(record);
    },

    resolveConfirmation({ id, decision, actor = "user" } = {}) {
      const record = queue.find((item) => item.id === String(id || ""));
      if (!record) throw new Error(`confirmation queue item not found: ${id}`);
      if (record.status !== "waiting_user_confirmation") return clone(record);
      const normalized = normalizeDecision(decision);
      record.status = normalized === "approved" ? "approved" : "rejected";
      record.updated_at = now().toISOString();
      record.resolved_at = record.updated_at;
      record.resolution = {
        decision: normalized,
        actor: String(actor || "user").slice(0, 80)
      };
      return clone(record);
    },

    status() {
      return {
        permissions: this.permissions(),
        confirmation_queue: {
          active: queue.filter((item) => item.status === "waiting_user_confirmation").length,
          total: queue.length,
          max_items: limit,
          storage: "memory_only"
        },
        order_creation: "blocked_in_this_runtime",
        payment: "blocked_in_this_runtime"
      };
    }
  };
}

function sanitizePayloadRef(value) {
  if (!value || typeof value !== "object") return null;
  return clone({
    type: value.type || value.booking_type || value.kind || null,
    id: value.id || value.confirmationId || value.confirmation_id || null,
    provider: value.provider || null,
    amount: value.amount || value.total_amount || null,
    currency: value.currency || value.total_currency || null
  });
}

function normalizeDecision(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["approve", "approved", "yes", "y", "confirm", "confirmed", "同意", "批准", "确认"].includes(text)) {
    return "approved";
  }
  return "rejected";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
