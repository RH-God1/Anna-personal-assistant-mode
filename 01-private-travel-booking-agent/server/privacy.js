const SENSITIVE_KEY_PATTERNS = [
  /(^|[_-])(full)?name$/i,
  /姓名/,
  /passenger(?!s$)/i,
  /traveler/i,
  /guest/i,
  /contact/i,
  /holder/i,
  /identity/i,
  /id.?card/i,
  /身份证/,
  /passport/i,
  /护照/,
  /phone/i,
  /mobile/i,
  /手机号/,
  /email/i,
  /card/i,
  /bank/i,
  /cvv/i,
  /cvc/i,
  /password/i,
  /验证码/,
  /支付密码/
];

const SENSITIVE_VALUE_PATTERNS = [
  /\b\d{15}(\d{2}[\dXx])?\b/,
  /\b1[3-9]\d{9}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b\d{3,6}\b(?=.*验证码|.*code|.*otp)/i
];

function assertNoPii(payload, path = "body") {
  const hits = collectSensitiveHits(payload, path);

  if (hits.length > 0) {
    const detail = hits.slice(0, 5).join(", ");
    const error = new Error(`Sensitive user data is not accepted by this Agent API: ${detail}`);
    error.statusCode = 400;
    throw error;
  }
}

function collectSensitiveHits(value, currentPath) {
  const hits = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      hits.push(...collectSensitiveHits(item, `${currentPath}[${index}]`));
    });
    return hits;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nextPath = `${currentPath}.${key}`;

      if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        hits.push(nextPath);
      }

      hits.push(...collectSensitiveHits(nestedValue, nextPath));
    }

    return hits;
  }

  if (typeof value === "string") {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        hits.push(currentPath);
        break;
      }
    }
  }

  return hits;
}

function publicSearchQuery(query) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw validationError("Search query must be a JSON object.");
  }

  const product = cleanString(query.product, "product", 24);
  const origin = optionalString(query.origin, "origin", 80);
  const destination = optionalString(query.destination, "destination", 80);
  const departureDate = optionalDate(query.departureDate, "departureDate");
  const returnDate = optionalDate(query.returnDate, "returnDate");
  const checkInDate = optionalDate(query.checkInDate, "checkInDate");
  const checkOutDate = optionalDate(query.checkOutDate, "checkOutDate");
  const passengers = query.passengers == null ? {} : query.passengers;

  if (!passengers || typeof passengers !== "object" || Array.isArray(passengers)) {
    throw validationError("passengers must be an object.");
  }

  if (product === "hotel") {
    if (!destination && !origin) {
      throw validationError("Hotel searches require a destination.");
    }
    if (!checkInDate && !departureDate) {
      throw validationError("Hotel searches require checkInDate or departureDate.");
    }
  } else {
    if (!origin || !destination) {
      throw validationError("Travel searches require origin and destination.");
    }
    if (!departureDate) {
      throw validationError("Travel searches require departureDate.");
    }
  }

  if (returnDate && departureDate && returnDate < departureDate) {
    throw validationError("returnDate cannot be before departureDate.");
  }

  const effectiveCheckIn = checkInDate || (product === "hotel" ? departureDate : null);
  if (checkOutDate && effectiveCheckIn && checkOutDate <= effectiveCheckIn) {
    throw validationError("checkOutDate must be after checkInDate.");
  }

  return {
    product,
    origin,
    destination,
    departureDate,
    returnDate,
    checkInDate,
    checkOutDate,
    passengers: {
      adults: boundedInteger(passengers.adults, 1, 9, 1, "passengers.adults"),
      children: boundedInteger(passengers.children, 0, 9, 0, "passengers.children")
    }
  };
}

function cleanString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError(`${field} is required.`);
  }
  if (value.trim().length > maxLength) {
    throw validationError(`${field} is too long.`);
  }
  return value.trim();
}

function optionalString(value, field, maxLength) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw validationError(`${field} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.length > maxLength) {
    throw validationError(`${field} is too long.`);
  }
  return cleaned;
}

function optionalDate(value, field) {
  const cleaned = optionalString(value, field, 10);
  if (cleaned == null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned) || Number.isNaN(Date.parse(`${cleaned}T00:00:00Z`))) {
    throw validationError(`${field} must use YYYY-MM-DD.`);
  }
  return cleaned;
}

function boundedInteger(value, min, max, fallback, field) {
  if (value == null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError(`${field} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

module.exports = {
  assertNoPii,
  publicSearchQuery
};
