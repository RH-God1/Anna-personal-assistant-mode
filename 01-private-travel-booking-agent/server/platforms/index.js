const { SandboxPlatformAdapter } = require("./sandbox");
const { AmadeusFlightAdapter } = require("./amadeus");
const { OfficialWebHandoffAdapter } = require("./handoff");

const PRODUCTS = ["flight", "rail", "bus", "hotel"];

function createRegistry(env = process.env) {
  const adapters = new Map();

  for (const product of PRODUCTS) {
    register(adapters, new SandboxPlatformAdapter(product));
  }

  register(adapters, new AmadeusFlightAdapter(env));
  register(adapters, new OfficialWebHandoffAdapter({
    id: "china-rail-12306-handoff",
    product: "rail",
    displayName: "中国铁路 12306 官方网页",
    url: "https://www.12306.cn/index/",
    reason: "12306 购票涉及实名旅客与支付，Agent 只打开官方入口并等待用户自行操作。"
  }));
  register(adapters, new OfficialWebHandoffAdapter({
    id: "bus-official-handoff",
    product: "bus",
    displayName: "官方客运平台网页",
    url: "about:blank",
    reason: "客运平台差异较大，需要按地区接入官方或授权 API；当前只提供人工接管入口。"
  }));

  return {
    list() {
      return Array.from(adapters.values()).map((adapter) => ({
        id: adapter.id,
        product: adapter.product,
        displayName: adapter.displayName,
        mode: adapter.mode,
        enabled: adapter.enabled !== false,
        requiresExternalConsent: Boolean(adapter.requiresExternalConsent)
      }));
    },

    get(provider, product) {
      const resolvedProvider = provider || `sandbox-${product}`;
      const adapter = adapters.get(resolvedProvider);

      if (!adapter) {
        const error = new Error(`Unknown provider: ${resolvedProvider}`);
        error.statusCode = 404;
        throw error;
      }

      if (product && adapter.product !== product) {
        const error = new Error(`Provider ${resolvedProvider} does not support product ${product}`);
        error.statusCode = 400;
        throw error;
      }

      return adapter;
    }
  };
}

function register(adapters, adapter) {
  adapters.set(adapter.id, adapter);
}

module.exports = {
  PRODUCTS,
  createRegistry
};
