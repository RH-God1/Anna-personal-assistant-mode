const PROVIDER = "travelport";

export function createTravelportProvider() {
  return {
    id: PROVIDER,
    status() {
      return {
        provider: PROVIDER,
        enabled: false,
        phase: "future_placeholder",
        supports: [],
        planned_supports: ["flight"],
        reason: "Anna travel supplier access is Duffel-only in this phase."
      };
    },

    async searchFlightOffers() {
      throw providerNotEnabled();
    },

    async getFlightOffer() {
      throw providerNotEnabled();
    },

    async createOrder() {
      throw providerNotEnabled();
    }
  };
}

function providerNotEnabled() {
  const error = new Error("travelport is a future placeholder; only Duffel is enabled in this phase.");
  error.code = "PROVIDER_NOT_ENABLED";
  return error;
}
