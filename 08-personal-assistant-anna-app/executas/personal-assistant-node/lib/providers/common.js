import { createHash } from "node:crypto";

export function stableId(prefix, value) {
  const hash = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}_${hash}`;
}

export function envFlag(name, fallback = true) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off", "production"].includes(String(raw).toLowerCase());
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nightsBetween(startIso, endIso) {
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86400000);
}

export function money(currency, amount) {
  return {
    currency,
    total_amount: Number(amount).toFixed(2)
  };
}

export function amountNumber(price) {
  return Number(price?.total_amount || 0);
}

export const DUFFEL_NO_RESULT_MESSAGE = "当前通过 Duffel 没有查到可预订报价。";

export function providerResult(provider, offers, {
  resultCode = offers.length > 0 ? "ok" : "supplier_no_result",
  message = offers.length > 0 ? null : DUFFEL_NO_RESULT_MESSAGE,
  routeMaybeUnsupported = false
} = {}) {
  return {
    provider,
    offers,
    resultCode,
    supplier_no_result: resultCode === "supplier_no_result",
    invalid_search_params: resultCode === "invalid_search_params",
    route_maybe_unsupported: resultCode === "route_maybe_unsupported" || routeMaybeUnsupported,
    supplier_error: resultCode === "supplier_error",
    rate_limited: resultCode === "rate_limited",
    message
  };
}

export class ProviderResultError extends Error {
  constructor(resultCode, message = DUFFEL_NO_RESULT_MESSAGE) {
    super(message);
    this.code = resultCode;
    this.resultCode = resultCode;
  }
}

export function itineraryTimes(date, departHour, durationHours) {
  const departing = new Date(`${date}T${String(departHour).padStart(2, "0")}:20:00.000Z`);
  const arriving = new Date(departing.getTime() + durationHours * 3600000);
  return {
    departing_at: departing.toISOString(),
    arriving_at: arriving.toISOString()
  };
}

export function normalizeFlightCriteria(input = {}) {
  const departureDate = requiredDate(input.departureDate || input.departure_date, "departureDate");
  const tripType = normalizeTripType(input);
  const criteria = {
    origin: requiredString(input.origin, "origin", 80),
    destination: requiredString(input.destination, "destination", 80),
    departureDate,
    returnDate: optionalDate(input.returnDate || input.return_date, "returnDate"),
    tripType,
    passengers: normalizePassengers(input.passengers || input.travelers || {
      adults: input.adults
    }),
    cabinClass: normalizeCabin(input.cabinClass || input.cabin_class || input.cabin),
    budget: optionalMoney(input.budget || input.budgetCny || input.budget_cny)
  };
  if (criteria.tripType === "roundtrip" && !criteria.returnDate) {
    throw new Error("returnDate is required for roundtrip flight search");
  }
  return criteria;
}

export function normalizeHotelCriteria(input = {}) {
  const checkinDate = requiredDate(input.checkinDate || input.checkin_date || input.departureDate, "checkinDate");
  const nights = boundedInteger(input.nights, 1, 30, 1, "nights");
  const checkoutDate = optionalDate(input.checkoutDate || input.checkout_date, "checkoutDate")
    || addDays(checkinDate, nights);
  const actualNights = nightsBetween(checkinDate, checkoutDate);
  if (actualNights < 1 || actualNights > 30) {
    throw new Error("checkoutDate must be 1-30 nights after checkinDate");
  }
  return {
    destination: requiredString(input.destination || input.city || input.location, "destination", 100),
    hotelLocation: optionalString(input.hotelLocation || input.hotel_location || input.area, 100),
    checkinDate,
    checkoutDate,
    nights: actualNights,
    guests: normalizePassengers(input.guests || input.passengers || {
      adults: input.adults
    }),
    rooms: boundedInteger(input.rooms, 1, 5, 1, "rooms"),
    budget: optionalMoney(input.budget || input.budgetCny || input.budget_cny)
  };
}

function normalizePassengers(input = {}) {
  return {
    adults: boundedInteger(input.adults, 1, 9, 1, "adults"),
    children: boundedInteger(input.children, 0, 9, 0, "children")
  };
}

function normalizeCabin(value) {
  const cabin = String(value || "economy").toLowerCase().replace(/[_\s-]+/g, "_");
  if (["economy", "premium_economy", "business", "first"].includes(cabin)) return cabin;
  throw new Error(`Unsupported cabin class: ${value}`);
}

function normalizeTripType(input) {
  const raw = String(input.tripType || input.trip_type || "").trim().toLowerCase();
  if (["roundtrip", "round_trip", "return"].includes(raw)) return "roundtrip";
  if (["oneway", "one_way", "single"].includes(raw)) return "oneway";
  if (input.returnDate || input.return_date) return "roundtrip";
  return "oneway";
}

function requiredString(value, field, max) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  if (value.trim().length > max) throw new Error(`${field} is too long`);
  return value.trim();
}

function optionalString(value, max) {
  if (value == null || value === "") return null;
  const cleaned = String(value).trim();
  if (cleaned.length > max) throw new Error("field is too long");
  return cleaned || null;
}

function requiredDate(value, field) {
  const date = requiredString(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${field} must use YYYY-MM-DD`);
  return date;
}

function optionalDate(value, field) {
  if (value == null || value === "") return null;
  const date = requiredDate(value, field);
  return date;
}

function optionalMoney(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 1000000) {
    throw new Error("budget must be between 1 and 1000000");
  }
  return Math.round(number);
}

function boundedInteger(value, min, max, fallback, field) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return number;
}
