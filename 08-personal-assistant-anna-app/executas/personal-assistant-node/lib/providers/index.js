import { createDuffelProvider } from "./duffel.js";
import { createAmadeusProvider } from "./amadeus.js";

export function createProviderRegistry(options = {}) {
  const providers = new Map([
    ["duffel", createDuffelProvider(options)],
    ["amadeus", createAmadeusProvider(options)]
  ]);

  return {
    get(providerId, itemType) {
      const provider = providers.get(String(providerId || "").toLowerCase());
      if (!provider) throw new Error(`Unsupported provider: ${providerId}`);
      const supports = provider.status().supports || [];
      if (itemType && !supports.includes(itemType)) {
        throw new Error(`${providerId} does not support ${itemType}`);
      }
      return provider;
    },

    list() {
      return [...providers.values()].map((provider) => provider.status());
    }
  };
}
