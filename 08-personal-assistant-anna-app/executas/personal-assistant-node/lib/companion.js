export function composeAssistantResponse({
  message,
  route,
  weather = null,
  health = null,
  travel = null,
  booking = null
}) {
  const text = String(message || "").trim();
  switch (route.intent) {
    case "weather":
      return weatherResponse(weather);
    case "health":
      return healthResponse(health);
    case "travel":
      if (booking) return bookingResponse(booking);
      return travelResponse(travel);
    case "safety":
      return safetyResponse(text);
    case "companion":
      return companionResponse(text);
    case "decision":
      return decisionResponse(text);
    case "multimodal":
      return multimodalResponse(route);
    default:
      return generalResponse(text, route);
  }
}

export function composePersonalAssistantPreflight({
  now = new Date(),
  firstUse = true,
  weather = null,
  health = null,
  healthConsent = null
} = {}) {
  const messages = [
    {
      kind: "greeting",
      text: `${daypart(now)}，我是 Anna。先和你确认一下：你现在身体感觉、精神状态和今天最重要的一件事分别是什么？`
    },
    weather
      ? {
          kind: "weather_report",
          text: weatherLine(weather)
        }
      : {
          kind: "location_request",
          text: "我还没有读取到你的位置。你可以点“使用我的位置”，或手动填写城市和坐标；我只会把近似坐标发给天气服务。"
        }
  ];

  let healthPermission = "not_requested";
  if (health) {
    healthPermission = "connected";
    messages.push({
      kind: "health_connected",
      text: healthLine(health)
    });
    messages.push({
      kind: "care_suggestion",
      text: careSuggestion({ weather, health })
    });
  } else if (firstUse && healthConsent === true) {
    healthPermission = "pending_connection";
    messages.push({
      kind: "health_connection_pending",
      text: "我收到你的健康连接同意，但还没有拿到健康桥接快照。请重新连接 iPhone 或 Apple Watch 的 HealthKit companion 桥接。"
    });
  } else if (firstUse && healthConsent === false) {
    healthPermission = "declined";
    messages.push({
      kind: "health_declined",
      text: "好的，我不会连接健康数据。个人助理模式仍可继续做天气、空气、日程与决策整理。"
    });
  } else if (firstUse) {
    healthPermission = "requested";
    messages.push({
      kind: "health_permission_request",
      text: "第一次使用个人助理模式时，我想申请连接 iPhone“健康”App。这个连接走 Apple HealthKit 授权路径，经你同意后第一阶段只读取今日步数、最近心率和睡眠记录；不写入健康数据，你也可以拒绝或随时断开。"
    });
  }

  return {
    mode: "personal_assistant_preflight",
    opened_at: new Date(now).toISOString(),
    messages,
    context: {
      weather,
      health,
      first_use: firstUse,
      permissions: {
        location: weather ? "weather_report_ready" : "needs_user_location_action",
        health: healthPermission
      }
    },
    next_actions: nextPreflightActions({ weather, health, healthPermission }),
    boundaries: [
      "不在未同意时读取位置或健康数据",
      "健康连接仅限 iPhone 与 Apple Watch 的授权 HealthKit 路径",
      "不把步数、心率或睡眠快照解释为医疗诊断",
      "用户可以拒绝或断开健康桥接"
    ]
  };
}

function weatherResponse(weather) {
  if (!weather) {
    return response({
      opening: "天气请求已经识别，但还没有得到位置。",
      answer: "请点击“使用我的位置”，或手动填写城市与坐标后再试。",
      observed: ["尚未读取定位", "尚未调用天气服务"],
      unknown: ["用户希望查询的具体地点"],
      next: ["提供近似位置", "继续时只发送坐标给天气服务"]
    });
  }
  const w = weather.weather;
  const air = weather.air;
  return response({
    opening: `${weather.location.label}现在是${w.label}。`,
    answer: `气温 ${format(w.temperature_c)}°C，体感 ${format(w.apparent_temperature_c)}°C，湿度 ${format(w.humidity_percent)}%，风速 ${format(w.wind_kmh)} km/h。空气质量指数 ${format(air.us_aqi)}，PM2.5 为 ${format(air.pm2_5_ug_m3)} µg/m³。`,
    observed: [
      `天气数据时间：${weather.observed_at}`,
      `来源：${weather.source}`
    ],
    unknown: ["短时局地变化", "用户的个人耐受与健康影响"],
    next: ["外出前再次刷新", "对空气敏感时参考当地官方健康建议"]
  });
}

function healthResponse(health) {
  if (!health) {
    return response({
      opening: "我可以整理健康趋势，但不会在未授权时读取设备数据。",
    answer: "当前没有健康桥接会话。真实 iPhone companion 会通过 Apple HealthKit 授权读取今日步数、最近心率和睡眠记录；实验版可先连接模拟 HealthKit 桥接验证流程。",
      observed: ["尚未连接健康数据源"],
      unknown: ["真实 Apple Watch 数据", "任何健康趋势"],
      next: ["阅读同意说明", "连接模拟桥接"]
    });
  }
  const snapshot = health.snapshot;
  return response({
    opening: "我已读取这次获授权的健康快照。",
      answer: `记录值为：今日步数 ${format(snapshot.today_steps)} 步、最近心率 ${format(snapshot.heart_rate_bpm)} bpm、睡眠 ${minutes(snapshot.sleep_minutes_last_night)}。这些数值只用于日常提醒，单次读数不能说明健康状态。`,
    observed: [
      `数据时间：${snapshot.observed_at}`,
      `数据源：${snapshot.source}`
    ],
    unknown: ["真实设备趋势", "测量上下文", "临床意义"],
    next: ["真实版只展示趋势，不自动诊断", "明显不适时联系合格医疗专业人员"]
  });
}

function travelResponse(travel) {
  if (!travel) {
    return response({
      opening: "我可以帮你规划机票和酒店，但不会自动订购或付款。",
      answer: "请提供产品类型、出发地/目的地或酒店城市、日期、人数、单程或往返，以及预算。Anna 默认先走 Duffel 结构化搜索和预确认，不会先打开外部浏览器；只有你明确要求官方网页接管时才会进入外站 handoff。",
      observed: ["尚未获得完整行程查询字段"],
      unknown: ["具体出发地、目的地、日期或人数", "单程/往返", "预算"],
      next: ["补齐匿名行程字段", "Anna 先通过 Duffel 查可预订报价", "确认候选后生成 booking_prepare 确认页"]
    });
  }
  if (travel.kind === "travel_bundle") {
    const runs = travel.runs || [];
    const labels = runs.map((run) => {
      const offer = run.selected_offer;
      return `${productLabel(run.product)}：${offer?.handoff?.site?.name || run.provider} · ${offer?.schedule || "时间待确认"} · ${budgetLabel(offer)} · ${priceSourceLabel(offer)}`;
    });
    return response({
      opening: "我已找到机票和酒店的组合候选。",
      answer: `${labels.join("；")}。请回复“是”确认候选，或回复“否”让我换平台重新搜索。确认候选后我会再请求“订购接管授权”；授权后才打开官方页面。姓名、证件、电话、邮箱和已保存乘客资料都由你在官方窗口中处理，我只监测是否到达付款前，绝不付款。`,
      observed: [
        `组合数量：${runs.length}`,
        ...labels,
        "provider：official-handoff"
      ],
      unknown: ["官方实时库存与最终成交价", "外站验证码或登录状态", "旅客身份与付款信息"],
      next: ["用户确认候选", "用户授权订购接管", "用户在官方窗口填写或选择已保存旅客资料", "到付款页后交还给用户付款"]
    });
  }
  const offer = travel.offers?.[0] || travel.selected_offer;
  const handoff = offer?.handoff;
  const waitingForConfirmation = travel.state === "await_user_confirmation";
  return response({
    opening: `我找到了一个${productLabel(offer?.product || travel.query?.product)}候选方案。`,
    answer: `${offer?.title || "候选方案"}：${offer?.schedule || "时间待确认"}。Anna 预估 ${offer?.price ?? "待官方确认"} ${offer?.currency || "CNY"}；${budgetLabel(offer)}；${priceSourceLabel(offer)}。${waitingForConfirmation ? "请回复“是”确认候选，或回复“否”让我换一个平台重新搜索；确认候选后我会再次请求订购接管授权。" : ""}${handoff?.url ? `官方页面已准备：${handoff.url}。` : ""}我不会读取或保存姓名、证件、电话、邮箱、订单号或支付信息；到付款页必须由你本人付款。`,
    observed: [
      `产品：${offer?.product || travel.query?.product || "未知"}`,
      `provider：${travel.provider || "sandbox"}`,
      ...(handoff?.site?.name ? [`官方站点：${handoff.site.name}`] : []),
      ...(offer?.budget ? [`预算状态：${offer.budget.status}`] : []),
      `价格来源：${priceSourceLabel(offer)}`,
      `下一确认门：${travel.next_gate || offer?.gates?.[0] || "无"}`,
      `订购授权：${travel.booking_authorized ? "已授权" : "未授权"}`
    ],
    unknown: ["官方实时库存与最终成交价", "旅客身份信息", "付款状态"],
    next: handoff
      ? ["用户确认候选", "用户授权订购接管后打开官方页面", "用户自行登录、填身份或选择已保存资料", "Anna 只监测到付款前并停止，付款由用户完成"]
      : ["用户确认旅客信息门", "用户确认订单门", "用户自行完成付款门"]
  });
}

function bookingResponse(booking) {
  if (booking.mode === "duffel_booking_requirements") {
    const missing = (booking.missing_fields || []).map(fieldLabel).join("、") || "必要行程字段";
    const result = response({
      opening: "我会先走 Duffel 结构化预订检查，不打开外部浏览器。",
      answer: `这次订票/订酒店请求还缺：${missing}。请补齐后我会通过 Duffel 搜索可预订报价，再进入 prepare 确认页；不会打开 Expedia、Trip.com、Booking.com 或其他外站。`,
      observed: [
        "provider：duffel",
        "默认流程：search / compare / booking_prepare",
        "外部浏览器：未打开"
      ],
      unknown: booking.missing_fields || [],
      next: ["补齐缺失字段", "通过 Duffel 查询报价", "用户确认后生成确认页"]
    });
    result.boundaries.push("默认不打开官方外站；外站接管只在用户明确要求时发生。");
    return result;
  }

  const comparison = booking.comparison || {};
  const recommendation = comparison.recommendation;
  if (!recommendation) {
    const message = comparison.flights?.message || comparison.hotels?.message || "当前通过 Duffel 没有查到可预订报价。";
    const result = response({
      opening: "我已经通过 Duffel 做了结构化查询。",
      answer: `${message} 这只代表当前 Duffel 供应商没有给出可预订报价，不代表现实中没有航班、酒店或房间。`,
      observed: [
        "provider：duffel",
        `flight result：${comparison.flights?.resultCode || "not_requested"}`,
        `hotel result：${comparison.hotels?.resultCode || "not_requested"}`,
        "外部浏览器：未打开"
      ],
      unknown: ["其他供应商库存", "线下或官网实时余量"],
      next: ["调整日期/路线/人数后重试", "或明确要求官方网页接管"]
    });
    result.boundaries.push("不把 Duffel 无结果推断为现实无票或无房。");
    return result;
  }

  const lines = recommendation.items.map((item) => bookingItemLine(item.snapshot));
  const result = response({
    opening: "我已通过 Duffel 查到可用于预确认的方案。",
    answer: `${lines.join("；")}。合计 ${recommendation.total_amount} ${recommendation.total_currency}。下一步不是付款，也不是打开外站；你确认候选后，Anna 才调用 booking_prepare 重新校验价格、库存、规则并生成确认页。`,
    observed: [
      "provider：duffel",
      `bookingType：${comparison.bookingType}`,
      `候选组合数：${comparison.bundles?.length || 0}`,
      `推荐方案：${recommendation.id}`,
      "外部浏览器：未打开"
    ],
    unknown: ["最终库存变化", "最终 fare rules / cancellation policy 是否变化", "用户是否确认候选"],
    next: ["用户选择候选", "调用 booking_prepare 生成确认页", "用户逐项勾选后才创建 sandbox/test order", "付款由用户本人完成"]
  });
  result.booking = {
    provider: "duffel",
    bookingType: comparison.bookingType,
    recommendationId: recommendation.id,
    next_tool_action: "booking_prepare",
    opens_external_browser: false
  };
  result.boundaries.push("默认不打开外部浏览器；不会使用 Google Chrome for Testing 代替真实用户浏览器。");
  result.boundaries.push("不会收集证件号、护照号、银行卡、验证码或支付密码。");
  return result;
}

function bookingItemLine(snapshot) {
  if (!snapshot) return "方案详情待确认";
  if (snapshot.type === "flight") {
    return [
      `航班 ${snapshot.origin}→${snapshot.destination}`,
      `${formatTime(snapshot.departure_time)} 起飞`,
      `${formatTime(snapshot.arrival_time)} 到达`,
      `中转 ${snapshot.stops}`,
      `行李：${snapshot.baggage}`,
      `退改：${snapshot.refund_change_hint}`,
      `${snapshot.price?.total_amount} ${snapshot.price?.currency}`
    ].join("，");
  }
  return [
    `酒店 ${snapshot.hotel_name}`,
    `${snapshot.location?.city || "城市待确认"} / ${snapshot.location?.area || "区域待确认"}`,
    `${snapshot.nights} 晚`,
    `取消：${snapshot.cancellation_policy}`,
    `${snapshot.price?.total_amount} ${snapshot.price?.currency}`
  ].join("，");
}

function fieldLabel(field) {
  return {
    origin: "出发地",
    destination: "目的地",
    hotelDestination: "酒店城市",
    departureDate: "出发日期",
    checkinDate: "入住日期"
  }[field] || field;
}

function formatTime(value) {
  if (!value) return "时间待确认";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function safetyResponse(message) {
  return response({
    opening: "这个请求涉及潜在伤害或未授权攻击风险。",
    answer: "我不能帮助窃取账号、绕过登录、投放恶意软件、隐藏痕迹或攻击第三方系统。可以改为在授权范围内做防御排查、日志分析、风险建模、加固建议或安全测试计划。",
    observed: message ? [`用户请求包含高风险意图：${message.slice(0, 120)}`] : ["检测到高风险安全意图"],
    unknown: ["是否具备明确授权", "测试范围与交战规则"],
    next: ["确认合法授权和测试范围", "改写为防御性目标，例如加固、检测、复盘或靶场学习"]
  });
}

function companionResponse(message) {
  return response({
    opening: "我听到的重点是：这件事既需要被认真理解，也需要一个能推进的下一步。",
    answer: message
      ? "先把可确认的事实、你的感受或影响、以及仍未确定的解释分开。这样既不会否定体验，也不会把推测说成事实。"
      : "你可以写下发生了什么，我会先确认理解，再一起判断或行动。",
    observed: message ? [`用户提供的原话：${message.slice(0, 180)}`] : ["尚未提供具体事件"],
    unknown: ["他人的动机", "未提供的背景"],
    next: ["明确你现在要的是倾听、判断还是行动", "选择一个最小且可逆的下一步"]
  });
}

function decisionResponse(message) {
  return response({
    opening: "这个问题适合用决策而不是单一结论来处理。",
    answer: "我会区分已知事实、仍不确定的预测、你的优先级、不可妥协的边界，以及每个选项是否可逆。先做低代价的小测试，通常比在信息不足时追求一次性正确更稳。",
    observed: message ? [`待判断的问题：${message.slice(0, 180)}`] : ["尚未提供具体选项"],
    unknown: ["各选项的真实代价", "最重要的用户价值排序"],
    next: ["列出两个以上可行选项", "说明最重视速度、安全、关系还是可逆性"]
  });
}

function multimodalResponse(route) {
  const kinds = [...new Set(route.attachments.map((item) => item.kind))];
  return response({
    opening: `已识别 ${route.attachments.length} 个附件。`,
    answer: `这个请求需要 ${route.required_capabilities.join(" + ")} 能力。实验版只读取附件元数据并完成模型路由，不上传文件内容；在 Anna 主机中应由具备对应能力的模型接手。`,
    observed: route.attachments.map((item) => `${item.name} · ${item.type || item.kind}`),
    unknown: kinds.includes("image") || kinds.includes("audio")
      ? ["附件实际内容", "Anna 主机最终选择的模型"]
      : ["附件实际内容"],
    next: ["在 Anna 主机确认模型能力", "用户明确发送后再处理附件内容"]
  });
}

function generalResponse(message, route) {
  return response({
    opening: "个人助理模式已经就绪。",
    answer: message
      ? "我会先理解目标，再选择模型能力与工具，并把数据来源和不确定点告诉你。"
      : "可以从天气、健康演示、决策梳理或多模态附件开始。",
    observed: [`当前路由：${route.intent}`],
    unknown: ["用户希望优先完成的具体结果"],
    next: ["选择一个快捷任务", "或直接输入你希望处理的事情"]
  });
}

function response({ opening, answer, observed, unknown, next }) {
  return {
    opening,
    answer,
    reasoning: {
      observed,
      inferred: [],
      unknown
    },
    next_actions: next,
    boundaries: [
      "不把单次健康数据当作诊断",
      "不在未同意时读取位置或健康数据",
      "不把推测写成事实",
      "不协助未授权攻击、凭据窃取、恶意软件或隐藏痕迹"
    ]
  };
}

function daypart(now) {
  const hour = new Date(now).getHours();
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function weatherLine(weather) {
  const w = weather.weather;
  const air = weather.air;
  return `${weather.location.label}现在${w.label}，气温 ${format(w.temperature_c)}°C，体感 ${format(w.apparent_temperature_c)}°C，湿度 ${format(w.humidity_percent)}%，风速 ${format(w.wind_kmh)} km/h。空气质量指数 ${format(air.us_aqi)}，PM2.5 ${format(air.pm2_5_ug_m3)} µg/m³。`;
}

function healthLine(health) {
  const snapshot = health.snapshot;
  return `我已连接本次授权的 HealthKit 快照：今日步数 ${format(snapshot.today_steps)} 步、最近心率 ${format(snapshot.heart_rate_bpm)} bpm、睡眠 ${minutes(snapshot.sleep_minutes_last_night)}。这些只用于日常提醒，不代表健康诊断。`;
}

function careSuggestion({ weather, health }) {
  const pieces = ["先喝一点水"];
  const sleep = Number(health?.snapshot?.sleep_minutes_last_night);
  if (Number.isFinite(sleep) && sleep < 420) {
    pieces.push("今天把咖啡因和高强度安排往前放，给晚上留出恢复空间");
  } else {
    pieces.push("早餐或下一餐优先选择有蛋白质、蔬菜和稳定碳水的组合");
  }
  const aqi = Number(weather?.air?.us_aqi);
  if (Number.isFinite(aqi) && aqi > 100) {
    pieces.push("空气质量一般，外出时间可以缩短，敏感时参考当地官方健康建议");
  } else if (weather) {
    pieces.push("外出前看一眼风和体感温度，按体感增减衣物");
  }
  return `${pieces.join("；")}。如果你有明显不适，以身体感受和专业医疗建议优先。`;
}

function nextPreflightActions({ weather, health, healthPermission }) {
  const actions = ["回答当前状态、今天重点和是否需要提醒"];
  if (!weather) actions.push("授权位置或手动填写坐标后更新天气空气");
  if (!health && healthPermission === "requested") {
    actions.push("选择是否连接 iPhone 或 Apple Watch 的健康快照");
  }
  if (health) actions.push("基于快照继续做非医疗性的饮食、休息和注意事项整理");
  return actions;
}

function format(value) {
  return Number.isFinite(Number(value)) ? Number(value) : "未知";
}

function minutes(value) {
  const total = Math.max(0, Number(value) || 0);
  return `${Math.floor(total / 60)} 小时 ${Math.round(total % 60)} 分钟`;
}

function productLabel(product) {
  return { flight: "机票", hotel: "酒店" }[product] || "旅行";
}

function budgetLabel(offer) {
  const budget = offer?.budget;
  if (!budget) return "预算待确认";
  return budget.label || "预算待确认";
}

function priceSourceLabel(offer) {
  if (offer?.inventory_status?.label) return offer.inventory_status.label;
  if (offer?.price_source === "sandbox_fixture") return "Sandbox 固定演示价，非真实库存";
  if (offer?.price_source === "anna_estimate_pending_official_inventory") {
    return "Anna 预估，官方实时库存与最终价待页面确认";
  }
  return "价格来源待确认";
}
