class OfficialWebHandoffAdapter {
  constructor(config) {
    this.id = config.id;
    this.product = config.product;
    this.displayName = config.displayName;
    this.mode = "official-web-handoff";
    this.requiresExternalConsent = false;
    this.url = config.url;
    this.reason = config.reason;
  }

  async search(query) {
    return {
      provider: this.id,
      product: this.product,
      offers: [
        {
          id: `${this.id}-handoff`,
          product: this.product,
          platformName: this.displayName,
          title: `${this.displayName} 人工接管入口`,
          route: {
            origin: query.origin || null,
            destination: query.destination || null
          },
          price: null,
          gates: ["traveler_info", "order_confirmation", "payment"],
          canAutoBook: false,
          handoff: {
            mode: "browser",
            url: this.url,
            reason: this.reason
          }
        }
      ],
      privacy: {
        piiAccepted: false,
        externalTransmission: false,
        note: "Handoff URL does not encode itinerary fields."
      }
    };
  }

  async hold(offerId) {
    return {
      provider: this.id,
      holdId: `handoff_${offerId}_${Date.now()}`,
      offerId,
      status: "manual_required",
      nextGate: "official_site",
      handoffUrl: this.url
    };
  }

  async createBookIntent(holdId) {
    return {
      provider: this.id,
      holdId,
      status: "human_required",
      nextGate: "official_site",
      handoff: {
        mode: "browser",
        url: this.url,
        reason: this.reason
      }
    };
  }
}

module.exports = {
  OfficialWebHandoffAdapter
};
