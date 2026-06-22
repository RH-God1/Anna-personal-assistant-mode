const PRODUCT_LABELS = {
  flight: "机票",
  rail: "高铁",
  bus: "巴士",
  hotel: "酒店"
};

class SandboxPlatformAdapter {
  constructor(product) {
    this.id = `sandbox-${product}`;
    this.product = product;
    this.displayName = `Sandbox ${PRODUCT_LABELS[product] || product}`;
    this.mode = "sandbox";
    this.requiresExternalConsent = false;
  }

  async search(query) {
    return {
      provider: this.id,
      product: this.product,
      offers: buildOffers(this.product, query),
      privacy: {
        piiAccepted: false,
        externalTransmission: false
      }
    };
  }

  async hold(offerId) {
    return {
      provider: this.id,
      holdId: `hold_${offerId}_${Date.now()}`,
      offerId,
      status: "held",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      nextGate: "traveler_info"
    };
  }

  async createBookIntent(holdId) {
    return {
      provider: this.id,
      holdId,
      status: "human_required",
      nextGate: "traveler_info",
      message: "请用户在平台页面或官方表单中自行输入旅客/联系人信息。Agent 不接收这些值。"
    };
  }
}

function buildOffers(product, query) {
  const route = product === "hotel"
    ? `${query.destination || query.origin || "目的地"}`
    : `${query.origin || "出发地"} -> ${query.destination || "目的地"}`;

  const baseDate = query.departureDate || query.checkInDate || "待定日期";

  if (product === "flight") {
    return [
      offer("sandbox-flight-1", product, "官方合作航司 A", `${route} 直飞`, "08:20", "10:35", 680, baseDate),
      offer("sandbox-flight-2", product, "官方合作航司 B", `${route} 经停`, "12:05", "15:45", 540, baseDate),
      offer("sandbox-flight-3", product, "官方合作航司 C", `${route} 晚间`, "19:10", "21:25", 720, baseDate)
    ];
  }

  if (product === "rail") {
    return [
      offer("sandbox-rail-1", product, "官方铁路渠道", `${route} G 字头`, "07:00", "11:36", 553, baseDate),
      offer("sandbox-rail-2", product, "官方铁路渠道", `${route} D 字头`, "09:18", "15:02", 421, baseDate),
      offer("sandbox-rail-3", product, "官方铁路渠道", `${route} 晚间`, "17:45", "22:28", 553, baseDate)
    ];
  }

  if (product === "bus") {
    return [
      offer("sandbox-bus-1", product, "官方客运渠道", `${route} 快线`, "08:40", "12:20", 98, baseDate),
      offer("sandbox-bus-2", product, "官方客运渠道", `${route} 普通班次`, "13:00", "17:15", 76, baseDate),
      offer("sandbox-bus-3", product, "官方客运渠道", `${route} 晚班`, "18:30", "22:10", 88, baseDate)
    ];
  }

  return [
    hotelOffer("sandbox-hotel-1", "官方酒店渠道", `${route} 商务酒店`, 438, query),
    hotelOffer("sandbox-hotel-2", "官方酒店渠道", `${route} 高端酒店`, 768, query),
    hotelOffer("sandbox-hotel-3", "官方酒店渠道", `${route} 公寓酒店`, 356, query)
  ];
}

function offer(id, product, platformName, title, departTime, arriveTime, amount, date) {
  return {
    id,
    product,
    platformName,
    title,
    schedule: {
      date,
      departTime,
      arriveTime
    },
    price: {
      amount,
      currency: "CNY"
    },
    gates: ["traveler_info", "order_confirmation", "payment"],
    canAutoBook: false
  };
}

function hotelOffer(id, platformName, title, amount, query) {
  return {
    id,
    product: "hotel",
    platformName,
    title,
    stay: {
      checkInDate: query.checkInDate || query.departureDate || "待定",
      checkOutDate: query.checkOutDate || "待定"
    },
    price: {
      amount,
      currency: "CNY",
      unit: "night"
    },
    gates: ["guest_info", "order_confirmation", "payment"],
    canAutoBook: false
  };
}

module.exports = {
  SandboxPlatformAdapter
};
