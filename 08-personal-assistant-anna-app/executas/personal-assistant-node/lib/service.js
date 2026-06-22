import { MODEL_PROFILES, routeModel } from "./model-router.js";
import { loadLocalEnv } from "./env.js";
import { getWeather } from "./weather.js";
import { createHealthStore } from "./health-store.js";
import { createTravelStore } from "./travel.js";
import { createBookingStore } from "./booking.js";
import { createSafetyState } from "./safety.js";
import {
  composeAssistantResponse,
  composePersonalAssistantPreflight
} from "./companion.js";
import { createLearningLoop } from "./learning-loop.js";

export function createAssistantService({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  healthSessionTtlMs,
  maxHealthSessions,
  healthKitProvider,
  maxPreflightStates = 128,
  maxTravelRuns,
  maxBookingConfirmations,
  maxLearningCycles,
  learningMemoryPath,
  persistLearningMemory
} = {}) {
  loadLocalEnv();
  const healthStore = createHealthStore({
    now,
    sessionTtlMs: healthSessionTtlMs,
    maxSessions: maxHealthSessions,
    healthKitProvider
  });
  const safetyState = createSafetyState({ now, maxConfirmations: maxBookingConfirmations });
  const travelStore = createTravelStore({ now, maxRuns: maxTravelRuns });
  const bookingStore = createBookingStore({
    now,
    maxConfirmations: maxBookingConfirmations,
    safetyState
  });
  const learningLoop = createLearningLoop({
    now,
    maxCycles: maxLearningCycles,
    memoryPath: learningMemoryPath,
    persistMemory: persistLearningMemory
  });
  const preflightStates = new Map();
  const preflightLimit = Math.max(1, Number(maxPreflightStates) || 128);

  function getPreflightState(key) {
    const normalizedKey = normalizePreflightKey(key);
    let record = preflightStates.get(normalizedKey);
    if (!record) {
      while (preflightStates.size >= preflightLimit) {
        preflightStates.delete(preflightStates.keys().next().value);
      }
      record = {
        key: normalizedKey,
        preflight_seen: false,
        health_permission: "unknown",
        last_seen_at: null
      };
      preflightStates.set(normalizedKey, record);
    }
    return record;
  }

  return {
    status() {
      return {
        service: "anna-personal-assistant",
        version: "0.1.0",
        models: MODEL_PROFILES,
        health: healthStore.status(),
        weather: {
          provider: "Open-Meteo",
          sends: ["approximate_coordinates"],
          stores: false
        },
        multimodal: {
          standalone_preview: "metadata-routing-only",
          anna_host: "requires-capability-handshake"
        },
        routing: {
          host_managed_when_capabilities_needed: ["tools", "vision", "audio"],
          text_specializations: {
            safety: "qwen3-max",
            decision: "qwen3-max",
            companion: "minimax-m2-7",
            creative: "mimo-v2-flash",
            writing: "qwen-plus",
            general: "gemini-3.1-flash-lite-preview",
            fallback: "gemma-4-e4b-it"
          }
        },
        healthkit_bridge: {
          action: "health_connect",
          supported_devices: ["iphone", "apple_watch"],
          provider_contract: "readSnapshot({ observedAt, now, supportedDevices, sessionId? })",
          current_provider: healthStore.status().bridge_kind
        },
        preflight: {
          state_storage: "memory_only",
          active_states: preflightStates.size,
          max_states: preflightLimit
        },
        safety: safetyState.status(),
        travel: travelStore.status(),
        booking: bookingStore.status(),
        learning: learningLoop.status()
      };
    },

    permissionRegistry(args = {}) {
      if (args.permission_id || args.id) return safetyState.permission(args.permission_id || args.id);
      return safetyState.permissions();
    },

    confirmationQueue(args = {}) {
      return safetyState.listConfirmations(args);
    },

    confirmationGet(args = {}) {
      return safetyState.getConfirmation(args.confirmation_queue_id || args.confirmationId || args.id);
    },

    confirmationResolve(args = {}) {
      return safetyState.resolveConfirmation(args);
    },

    learningStatus() {
      return learningLoop.status();
    },

    learningCycle(args = {}) {
      return learningLoop.runCycle({
        message: args.message,
        route: args.route || null,
        response: args.response || null,
        scenario: args.scenario || "manual_training"
      });
    },

    travelSearch(args = {}) {
      assertTravelProviderPermission(safetyState, args);
      return travelStore.search(args);
    },

    travelStart(args = {}) {
      assertTravelProviderPermission(safetyState, args);
      return travelStore.start(args);
    },

    travelContinue(args = {}) {
      return travelStore.continue(args.run_id, args.event);
    },

    travelGet(args = {}) {
      return travelStore.get(args.run_id);
    },

    travelStatus() {
      return travelStore.status();
    },

    bookingStatus() {
      return bookingStore.status();
    },

    flightSearch(args = {}) {
      assertBookingProviderPermission(safetyState, args.provider || "duffel");
      return bookingStore.searchFlights(args);
    },

    hotelSearch(args = {}) {
      assertBookingProviderPermission(safetyState, args.provider || "duffel");
      return bookingStore.searchHotels(args);
    },

    travelCompare(args = {}) {
      assertBookingProviderPermission(safetyState, args.flightProvider || args.flight_provider || args.provider || "duffel");
      assertBookingProviderPermission(safetyState, args.hotelProvider || args.hotel_provider || args.provider || "duffel");
      return bookingStore.compare(args);
    },

    bookingPrepare(args = {}) {
      return bookingStore.prepare(args);
    },

    bookingGetConfirmation(args = {}) {
      return bookingStore.getConfirmation(args);
    },

    bookingConfirm(args = {}) {
      return bookingStore.confirm(args);
    },

    travel(args = {}) {
      switch (args.travel_action || args.action) {
        case "search":
          return travelStore.search(args);
        case "start":
        case "start_run":
          return travelStore.start(args);
        case "continue":
          return travelStore.continue(args.run_id, args.event);
        case "get":
        case "get_run":
          return travelStore.get(args.run_id);
        case "status":
          return travelStore.status();
        default:
          throw new Error(`Unknown travel action: ${JSON.stringify(args.travel_action || args.action)}`);
        }
    },

    async weather(args = {}) {
      return getWeather({ ...args, fetchImpl });
    },

    async preflight(args = {}) {
      const preflightState = getPreflightState(args.user_key || args.user_id || args.session_key);
      const firstUse = typeof args.first_use === "boolean"
        ? args.first_use
        : !preflightState.preflight_seen;
      let weather = null;
      let health = null;

      if (args.location) {
        weather = await getWeather({
          ...args.location,
          demo: args.weather_demo === true || args.location?.demo === true,
          fetchImpl
        });
      }

      if (args.health_session_id) {
        health = healthStore.snapshot(args.health_session_id);
      } else if (args.health_consent === true) {
        safetyState.assertAllowed("healthkit.read_snapshot");
        health = healthStore.connectHealthKit({
          consent: true,
          deviceLabel: args.device_label || "iPhone + Apple Watch HealthKit 桥接",
          deviceTypes: args.deviceTypes || args.device_types
        });
      }

      const result = composePersonalAssistantPreflight({
        now: now(),
        firstUse,
        weather,
        health,
        healthConsent: args.health_consent
      });
      preflightState.preflight_seen = true;
      if (result.context.permissions.health !== "not_requested") {
        preflightState.health_permission = result.context.permissions.health;
      }
      preflightState.last_seen_at = result.opened_at;
      result.context.preflight_state = { ...preflightState };
      return result;
    },

    connectHealth(args = {}) {
      safetyState.assertAllowed("healthkit.read_snapshot");
      return healthStore.connectHealthKit({
        ...args,
        deviceTypes: args.deviceTypes || args.device_types
      });
    },

    connectDemoHealth(args = {}) {
      safetyState.assertAllowed("healthkit.read_snapshot");
      return healthStore.connectDemo({
        ...args,
        deviceTypes: args.deviceTypes || args.device_types
      });
    },

    healthSnapshot(args = {}) {
      return healthStore.snapshot(args.session_id);
    },

    updateHealthKitSnapshot(args = {}) {
      return healthStore.updateHealthKitSnapshot(args.snapshot || args);
    },

    disconnectHealth(args = {}) {
      return healthStore.disconnect(args.session_id);
    },

    async assist(args = {}) {
      const route = routeModel({
        message: args.message,
        attachments: args.attachments,
        preferredModel: args.preferred_model
      });
      let weather = null;
      let health = null;
      let travel = null;
      let booking = null;
      if (route.intent === "weather" && args.location) {
        weather = await getWeather({
          ...args.location,
          demo: args.weather_demo === true,
          fetchImpl
        });
      }
      if (route.intent === "health" && args.health_session_id) {
        health = healthStore.snapshot(args.health_session_id);
      }
      if (route.intent === "travel" && args.travel && shouldUseOfficialHandoff(args.message, args.travel)) {
        const travelAction = args.travel.travel_action || args.travel.action || "search";
        if (travelAction === "start" || travelAction === "start_run") {
          travel = travelStore.start(args.travel);
        } else if (travelAction === "continue") {
          travel = travelStore.continue(args.travel.run_id, args.travel.event);
        } else if (travelAction === "get" || travelAction === "get_run") {
          travel = travelStore.get(args.travel.run_id);
        } else {
          travel = travelStore.search(args.travel);
        }
      } else if (route.intent === "travel") {
        const bookingIntent = bookingInputFromArgs(args);
        if (bookingIntent?.ready) {
          booking = {
            mode: "duffel_booking_compare",
            provider: "duffel",
            input: bookingIntent.payload,
            comparison: await bookingStore.compare(bookingIntent.payload),
            opens_external_browser: false
          };
        } else if (bookingIntent) {
          booking = {
            mode: "duffel_booking_requirements",
            provider: "duffel",
            missing_fields: bookingIntent.missing_fields,
            parsed: bookingIntent.parsed,
            opens_external_browser: false
          };
        } else if (explicitOfficialHandoffRequested(args.message)) {
          const inferred = inferTravelFromMessage(args.message);
          if (inferred) {
            travel = Array.isArray(inferred)
              ? travelBundle(inferred.map((item) => travelStore.start(item)))
              : travelStore.start(inferred);
          }
        }
      }
      if (route.intent === "travel" && !travel && !booking && !args.travel) {
        const inferred = inferTravelFromMessage(args.message);
        if (inferred) {
          booking = {
            mode: "duffel_booking_requirements",
            provider: "duffel",
            missing_fields: ["departureDate"],
            parsed: {
              product: Array.isArray(inferred) ? "flight_hotel" : inferred.product,
              route: Array.isArray(inferred) ? inferred.map((item) => item.query) : inferred
            },
            opens_external_browser: false
          };
        }
      }
      const response = composeAssistantResponse({
        message: args.message,
        route,
        weather,
        health,
        travel,
        booking
      });
      if (learningLoop.isLearningInstruction(args.message)) {
        const learningCycle = learningLoop.runCycle({
          message: args.message,
          route,
          response,
          scenario: "user_requested_reinforcement"
        });
        return {
          route,
          context: {
            weather,
            health,
            travel,
            booking,
            learning: learningCycle
          },
          response: learningLoop.composeCycleResponse(learningCycle)
        };
      }
      const remembered = learningLoop.recall({ route, message: args.message });
      return {
        route,
        context: {
          weather,
          health,
          travel,
          booking,
          learning_memory: remembered
        },
        response: learningLoop.applyMemory(response, remembered)
      };
    }
  };
}

function normalizePreflightKey(value) {
  const key = String(value || "local-default")
    .trim()
    .replace(/[^\w:.-]/g, "_")
    .slice(0, 120);
  return key || "local-default";
}

function assertTravelProviderPermission(safetyState, args = {}) {
  const input = args.search && typeof args.search === "object" ? args.search : args;
  const provider = String(args.provider || input.provider || "sandbox").toLowerCase();
  if (provider === "official-handoff" || provider === "sandbox") return;
  assertBookingProviderPermission(safetyState, provider);
}

function assertBookingProviderPermission(safetyState, providerId) {
  const provider = String(providerId || "duffel").toLowerCase();
  if (provider === "duffel") {
    safetyState.assertAllowed("travel.search.duffel_sandbox");
    return;
  }
  if (provider === "amadeus") {
    safetyState.assertAllowed("travel.search.amadeus_sandbox");
    return;
  }
  throw new Error(`Unsupported provider permission: ${providerId}`);
}

function inferTravelFromMessage(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  const wantsFlight = /机票|航班|flight|飞/i.test(text);
  const wantsHotel = /酒店|订房|hotel|住宿/i.test(text);
  if (wantsFlight && wantsHotel) {
    const flight = inferSingleTravelFromMessage(text, "flight");
    const hotel = inferSingleTravelFromMessage(text, "hotel");
    return [flight, hotel].filter(Boolean);
  }
  return inferSingleTravelFromMessage(text, wantsHotel
    ? "hotel"
    : wantsFlight
      ? "flight"
      : null);
}

function shouldUseOfficialHandoff(message, travelArgs = {}) {
  const action = String(travelArgs.travel_action || travelArgs.action || "").trim().toLowerCase();
  if (["start", "start_run", "continue", "get", "get_run", "status"].includes(action)) return true;
  const provider = String(travelArgs.provider || travelArgs.search?.provider || "").trim().toLowerCase();
  if (provider === "official-handoff" || provider === "sandbox") return true;
  return explicitOfficialHandoffRequested(message);
}

function explicitOfficialHandoffRequested(message) {
  const text = String(message || "");
  if (!text.trim()) return false;
  if (explicitDuffelFirstRequested(text) || officialHandoffNegated(text)) return false;
  return /官方网页|官方网站|官网|打开(?:浏览器|网页|外站|官网)|外站接管|官方接管|Expedia|Trip\.com|携程|Ctrip|Booking\.com|official\s+(?:site|handoff)|browser\s+handoff/i.test(text);
}

function explicitDuffelFirstRequested(text) {
  return /(?:先|默认|优先|只|使用|走|通过|用).{0,12}Duffel|Duffel.{0,12}(?:先|默认|优先|只|搜索|查询|预确认|prepare)/i.test(text);
}

function officialHandoffNegated(text) {
  return /(?:不要|别|不需要|无需|不用|禁止|不要先|先不要).{0,18}(?:打开)?(?:浏览器|网页|外站|官网|官方网页|官方网站|Expedia|Trip\.com|携程|Ctrip|Booking\.com)|(?:不要|别|不需要|无需|不用|禁止).{0,18}(?:外站接管|官方接管|browser\s+handoff|official\s+(?:site|handoff))/i.test(text);
}

function bookingInputFromArgs(args = {}) {
  if (args.booking && typeof args.booking === "object") {
    const payload = normalizeBookingPayload(args.booking);
    return payload ? { ready: true, payload } : null;
  }
  if (args.travel && !shouldUseOfficialHandoff(args.message, args.travel)) {
    const source = args.travel.search && typeof args.travel.search === "object" ? args.travel.search : args.travel;
    const payload = normalizeBookingPayload(source);
    if (payload) return { ready: true, payload };
  }
  return inferBookingFromMessage(args.message);
}

function normalizeBookingPayload(source = {}) {
  if (!source || typeof source !== "object") return null;
  if (source.bookingType || source.booking_type || source.flight || source.hotel) {
    return {
      bookingType: source.bookingType || source.booking_type || "flight_hotel",
      flightProvider: "duffel",
      hotelProvider: "duffel",
      ...(source.flight ? { flight: source.flight } : {}),
      ...(source.hotel ? { hotel: source.hotel } : {})
    };
  }
  const product = String(source.product || "").trim().toLowerCase();
  if (product === "flight") {
    return {
      bookingType: "flight",
      flightProvider: "duffel",
      flight: {
        origin: source.origin,
        destination: source.destination,
        departureDate: source.departureDate || source.departure_date,
        returnDate: source.returnDate || source.return_date || null,
        cabinClass: source.cabinClass || source.cabin_class || source.cabin || "economy",
        passengers: source.passengers || { adults: source.adults || 1 },
        budget: source.budget || source.budgetCny || source.budget_cny || null
      }
    };
  }
  if (product === "hotel") {
    return {
      bookingType: "hotel",
      hotelProvider: "duffel",
      hotel: {
        destination: source.destination || source.city || source.location,
        hotelLocation: source.hotelLocation || source.hotel_location || source.area || null,
        checkinDate: source.checkinDate || source.checkin_date || source.departureDate || source.departure_date,
        checkoutDate: source.checkoutDate || source.checkout_date || null,
        nights: source.nights || 1,
        guests: source.guests || source.passengers || { adults: source.adults || 1 },
        budget: source.budget || source.budgetCny || source.budget_cny || null
      }
    };
  }
  return null;
}

function inferBookingFromMessage(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  if (explicitOfficialHandoffRequested(text)) return null;
  const wantsFlight = /机票|航班|flight|飞/i.test(text);
  const wantsHotel = /酒店|订房|hotel|住宿/i.test(text);
  if (!wantsFlight && !wantsHotel) return null;

  const departureDate = dateFromText(text);
  const adults = adultsFromText(text);
  const budget = budgetFromText(text);
  const missing = [];
  let flight = null;
  let hotel = null;

  if (wantsFlight) {
    const origin = originFromText(text);
    const destination = destinationFromText(text, "flight");
    if (!origin) missing.push("origin");
    if (!destination) missing.push("destination");
    if (!departureDate) missing.push("departureDate");
    flight = {
      origin,
      destination,
      departureDate,
      returnDate: returnDateFromText(text, departureDate),
      cabinClass: cabinFromText(text),
      passengers: { adults },
      budget
    };
    const tripType = tripTypeFromText(text);
    if (tripType === "roundtrip" && flight.returnDate) {
      flight.returnDate = flight.returnDate;
    }
  }

  if (wantsHotel) {
    const destination = destinationFromText(text, "hotel") || normalizePlace(flight?.destination, { hotel: true });
    if (!destination) missing.push("hotelDestination");
    if (!departureDate) missing.push("checkinDate");
    hotel = {
      destination,
      hotelLocation: hotelLocationFromText(text),
      checkinDate: departureDate,
      nights: nightsFromText(text),
      guests: { adults },
      budget
    };
  }

  const parsed = {
    bookingType: wantsFlight && wantsHotel ? "flight_hotel" : wantsFlight ? "flight" : "hotel",
    flight,
    hotel
  };
  if (missing.length > 0) {
    return {
      ready: false,
      missing_fields: [...new Set(missing)],
      parsed
    };
  }
  return {
    ready: true,
    payload: {
      bookingType: parsed.bookingType,
      flightProvider: "duffel",
      hotelProvider: "duffel",
      ...(flight ? { flight } : {}),
      ...(hotel ? { hotel } : {})
    }
  };
}

function cabinFromText(text) {
  if (/头等|first/i.test(text)) return "first";
  if (/商务|business/i.test(text)) return "business";
  if (/超级经济|高端经济|premium/i.test(text)) return "premium_economy";
  return "economy";
}

function hotelLocationFromText(text) {
  const match = text.match(/(?:酒店|住宿|订房).{0,12}(新宿|银座|涩谷|浦东|外滩|西湖|市中心|central|shinjuku|ginza|shibuya)/i);
  return match ? match[1] : null;
}

function inferSingleTravelFromMessage(text, product) {
  if (!product) return null;
  const departureDate = dateFromText(text);
  if (!departureDate) return null;
  const passengers = { adults: adultsFromText(text) };
  const destination = destinationFromText(text, product);
  if (!destination) return null;

  const payload = {
    product,
    departureDate,
    passengers,
    provider: "official-handoff",
    budgetCny: budgetFromText(text)
  };
  if (product === "flight") {
    const origin = originFromText(text);
    if (!origin) return null;
    payload.origin = origin;
    payload.destination = destination;
    payload.tripType = tripTypeFromText(text);
    const returnDate = returnDateFromText(text, departureDate);
    if (payload.tripType === "roundtrip" && returnDate) {
      payload.returnDate = returnDate;
    } else if (payload.tripType === "roundtrip") {
      payload.tripType = "oneway";
    }
  } else {
    payload.destination = destination;
    payload.nights = nightsFromText(text);
    const site = /trip|携程|ctrip/i.test(text) ? "trip" : null;
    if (site) payload.official_site = site;
  }
  return payload;
}

function travelBundle(runs) {
  if (runs.length === 0) return null;
  if (runs.length === 1) return runs[0];
  return {
    kind: "travel_bundle",
    state: runs.every((run) => run.state === "await_user_confirmation") ? "await_user_confirmation" : "mixed",
    provider: "official-handoff",
    runs,
    primary_run: runs[0],
    privacy: {
      pii_accepted: false,
      external_transmission: false,
      requires_human_confirmation: true
    }
  };
}

function dateFromText(text) {
  const iso = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/);
  if (!iso) return null;
  const year = iso[1];
  const month = iso[2].padStart(2, "0");
  const day = iso[3].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function adultsFromText(text) {
  const match = text.match(/(\d{1,2})\s*(?:位|个)?(?:成人|大人|人|adults?)/i);
  if (!match) return 1;
  return Math.min(9, Math.max(1, Number(match[1]) || 1));
}

function nightsFromText(text) {
  const match = text.match(/(\d{1,2})\s*(?:晚|夜|nights?)/i);
  if (!match) return 1;
  return Math.min(30, Math.max(1, Number(match[1]) || 1));
}

function budgetFromText(text) {
  const match = text.match(/(?:预算|不超过|以内|低于|under|budget)\s*(?:约|大概)?\s*(\d{2,7})\s*(?:元|块|人民币|rmb|cny)?/i) ||
    text.match(/(\d{2,7})\s*(?:元|块|人民币|rmb|cny)\s*(?:以内|以下|预算)/i);
  if (!match) return null;
  return Math.max(1, Math.min(1000000, Number(match[1]) || 0));
}

function tripTypeFromText(text) {
  if (/往返|返程|来回|round\s*trip|roundtrip|return flight/i.test(text)) return "roundtrip";
  return "oneway";
}

function returnDateFromText(text, departureDate) {
  const explicit = text.match(/(?:返程|返回|回来|回程|return)\D{0,12}(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/i);
  if (explicit) {
    return `${explicit[1]}-${explicit[2].padStart(2, "0")}-${explicit[3].padStart(2, "0")}`;
  }
  const days = text.match(/(?:往返|来回|返程|回程).*?(\d{1,2})\s*(?:天后|天|日后)/);
  if (!days) return null;
  const date = new Date(`${departureDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.min(180, Number(days[1]) || 1)));
  return date.toISOString().slice(0, 10);
}

function originFromText(text) {
  const route = text.match(/([A-Za-z]{3}|上海|北京|东京|杭州|广州|深圳|香港|台北)\s*(?:到|去|飞|→|-|to)\s*([A-Za-z]{3}|上海|北京|东京|杭州|广州|深圳|香港|台北)/i);
  return route ? normalizePlace(route[1]) : null;
}

function destinationFromText(text, product) {
  if (product === "flight") {
    const route = text.match(/([A-Za-z]{3}|上海|北京|东京|杭州|广州|深圳|香港|台北)\s*(?:到|去|飞|→|-|to)\s*([A-Za-z]{3}|上海|北京|东京|杭州|广州|深圳|香港|台北)/i);
    return route ? normalizePlace(route[2]) : null;
  }
  const hotel = text.match(/(?:在|订|预订|book)?\s*([A-Za-z]{3}|上海|北京|东京|杭州|广州|深圳|香港|台北|Tokyo|Shanghai|Beijing|Hangzhou)\s*(?:的)?(?:酒店|hotel|住宿|订房)/i) ||
    text.match(/(?:酒店|hotel|住宿|订房).*?([A-Za-z]{3}|上海|北京|东京|杭州|广州|深圳|香港|台北|Tokyo|Shanghai|Beijing|Hangzhou)/i);
  return hotel ? normalizePlace(hotel[1], { hotel: true }) : null;
}

function normalizePlace(value, { hotel = false } = {}) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  if (hotel) {
    const airportToCity = {
      SHA: "Shanghai",
      PVG: "Shanghai",
      BJS: "Beijing",
      PEK: "Beijing",
      PKX: "Beijing",
      NRT: "Tokyo",
      HND: "Tokyo",
      HKG: "Hong Kong",
      TPE: "Taipei",
      HGH: "Hangzhou",
      CAN: "Guangzhou",
      SZX: "Shenzhen"
    };
    if (airportToCity[upper]) return airportToCity[upper];
  }
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  const aliases = {
    上海: hotel ? "Shanghai" : "SHA",
    SHANGHAI: hotel ? "Shanghai" : "SHA",
    北京: hotel ? "Beijing" : "BJS",
    BEIJING: hotel ? "Beijing" : "BJS",
    东京: hotel ? "Tokyo" : "NRT",
    TOKYO: hotel ? "Tokyo" : "NRT",
    杭州: hotel ? "Hangzhou" : "HGH",
    HANGZHOU: hotel ? "Hangzhou" : "HGH",
    广州: hotel ? "Guangzhou" : "CAN",
    GUANGZHOU: hotel ? "Guangzhou" : "CAN",
    深圳: hotel ? "Shenzhen" : "SZX",
    SHENZHEN: hotel ? "Shenzhen" : "SZX",
    香港: hotel ? "Hong Kong" : "HKG",
    台北: hotel ? "Taipei" : "TPE"
  };
  return aliases[raw] || aliases[upper] || raw;
}
