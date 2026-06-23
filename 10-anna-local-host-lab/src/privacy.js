const sensitiveKeyPattern =
  /(?:^|[_-])(?:full[_-]?name|passenger[_-]?name|travell?er|passport|identity|id[_-]?card|phone|mobile|email|bank|card[_-]?(?:number|no)|cvv|cvc|password|verification[_-]?code|payment[_-]?password|api[_-]?key|access[_-]?token|auth[_-]?token|credentials?|secret)(?:$|[_-])/i;

const sensitiveTextPatterns = [
  /\b1[3-9]\d{9}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}\b/i
];

export class PolicyError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    this.status = status;
  }
}

function walk(value, visit, path = "args", seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visit(String(index), item, `${path}[${index}]`);
      walk(item, visit, `${path}[${index}]`, seen);
    });
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    visit(key, nested, `${path}.${key}`);
    walk(nested, visit, `${path}.${key}`, seen);
  }
}

export function assertNoSensitivePayload(value) {
  walk(value, (key, nested, currentPath) => {
    if (sensitiveKeyPattern.test(key) &&
        !isSafeSecretMetadata(key, nested) &&
        !isSafeBookingMetadata(key, nested, currentPath)) {
      throw new PolicyError(
        "sensitive_field_blocked",
        `Sensitive field is not accepted by the local host: ${currentPath}`
      );
    }
    if (typeof nested === "string" &&
        sensitiveTextPatterns.some((pattern) => pattern.test(nested))) {
      throw new PolicyError(
        "sensitive_value_blocked",
        `Sensitive value is not accepted by the local host: ${currentPath}`
      );
    }
  });
}

function isSafeSecretMetadata(key, value) {
  return typeof value === "boolean" && /(?:^|[_-])configured$/i.test(key);
}

function isSafeBookingMetadata(key, value, currentPath) {
  if (key === "traveler_snapshot") return isSafeTravelerSnapshot(value);
  if (currentPath.includes(".traveler_snapshot.")) {
    if (key === "document_status" || key === "payment_status") {
      return value === "not_collected_by_anna";
    }
    if (key === "plaintext_documents_saved" ||
        key === "plaintext_payment_saved" ||
        key === "sensitive_fields_saved") {
      return value === false;
    }
  }
  if (key === "payment_policy") return isSafePaymentPolicy(value);
  if (currentPath.includes(".payment_policy.") && key === "card_storage") {
    return value === "forbidden";
  }
  return false;
}

function isSafeTravelerSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.sensitive_fields_saved !== false ||
      value.plaintext_documents_saved !== false ||
      value.plaintext_payment_saved !== false) {
    return false;
  }
  if (!Number.isInteger(value.count) || value.count < 1 || value.count > 9) {
    return false;
  }
  if (!Array.isArray(value.travelers) || value.travelers.length !== value.count) {
    return false;
  }
  return value.travelers.every((traveler, index) =>
    traveler &&
    typeof traveler === "object" &&
    traveler.label === `\u65c5\u5ba2/\u4f4f\u5ba2 ${index + 1}` &&
    typeof traveler.type === "string" &&
    traveler.type.length <= 24 &&
    typeof traveler.display_name === "string" &&
    (traveler.display_name === "\u672a\u586b\u5199" || traveler.display_name.includes("*")) &&
    traveler.document_status === "not_collected_by_anna" &&
    traveler.payment_status === "not_collected_by_anna"
  );
}

function isSafePaymentPolicy(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.auto_payment === false &&
    value.payment_collected_by_anna === false &&
    value.card_storage === "forbidden" &&
    typeof value.order_creation_by_anna === "boolean";
}

export function assertResultHasNoSecrets(value) {
  try {
    assertNoSensitivePayload(value);
  } catch (error) {
    throw new PolicyError(
      "secret_leak_blocked",
      `Executa response was withheld by the privacy filter: ${error.message}`,
      502
    );
  }
}

export function enforceInvokePolicy({ app, args, grants }) {
  assertNoSensitivePayload(args);
  const action = args?.args?.action;

  if (app.slug === "personal-assistant-mode" && action === "weather") {
    const demo = args.args?.weather_demo === true ||
      args.args?.location?.demo === true;
    if (!demo && grants.external_network !== true) {
      throw new PolicyError(
        "external_network_not_granted",
        "Weather requires an explicit per-window external-network grant."
      );
    }
  }

  if (app.slug === "personal-assistant-mode" &&
      action === "health_connect_demo" &&
      args.args?.consent !== true) {
    throw new PolicyError(
      "health_consent_required",
      "Health data requires explicit consent for this session."
    );
  }

  if (app.slug === "personal-assistant-mode" &&
      action === "healthkit_push_snapshot" &&
      args.args?.companion_consent !== true) {
    throw new PolicyError(
      "health_consent_required",
      "Pushed HealthKit snapshots require explicit companion consent."
    );
  }
}

export function auditShape(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  return Object.keys(args).sort().slice(0, 24);
}
