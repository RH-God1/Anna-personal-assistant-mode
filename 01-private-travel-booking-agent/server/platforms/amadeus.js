class AmadeusFlightAdapter {
  constructor(env) {
    this.id = "amadeus-flight";
    this.product = "flight";
    this.displayName = "Amadeus Flight Offers";
    this.mode = "official-api";
    this.requiresExternalConsent = true;
    this.enabled = Boolean(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET);
    this.clientId = env.AMADEUS_CLIENT_ID;
    this.clientSecret = env.AMADEUS_CLIENT_SECRET;
    this.baseUrl = env.AMADEUS_BASE_URL || "https://test.api.amadeus.com";
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async search(query, context) {
    if (!this.enabled) {
      return disabledResponse(this);
    }

    if (!context || context.consentToShareItinerary !== true) {
      const error = new Error("External API search requires explicit user consent to share itinerary search fields.");
      error.statusCode = 403;
      throw error;
    }

    const token = await this.getToken();
    const params = new URLSearchParams({
      originLocationCode: String(query.origin || "").toUpperCase(),
      destinationLocationCode: String(query.destination || "").toUpperCase(),
      departureDate: query.departureDate,
      adults: String((query.passengers && query.passengers.adults) || 1),
      currencyCode: "CNY",
      max: "10"
    });

    if (query.returnDate) {
      params.set("returnDate", query.returnDate);
    }

    const response = await fetch(`${this.baseUrl}/v2/shopping/flight-offers?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = new Error(`Amadeus search failed with ${response.status}`);
      error.statusCode = 502;
      throw error;
    }

    const data = await response.json();
    return {
      provider: this.id,
      product: this.product,
      offers: (data.data || []).map(mapOffer),
      privacy: {
        piiAccepted: false,
        externalTransmission: true,
        externalProvider: "Amadeus"
      }
    };
  }

  async hold(offerId) {
    return {
      provider: this.id,
      holdId: `amadeus_manual_${offerId}_${Date.now()}`,
      offerId,
      status: "manual_required",
      nextGate: "traveler_info",
      message: "Amadeus 订单创建需要旅客信息，本 Agent 不接收 PII；请切换到人工输入/官方合作系统。"
    };
  }

  async createBookIntent(holdId) {
    return {
      provider: this.id,
      holdId,
      status: "human_required",
      nextGate: "traveler_info",
      message: "请用户自行在授权平台中输入旅客信息并完成支付。"
    };
  }

  async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    const response = await fetch(`${this.baseUrl}/v1/security/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      const error = new Error(`Amadeus token request failed with ${response.status}`);
      error.statusCode = 502;
      throw error;
    }

    const tokenBody = await response.json();
    this.token = tokenBody.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, Number(tokenBody.expires_in || 0) - 60) * 1000;
    return this.token;
  }
}

function disabledResponse(adapter) {
  return {
    provider: adapter.id,
    product: adapter.product,
    offers: [],
    disabled: true,
    reason: "Missing AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET. Sandbox adapters remain available."
  };
}

function mapOffer(offer) {
  const itinerary = offer.itineraries && offer.itineraries[0];
  const firstSegment = itinerary && itinerary.segments && itinerary.segments[0];
  const lastSegment = itinerary && itinerary.segments && itinerary.segments[itinerary.segments.length - 1];

  return {
    id: `amadeus-${offer.id}`,
    product: "flight",
    platformName: "Amadeus",
    title: firstSegment && lastSegment
      ? `${firstSegment.departure.iataCode} -> ${lastSegment.arrival.iataCode}`
      : "Flight offer",
    schedule: {
      departTime: firstSegment ? firstSegment.departure.at : null,
      arriveTime: lastSegment ? lastSegment.arrival.at : null
    },
    price: {
      amount: Number(offer.price && offer.price.total),
      currency: offer.price && offer.price.currency
    },
    gates: ["traveler_info", "order_confirmation", "payment"],
    canAutoBook: false
  };
}

module.exports = {
  AmadeusFlightAdapter
};
