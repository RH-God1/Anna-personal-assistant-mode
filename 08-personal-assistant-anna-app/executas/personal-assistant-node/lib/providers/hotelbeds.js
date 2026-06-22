const PROVIDER = "hotelbeds";

export function createHotelbedsProvider() {
  return {
    id: PROVIDER,
    status() {
      return {
        provider: PROVIDER,
        enabled: false,
        phase: "future_placeholder",
        supports: [],
        planned_supports: ["hotel"],
        reason: "Anna travel supplier access is Duffel-only in this phase."
      };
    },

    async searchHotelOffers() {
      throw providerNotEnabled();
    },

    async getHotelOffer() {
      throw providerNotEnabled();
    },

    async createOrder() {
      throw providerNotEnabled();
    }
  };
}

function providerNotEnabled() {
  const error = new Error("hotelbeds is a future placeholder; only Duffel is enabled in this phase.");
  error.code = "PROVIDER_NOT_ENABLED";
  return error;
}
