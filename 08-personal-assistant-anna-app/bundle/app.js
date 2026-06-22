const TOOL_ID = window.__ANNA_TOOL_IDS__?.["personal-assistant"]
  || "tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36";

const TRAVEL_OFFICIAL_SITES = {
  flight: [
    { id: "expedia", name: "Expedia Flights" },
    { id: "trip", name: "Trip.com Flights" },
    { id: "ctrip", name: "携程机票" }
  ],
  hotel: [
    { id: "booking", name: "Booking.com" },
    { id: "trip", name: "Trip.com Hotels" },
    { id: "ctrip", name: "携程酒店" },
    { id: "expedia", name: "Expedia Hotels" }
  ]
};

const state = {
  runtime: null,
  hostConnected: false,
  models: [],
  attachments: [],
  location: null,
  healthSessionId: null,
  travelOfficialSites: TRAVEL_OFFICIAL_SITES,
  travelRun: null,
  travelBundle: null,
  bookingComparison: null,
  selectedBookingBundle: null,
  learningStatus: null,
  lastResult: null,
  userKey: null,
  preflightAnnounced: false
};

const els = Object.fromEntries([
  "connectionStatus", "personaState", "personaDetail", "weatherBadge",
  "temperature", "weatherLabel", "weatherDetails", "aqi", "pm25",
  "humidity", "locationLabel", "latitude", "longitude", "locateButton",
  "weatherButton", "preflightButton", "healthBadge", "stepCount", "heartRate",
  "sleepValue", "healthConsent", "healthConnectButton",
  "healthDisconnectButton", "travelProduct", "travelOfficialSite", "travelOrigin",
  "travelDestination", "travelDate", "travelTripType", "travelReturnDate", "travelBudget",
  "travelAdults", "travelProvider", "travelPlanButton", "travelConfirmButton", "travelRejectButton",
  "travelNights", "travelOpenButton", "travelStatus", "travelResult", "travelSite",
  "travelRoute", "travelLink", "travelHandoffPacket", "travelFieldMode", "travelFieldList",
  "travelBundleSummary", "travelBoundary", "capabilityStrip", "modelSelect",
  "bookingStatus", "bookingType", "bookingFlightProvider", "bookingHotelProvider",
  "bookingOrigin", "bookingDestination", "bookingDepartureDate", "bookingReturnDate",
  "bookingAdults", "bookingCabinClass", "bookingFlightBudget", "bookingHotelLocation",
  "bookingHotelBudget", "bookingHotelNights", "bookingTravelers", "bookingCompareResult",
  "bookingSearchButton", "bookingPrepareButton", "bookingBoundary",
  "learningBadge", "learningScore", "learningSummary", "learningBooks",
  "learningCorrections", "learningCycleButton",
  "modelDecision", "assistantOutput", "attachmentTray", "assistantForm",
  "messageInput", "attachmentInput", "sendButton", "syncButton"
].map((id) => [id, document.getElementById(id)]));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.userKey = localUserKey();
  state.runtime = await connectAnna();
  const confirmationId = confirmationIdFromPath();
  if (confirmationId) {
    await renderBookingConfirmationPage(confirmationId);
    return;
  }
  bindEvents();
  await loadStatus();
  syncBookingTypeFields();
  await runPreflight({ announce: true });
}

function bindEvents() {
  document.querySelectorAll("[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".rail-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      els.messageInput.value = button.dataset.prompt;
      els.messageInput.focus();
    });
  });
  els.locateButton.addEventListener("click", useBrowserLocation);
  els.weatherButton.addEventListener("click", refreshWeather);
  els.preflightButton?.addEventListener("click", () => runPreflight({
    first_use: true,
    announce: true,
    force_announce: true
  }));
  els.healthConnectButton.addEventListener("click", connectHealth);
  els.healthDisconnectButton.addEventListener("click", disconnectHealth);
  els.travelProduct.addEventListener("change", () => {
    syncTravelDefaults();
    syncTravelSiteOptions({ preferDefault: true });
  });
  els.travelTripType.addEventListener("change", syncTravelDefaults);
  els.travelProvider.addEventListener("change", syncTravelSiteOptions);
  els.travelPlanButton.addEventListener("click", planTravel);
  els.travelConfirmButton.addEventListener("click", confirmTravelCandidate);
  els.travelRejectButton.addEventListener("click", rejectTravelCandidate);
  els.travelOpenButton.addEventListener("click", openTravelHandoff);
  els.travelLink.addEventListener("click", markCurrentHandoffOpened);
  els.bookingSearchButton?.addEventListener("click", searchBookingOptions);
  els.bookingPrepareButton?.addEventListener("click", prepareSelectedBooking);
  els.bookingType?.addEventListener("change", syncBookingTypeFields);
  els.learningCycleButton?.addEventListener("click", runLearningCycle);
  els.attachmentInput.addEventListener("change", addAttachments);
  els.assistantForm.addEventListener("submit", runAssistant);
  els.syncButton.addEventListener("click", syncToAnna);
}

async function connectAnna() {
  try {
    const { AnnaAppRuntime } = await import("/static/anna-apps/_sdk/latest/index.js");
    const anna = await AnnaAppRuntime.connect();
    state.hostConnected = true;
    els.connectionStatus.textContent = "已连接 Anna";
    return anna;
  } catch {
    state.hostConnected = false;
    els.connectionStatus.textContent = "Codex 本地实验";
    return null;
  }
}

async function loadStatus() {
  try {
    const status = await callAction("status");
    state.models = status.models || [];
    state.learningStatus = status.learning || null;
    state.travelOfficialSites = status.travel?.official_sites || TRAVEL_OFFICIAL_SITES;
    syncTravelSiteOptions();
    els.modelSelect.replaceChildren(...state.models.map((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      return option;
    }));
    els.personaDetail.textContent = `${state.models.length} 个模型配置可用于能力协商`;
    renderLearning(status.learning);
  } catch (error) {
    showError(error);
  }
}

async function runPreflight(overrides = {}) {
  const {
    announce = false,
    force_announce = false,
    ...toolArgs
  } = overrides;
  const location = currentLocationOrNull();
  setBusy("Anna 正在前置问候", "准备天气、空气与健康同意状态");
  try {
    const result = await callAction("preflight", {
      user_key: state.userKey,
      ...(location ? { location } : {}),
      ...toolArgs
    });
    if (result.context.weather) {
      state.location = {
        label: result.context.weather.location.label,
        latitude: result.context.weather.location.latitude,
        longitude: result.context.weather.location.longitude
      };
      renderWeather(result.context.weather);
    }
    if (result.context.health) {
      state.healthSessionId = result.context.health.session_id;
      renderHealth(result.context.health);
      els.healthDisconnectButton.disabled = false;
      els.healthConnectButton.disabled = true;
      els.healthBadge.textContent = healthBadgeLabel(result.context.health);
    }
    renderPreflight(result);
    if (announce) {
      await announcePreflightToAnna(result, { force: force_announce });
    }
    setIdle("前置问候已完成", result.next_actions.join("；"));
    return result;
  } catch (error) {
    showError(error);
    return null;
  }
}

async function useBrowserLocation() {
  if (!navigator.geolocation) {
    showError(new Error("当前浏览器不支持定位"));
    return;
  }
  setBusy("请求位置授权", "等待浏览器返回近似坐标");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      els.latitude.value = position.coords.latitude.toFixed(4);
      els.longitude.value = position.coords.longitude.toFixed(4);
      els.locationLabel.value = "我的位置";
      setIdle("位置已准备", "坐标尚未发送，点击更新天气后才会调用服务");
    },
    (error) => {
      showError(new Error(`定位未完成：${error.message}`));
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
}

async function refreshWeather() {
  const location = currentLocation();
  setBusy("正在读取环境", "向 Open-Meteo 发送近似坐标");
  try {
    const weather = await callAction("weather", { location });
    state.location = location;
    renderWeather(weather);
    setIdle("环境已更新", `${weather.location.label} · ${weather.observed_at}`);
  } catch (error) {
    showError(error);
  }
}

function renderWeather(data) {
  els.temperature.textContent = `${display(data.weather.temperature_c)}°`;
  els.weatherLabel.textContent = data.weather.label;
  els.weatherDetails.textContent = `体感 ${display(data.weather.apparent_temperature_c)}°C · 风速 ${display(data.weather.wind_kmh)} km/h`;
  els.aqi.textContent = display(data.air.us_aqi);
  els.pm25.textContent = display(data.air.pm2_5_ug_m3);
  els.humidity.textContent = `${display(data.weather.humidity_percent)}%`;
  els.weatherBadge.textContent = data.location.label;
}

async function connectHealth() {
  if (!els.healthConsent.checked) {
    showError(new Error("请先勾选本次会话的模拟健康数据同意项"));
    return;
  }
  setBusy("连接健康桥接", "只创建内存中的模拟会话");
  await runPreflight({
    first_use: true,
    health_consent: true,
    announce: true,
    force_announce: true
  });
}

async function disconnectHealth() {
  if (!state.healthSessionId) return;
  await callAction("health_disconnect", { session_id: state.healthSessionId }).catch(() => {});
  state.healthSessionId = null;
  els.heartRate.textContent = "--";
  els.stepCount.textContent = "--";
  els.sleepValue.textContent = "--";
  els.healthBadge.textContent = "模拟数据";
  els.healthConnectButton.disabled = false;
  els.healthDisconnectButton.disabled = true;
  setIdle("健康桥接已断开", "会话数据已经从内存移除");
}

function renderHealth(result) {
  const snapshot = result.snapshot;
  els.stepCount.textContent = display(snapshot.today_steps);
  els.heartRate.textContent = display(snapshot.heart_rate_bpm);
  const hours = Math.floor(snapshot.sleep_minutes_last_night / 60);
  const minutes = snapshot.sleep_minutes_last_night % 60;
  els.sleepValue.textContent = `${hours}h ${minutes}m`;
}

function healthBadgeLabel(result) {
  if (result?.bridge_kind === "demo") return "已连接 · 模拟";
  if (result?.bridge_kind === "ios-watchos-companion") return "已连接 · Companion";
  return "已连接 · HealthKit";
}

function syncTravelDefaults() {
  if (els.travelProduct.value === "hotel") {
    els.travelOrigin.value = "";
    els.travelDestination.value = els.travelDestination.value === "NRT" ? "Tokyo" : els.travelDestination.value;
    els.travelOrigin.placeholder = "酒店无需填写";
    els.travelNights.disabled = false;
    els.travelTripType.disabled = true;
    els.travelReturnDate.disabled = true;
  } else {
    els.travelOrigin.value = els.travelOrigin.value || "SHA";
    els.travelDestination.value = els.travelDestination.value === "Tokyo" ? "NRT" : els.travelDestination.value;
    els.travelOrigin.placeholder = "SHA";
    els.travelNights.disabled = true;
    els.travelTripType.disabled = false;
    els.travelReturnDate.disabled = els.travelTripType.value !== "roundtrip";
  }
}

function syncTravelSiteOptions({ preferDefault = false } = {}) {
  const product = els.travelProduct.value;
  const sites = state.travelOfficialSites?.[product] || TRAVEL_OFFICIAL_SITES[product] || [];
  const previous = els.travelOfficialSite.value;
  els.travelOfficialSite.replaceChildren(...sites.map((site) => {
    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = site.name;
    return option;
  }));
  if (!preferDefault && sites.some((site) => site.id === previous)) {
    els.travelOfficialSite.value = previous;
  } else if (sites[0]) {
    els.travelOfficialSite.value = sites[0].id;
  }
  els.travelOfficialSite.disabled = els.travelProvider.value !== "official-handoff";
}

async function planTravel() {
  const travel = travelPayload();
  setBusy("Anna 正在规划行程", "生成匿名搜索与人工接管步骤");
  try {
    const run = await callAction("travel_start", travel);
    state.travelRun = run;
    state.travelBundle = null;
    renderTravel(run);
    renderTravelBundle(null);
    renderResponse({
      opening: "Anna 已找到旅行候选",
      answer: `${run.selected_offer.confirmation_prompt}Anna 不会填写旅客身份信息、确认订单或付款。`,
      reasoning: {
        observed: [
          `状态：${run.state}`,
          `产品：${run.product}`,
          `平台：${run.selected_offer.handoff?.site?.name || run.provider}`,
          `预算：${run.selected_offer.budget?.label || "未提供"}`,
          `价格来源：${priceSourceLabel(run.selected_offer)}`
        ],
        unknown: ["真实库存与最终价格", "外站验证码或登录状态", "旅客身份与付款信息"]
      },
      next_actions: run.selected_offer.handoff
        ? ["确认此方案后打开外站，由用户完成验证码、登录和后续确认", "如果不满意，换平台再搜"]
        : ["继续 Sandbox 的人工确认门"]
    });
    setIdle("旅行接管已准备", `${run.selected_offer.title} · ${run.state}`);
  } catch (error) {
    showError(error);
  }
}

function travelPayload() {
  const product = els.travelProduct.value;
  const payload = {
    product,
    departureDate: els.travelDate.value,
    passengers: {
      adults: Number(els.travelAdults.value || 1)
    },
    provider: els.travelProvider.value
  };
  const origin = els.travelOrigin.value.trim();
  const destination = els.travelDestination.value.trim();
  if (product === "flight") {
    payload.origin = origin;
    payload.destination = destination;
    payload.tripType = els.travelTripType.value;
    if (payload.tripType === "roundtrip") payload.returnDate = els.travelReturnDate.value;
  } else {
    payload.destination = destination || origin;
    payload.nights = Number(els.travelNights.value || 1);
  }
  if (els.travelBudget.value) payload.budgetCny = Number(els.travelBudget.value);
  if (payload.provider === "official-handoff") {
    payload.official_site = els.travelOfficialSite.value;
  }
  return payload;
}

function renderTravel(run) {
  const offer = run.selected_offer;
  const handoff = offer.handoff;
  const awaitingConfirmation = run.state === "await_user_confirmation";
  const awaitingAuthorization = run.state === "await_booking_authorization";
  const awaitingOfficialSite = run.state === "await_official_site";
  const awaitingUserDetails = run.state === "await_user_details";
  const awaitingPayment = run.state === "await_payment";
  els.travelResult.hidden = false;
  els.travelStatus.textContent = travelStatusLabel(run.state);
  els.travelSite.textContent = handoff?.site?.name || run.provider;
  els.travelRoute.textContent = `${offer.schedule} · Anna预估 ${offer.price ?? "--"} ${offer.currency || "CNY"} · ${offer.budget?.label || "预算待确认"} · ${priceSourceLabel(offer)}`;
  els.travelConfirmButton.disabled = !(awaitingConfirmation || awaitingAuthorization || awaitingUserDetails || awaitingPayment);
  els.travelConfirmButton.textContent = awaitingAuthorization
    ? "授权订购接管"
    : awaitingUserDetails
      ? "资料已填完"
      : awaitingPayment
        ? "已到付款页"
        : "确认此方案";
  els.travelRejectButton.disabled = !awaitingConfirmation;
  els.travelOpenButton.disabled = !handoff?.url || !awaitingOfficialSite;
  els.travelLink.hidden = !handoff?.url || !awaitingOfficialSite;
  renderTravelFieldPacket(handoff, offer);
  if (handoff?.url) {
    els.travelLink.href = handoff.url;
    els.travelLink.textContent = `打开 ${handoff.site.name}`;
    els.travelBoundary.textContent = awaitingAuthorization
      ? "需要你授权订购接管后，Anna 才能打开官方页面继续；授权不包含付款，也不允许 Anna 读取姓名、证件、电话或支付信息。"
      : awaitingUserDetails
      ? "请在官方窗口中自行登录、填写姓名/证件/电话，或选择旅行 App 已保存的乘客/住客资料。完成后回到这里点“资料已填完”。"
      : awaitingPayment
      ? "Anna 已监测到订购流程进入付款前；现在必须由你本人检查订单并付款，Anna 不会点击支付。"
      : run.state === "payment_handoff"
      ? "已交还付款：请你本人在官方页面付款或取消。Anna 不保存订单号、页面文本或支付信息。"
      : awaitingConfirmation
      ? "Anna 已找到候选并等待你确认。确认后才会打开官方页面；拒绝后会换平台重新搜索。"
      : handoff.itinerary_in_url
      ? "即将离开 Anna：只把匿名行程字段放入官方搜索页；验证码、登录、旅客身份、确认订单和付款都由用户本人完成。"
      : "即将离开 Anna：该平台只打开官方入口，用户需手动输入匿名行程字段；验证码、登录、旅客身份、确认订单和付款都由用户本人完成。";
  } else {
    els.travelLink.removeAttribute("href");
    els.travelLink.textContent = "Sandbox 不打开外站";
    els.travelBoundary.textContent = "Sandbox 预览仍会停在旅客信息、订单确认和付款门。";
  }
}

function renderTravelBundle(bundle) {
  els.travelBundleSummary.hidden = !bundle?.runs?.length || bundle.runs.length < 2;
  els.travelBundleSummary.replaceChildren();
  if (els.travelBundleSummary.hidden) return;
  for (const run of bundle.runs) {
    const handoff = run.selected_offer?.handoff;
    const item = document.createElement("div");
    const product = document.createElement("b");
    product.textContent = run.product === "flight" ? "机票" : "酒店";
    const route = document.createElement("span");
    route.textContent = run.selected_offer?.schedule || "--";
    const mode = document.createElement("span");
    mode.textContent = `${handoff?.site?.name || run.provider} · ${run.selected_offer?.budget?.label || "预算待确认"} · ${priceSourceLabel(run.selected_offer)}`;
    item.append(product, route, mode);
    if (handoff?.url) {
      const open = document.createElement("a");
      open.href = handoff.url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.className = "bundle-open-button";
      open.dataset.bundleRunId = run.id;
      open.dataset.bundleProduct = run.product;
      open.textContent = run.state === "await_user_confirmation"
        ? `确认${run.product === "flight" ? "机票" : "酒店"}`
        : run.state === "await_booking_authorization"
          ? `授权${run.product === "flight" ? "机票" : "酒店"}`
          : `打开${run.product === "flight" ? "机票" : "酒店"}`;
      open.addEventListener("click", (event) => markTravelBundleItemOpened(run.id, event));
      item.append(open);
    }
    els.travelBundleSummary.append(item);
  }
}

function renderTravelFieldPacket(handoff, offer = null) {
  els.travelHandoffPacket.hidden = !handoff;
  els.travelFieldList.replaceChildren();
  if (!handoff) {
    els.travelFieldMode.textContent = "Sandbox";
    return;
  }
  els.travelFieldMode.textContent = handoff.itinerary_in_url
    ? "已写入官方搜索链接"
    : "需要用户手动输入";
  const fields = [
    ["类型", handoff.anonymous_fields.product === "flight" ? "机票" : "酒店"],
    ["出发地", handoff.anonymous_fields.origin || "不需要"],
    ["目的地 / 城市", handoff.anonymous_fields.destination || handoff.anonymous_fields.origin || "未填写"],
    ...(handoff.anonymous_fields.product === "hotel"
      ? [
        ["入住", handoff.anonymous_fields.checkinDate],
        ["退房", handoff.anonymous_fields.checkoutDate],
        ["晚数", handoff.anonymous_fields.nights]
      ]
      : [
        ["日期", handoff.anonymous_fields.departureDate],
        ["航程", handoff.anonymous_fields.tripType === "roundtrip" ? "往返" : "单程"],
        ["返程", handoff.anonymous_fields.returnDate || "无"]
      ]),
    ["预算 CNY", handoff.anonymous_fields.budgetCny || "未提供"],
    ["价格来源", priceSourceLabel(offer)],
    ["最终价状态", offer?.inventory_status?.final_price_confirmed ? "已确认" : "待官方页面确认"],
    ["成人", handoff.anonymous_fields.passengers?.adults],
    ["儿童", handoff.anonymous_fields.passengers?.children]
  ];
  for (const [label, value] of fields) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = String(value ?? "--");
    detail.dataset.field = label;
    els.travelFieldList.append(term, detail);
  }
}

function handoffMessage(handoff) {
  if (!handoff?.url) return "Sandbox 预览不会打开外部平台。";
  if (handoff.itinerary_in_url) return "官方搜索页已生成。";
  return "官方平台入口已准备，用户需要手动输入 Anna 展示的匿名行程字段。";
}

function priceSourceLabel(offer) {
  if (!offer) return "价格来源待确认";
  if (offer.inventory_status?.label) return offer.inventory_status.label;
  if (offer.price_source === "sandbox_fixture") return "Sandbox 固定演示价，非真实库存";
  if (offer.price_source === "anna_estimate_pending_official_inventory") {
    return "Anna 预估，官方实时库存与最终价待页面确认";
  }
  return "价格来源待确认";
}

async function openTravelHandoff() {
  const handoff = state.travelRun?.selected_offer?.handoff;
  if (!handoff?.url || state.travelRun?.state !== "await_official_site") return;
  openExternalHandoff(handoff.url);
  await continueCurrentHandoff();
}

async function markCurrentHandoffOpened(event) {
  const handoff = state.travelRun?.selected_offer?.handoff;
  if (!handoff?.url || state.travelRun?.state !== "await_official_site") {
    event.preventDefault();
    return;
  }
  continueCurrentHandoff();
}

async function confirmTravelCandidate() {
  const stateName = state.travelRun?.state;
  const action = {
    await_user_confirmation: ["booking_confirmed", "已确认候选", "下一步需要你授权订购接管；授权不包含付款。"],
    await_booking_authorization: ["booking_authorized", "已授权订购接管", "现在可以打开官方页面；Anna 只处理匿名行程和流程监测。"],
    await_user_details: ["traveler_info_completed", "已确认资料填写完成", "Anna 会停在付款前，把付款交还给你。"],
    await_payment: ["payment_prompt_shown", "已到付款页", "付款必须由你本人完成；Anna 不会付款。"]
  }[stateName];
  if (!action) return;
  await continueTravelCandidate(action[0], {
    opening: action[1],
    next: action[2]
  });
}

async function rejectTravelCandidate() {
  await continueTravelCandidate("candidate_rejected", {
    opening: "已换平台重新搜索",
    next: "请再次确认新候选，或继续换平台。"
  });
}

async function continueTravelCandidate(event, copy) {
  if (!state.travelRun?.id) return;
  try {
    const updated = await callAction("travel_continue", {
      run_id: state.travelRun.id,
      event
    });
    state.travelRun = updated;
    renderTravel(updated);
    renderResponse({
      opening: copy.opening,
      answer: `${updated.selected_offer.confirmation_prompt || updated.selected_offer.title} ${copy.next}`,
      reasoning: {
        observed: [
          `状态：${updated.state}`,
          `平台：${updated.selected_offer.handoff?.site?.name || updated.provider}`,
          `预算：${updated.selected_offer.budget?.label || "未提供"}`,
          `价格来源：${priceSourceLabel(updated.selected_offer)}`
        ],
        unknown: ["真实库存与最终价格", "外站验证码或登录状态", "旅客身份与付款信息"]
      },
      next_actions: updated.state === "await_official_site"
        ? ["打开官方页面", "由用户完成验证码、登录、身份信息、订单确认与付款"]
        : updated.state === "await_booking_authorization"
          ? ["授权订购接管", "或停止流程"]
          : updated.state === "await_user_details"
            ? ["用户在官方窗口填写或选择已保存资料", "完成后回到 Anna 标记资料已填完"]
            : updated.state === "await_payment"
              ? ["用户检查订单与价格", "到付款页后交还给用户付款"]
              : ["确认此方案", "或继续换平台再搜"]
    });
    setIdle(copy.opening, copy.next);
  } catch (error) {
    showError(error);
  }
}

async function continueCurrentHandoff() {
  try {
    const updated = await callAction("travel_continue", {
      run_id: state.travelRun.id,
      event: "official_site_opened"
    });
    state.travelRun = updated;
    renderTravel(updated);
    setIdle("已进入人工接管", "外站验证、登录、旅客信息、订单确认与付款都等待用户处理");
  } catch (error) {
    showError(error);
  }
}

async function markTravelBundleItemOpened(runId, event) {
  const run = state.travelBundle?.runs?.find((item) => item.id === runId);
  if (!run?.selected_offer?.handoff?.url) return;
  if (run.state === "await_user_confirmation") {
    event?.preventDefault();
    try {
      const updated = await callAction("travel_continue", {
        run_id: run.id,
        event: "booking_confirmed"
      });
      state.travelBundle = {
        ...state.travelBundle,
        runs: state.travelBundle.runs.map((item) => item.id === updated.id ? updated : item),
        primary_run: state.travelBundle.primary_run?.id === updated.id ? updated : state.travelBundle.primary_run
      };
      state.travelRun = updated;
      renderTravel(updated);
      renderTravelBundle(state.travelBundle);
      setIdle("组合候选已确认", "再次点击该项即可打开官方页面");
    } catch (error) {
      showError(error);
    }
    return;
  }
  if (run.state === "await_booking_authorization") {
    event?.preventDefault();
    try {
      const updated = await callAction("travel_continue", {
        run_id: run.id,
        event: "booking_authorized"
      });
      state.travelBundle = {
        ...state.travelBundle,
        runs: state.travelBundle.runs.map((item) => item.id === updated.id ? updated : item),
        primary_run: state.travelBundle.primary_run?.id === updated.id ? updated : state.travelBundle.primary_run
      };
      state.travelRun = updated;
      renderTravel(updated);
      renderTravelBundle(state.travelBundle);
      setIdle("组合候选已授权", "再次点击该项即可打开官方页面");
    } catch (error) {
      showError(error);
    }
    return;
  }
  if (run.state !== "await_official_site") {
    event?.preventDefault();
    return;
  }
  try {
    const updated = await callAction("travel_continue", {
      run_id: run.id,
      event: "official_site_opened"
    });
    state.travelBundle = {
      ...state.travelBundle,
      runs: state.travelBundle.runs.map((item) => item.id === updated.id ? updated : item),
      primary_run: state.travelBundle.primary_run?.id === updated.id ? updated : state.travelBundle.primary_run
    };
    state.travelRun = updated;
    renderTravel(updated);
    renderTravelBundle(state.travelBundle);
    setIdle("组合行程已进入人工接管", "外站验证、登录、旅客信息、订单确认与付款都等待用户处理");
  } catch (error) {
    showError(error);
  }
}

function openExternalHandoff(url) {
  const popup = window.open(url, "_blank");
  if (!popup) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    popup.opener = null;
  } catch {
    // Browser may reject opener mutation; the page still remains user-triggered.
  }
}

function syncBookingTypeFields() {
  if (!els.bookingType) return;
  const type = els.bookingType.value;
  const flightDisabled = type === "hotel";
  const hotelDisabled = type === "flight";
  [
    els.bookingFlightProvider,
    els.bookingOrigin,
    els.bookingReturnDate,
    els.bookingCabinClass,
    els.bookingFlightBudget
  ].forEach((input) => {
    if (input) input.disabled = flightDisabled;
  });
  [
    els.bookingHotelProvider,
    els.bookingHotelLocation,
    els.bookingHotelBudget,
    els.bookingHotelNights
  ].forEach((input) => {
    if (input) input.disabled = hotelDisabled;
  });
  els.bookingPrepareButton.disabled = !state.selectedBookingBundle;
}

async function searchBookingOptions() {
  setBusy("正在搜索 sandbox offer", "通过统一 provider adapter 比较机票与酒店");
  state.bookingComparison = null;
  state.selectedBookingBundle = null;
  els.bookingPrepareButton.disabled = true;
  try {
    const payload = bookingComparePayload();
    const comparison = await callAction("travel_compare", payload);
    state.bookingComparison = comparison;
    state.selectedBookingBundle = comparison.recommendation;
    renderBookingComparison(comparison);
    els.bookingPrepareButton.disabled = !comparison.recommendation;
    setIdle("预订方案已比较", `${comparison.bundles.length} 个 sandbox/test 方案可确认`);
  } catch (error) {
    showError(error);
  }
}

function bookingComparePayload() {
  const bookingType = els.bookingType.value;
  const adults = Number(els.bookingAdults.value || 1);
  const destination = els.bookingDestination.value.trim();
  const departureDate = els.bookingDepartureDate.value;
  const nights = Number(els.bookingHotelNights.value || 1);
  const payload = {
    bookingType,
    flightProvider: els.bookingFlightProvider.value,
    hotelProvider: els.bookingHotelProvider.value
  };
  if (bookingType !== "hotel") {
    payload.flight = {
      origin: els.bookingOrigin.value.trim(),
      destination,
      departureDate,
      returnDate: els.bookingReturnDate.value || null,
      cabinClass: els.bookingCabinClass.value,
      passengers: { adults },
      budget: els.bookingFlightBudget.value ? Number(els.bookingFlightBudget.value) : null
    };
  }
  if (bookingType !== "flight") {
    payload.hotel = {
      destination: destination === "NRT" ? "Tokyo" : destination,
      hotelLocation: els.bookingHotelLocation.value.trim() || null,
      checkinDate: departureDate,
      nights,
      guests: { adults },
      budget: els.bookingHotelBudget.value ? Number(els.bookingHotelBudget.value) : null
    };
  }
  return payload;
}

function renderBookingComparison(comparison) {
  els.bookingCompareResult.hidden = false;
  els.bookingCompareResult.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "booking-result-heading";
  const title = document.createElement("b");
  title.textContent = comparison.recommendation ? "推荐方案" : "未找到方案";
  const meta = document.createElement("span");
  meta.textContent = `${comparison.bookingType} · ${comparison.bundles.length} 个组合 · sandbox/test mode`;
  heading.append(title, meta);
  els.bookingCompareResult.append(heading);
  if (comparison.bundles.length === 0) {
    const note = document.createElement("p");
    note.className = "booking-empty-note";
    const supplierMessages = [
      comparison.flights?.message,
      comparison.hotels?.message
    ].filter(Boolean);
    note.textContent = supplierMessages[0] || "当前通过 Duffel 没有查到可预订报价。";
    els.bookingCompareResult.append(note);
  }
  comparison.bundles.slice(0, 3).forEach((bundle, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "booking-bundle-card";
    card.classList.toggle("active", state.selectedBookingBundle?.id === bundle.id || (!state.selectedBookingBundle && index === 0));
    card.addEventListener("click", () => {
      state.selectedBookingBundle = bundle;
      document.querySelectorAll(".booking-bundle-card").forEach((item) => item.classList.remove("active"));
      card.classList.add("active");
      els.bookingPrepareButton.disabled = false;
    });
    const bundleTitle = document.createElement("strong");
    bundleTitle.textContent = `${bundle.total_amount} ${bundle.total_currency}`;
    const summary = document.createElement("span");
    summary.textContent = bundle.summary;
    card.append(bundleTitle, summary);
    for (const item of bundle.items) {
      card.append(bookingSnapshotLine(item.snapshot));
    }
    els.bookingCompareResult.append(card);
  });
}

function bookingSnapshotLine(snapshot) {
  const line = document.createElement("small");
  if (snapshot.type === "flight") {
    line.textContent = [
      `航班：${snapshot.origin} → ${snapshot.destination}`,
      `起飞 ${formatDateTime(snapshot.departure_time)}`,
      `到达 ${formatDateTime(snapshot.arrival_time)}`,
      `中转 ${snapshot.stops}`,
      `行李 ${snapshot.baggage}`,
      `退改 ${snapshot.refund_change_hint}`
    ].join(" · ");
  } else {
    line.textContent = [
      `酒店：${snapshot.hotel_name}`,
      `${snapshot.location.city} / ${snapshot.location.area}`,
      `${snapshot.nights}晚`,
      `取消：${snapshot.cancellation_policy}`
    ].join(" · ");
  }
  return line;
}

async function prepareSelectedBooking() {
  const bundle = state.selectedBookingBundle;
  if (!bundle) return;
  setBusy("正在生成确认页", "Anna 会重新校验 offer 并保存订单快照");
  try {
    const comparePayload = bookingComparePayload();
    const response = await callAction("booking_prepare", {
      userId: state.userKey,
      bookingType: comparePayload.bookingType,
      items: bundle.items.map((item) => ({
        type: item.type,
        provider: item.provider,
        offerId: item.offerId,
        criteria: item.type === "flight" ? comparePayload.flight : comparePayload.hotel
      })),
      travelers: bookingTravelers()
    });
    setIdle("确认页已生成", "请在完整确认页勾选后再创建 test order");
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#/booking/confirm/${encodeURIComponent(response.confirmationId)}`
    );
    await renderBookingConfirmationPage(response.confirmationId);
  } catch (error) {
    showError(error);
  }
}

function bookingTravelers() {
  const lines = String(els.bookingTravelers.value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const adults = Number(els.bookingAdults.value || 1);
  const count = Math.max(1, Math.min(9, lines.length || adults));
  return Array.from({ length: count }, (_, index) => ({
    type: "adult",
    displayName: lines[index] || ""
  }));
}

function confirmationIdFromPath() {
  const match = window.location.pathname.match(/^\/booking\/confirm\/([^/]+)$/);
  if (match) return decodeURIComponent(match[1]);
  const hashMatch = window.location.hash.match(/^#\/booking\/confirm\/([^/]+)$/);
  return hashMatch ? decodeURIComponent(hashMatch[1]) : null;
}

async function renderBookingConfirmationPage(confirmationId) {
  document.body.classList.add("confirmation-mode");
  const shell = document.querySelector(".app-shell");
  shell.replaceChildren();
  const page = document.createElement("main");
  page.className = "confirmation-page";
  const header = document.createElement("header");
  header.className = "confirmation-header";
  header.innerHTML = "<span>ANNA BOOKING CONFIRMATION</span><h1>人工确认订单</h1><p>创建订单前请逐项核对。Anna 不自动付款，不保存证件号、护照号或银行卡。</p>";
  const body = document.createElement("section");
  body.className = "confirmation-body";
  body.textContent = "正在读取确认记录...";
  page.append(header, body);
  shell.append(page);
  try {
    const confirmation = await callAction("booking_get_confirmation", { confirmationId });
    body.replaceChildren(...confirmationSections(confirmation), confirmationChecklist(confirmation));
  } catch (error) {
    body.textContent = `确认记录读取失败：${error.message || error}`;
  }
}

function confirmationSections(confirmation) {
  const sections = [];
  if (confirmation.flight_snapshot) {
    sections.push(confirmationCard("航班详情", [
      ["价格", `${confirmation.flight_snapshot.price.total_amount} ${confirmation.flight_snapshot.price.currency}`],
      ["航线", `${confirmation.flight_snapshot.origin} → ${confirmation.flight_snapshot.destination}`],
      ["起飞", formatDateTime(confirmation.flight_snapshot.departure_time)],
      ["到达", formatDateTime(confirmation.flight_snapshot.arrival_time)],
      ["中转次数", confirmation.flight_snapshot.stops],
      ["行李信息", confirmation.flight_snapshot.baggage],
      ["退改签提示", confirmation.flight_snapshot.refund_change_hint],
      ["Provider", confirmation.flight_snapshot.provider]
    ]));
  }
  if (confirmation.hotel_snapshot) {
    sections.push(confirmationCard("酒店详情", [
      ["价格", `${confirmation.hotel_snapshot.price.total_amount} ${confirmation.hotel_snapshot.price.currency}`],
      ["酒店", confirmation.hotel_snapshot.hotel_name],
      ["位置", `${confirmation.hotel_snapshot.location.city} / ${confirmation.hotel_snapshot.location.area}`],
      ["入住", confirmation.hotel_snapshot.checkin_date],
      ["退房", confirmation.hotel_snapshot.checkout_date],
      ["晚数", confirmation.hotel_snapshot.nights],
      ["取消政策", confirmation.hotel_snapshot.cancellation_policy],
      ["Provider", confirmation.hotel_snapshot.provider]
    ]));
  }
  sections.push(confirmationCard("乘客/住客信息", [
    ["人数", confirmation.traveler_snapshot.count],
    ["展示名", confirmation.traveler_snapshot.travelers.map((traveler) => traveler.display_name).join("，")],
    ["证件保存", confirmation.traveler_snapshot.plaintext_documents_saved ? "异常：已保存" : "未保存"],
    ["银行卡保存", confirmation.traveler_snapshot.plaintext_payment_saved ? "异常：已保存" : "未保存"]
  ]));
  sections.push(confirmationCard("总价与付款政策", [
    ["总价", `${confirmation.total_amount} ${confirmation.total_currency}`],
    ["状态", confirmation.status],
    ["有效期", formatDateTime(confirmation.expires_at)],
    ["付款政策", confirmation.payment_policy.message],
    ["自动付款", confirmation.payment_policy.auto_payment ? "允许" : "禁止"]
  ]));
  return sections;
}

function confirmationCard(title, rows) {
  const card = document.createElement("article");
  card.className = "confirmation-card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const dl = document.createElement("dl");
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value ?? "--");
    dl.append(dt, dd);
  }
  card.append(heading, dl);
  return card;
}

function confirmationChecklist(confirmation) {
  const panel = document.createElement("article");
  panel.className = "confirmation-checklist";
  const title = document.createElement("h2");
  title.textContent = "人工确认";
  const checks = [
    "我已核对航班/酒店日期、人数、价格和库存提示",
    "我已阅读行李信息、退改签规则和酒店取消政策",
    "我理解 Anna 不会创建供应商订单、自动付款或保存银行卡信息",
    "如果价格变化或库存不可用，本次确认必须重新开始"
  ];
  const button = document.createElement("button");
  button.className = "solid-button";
  button.type = "button";
  button.textContent = "确认并进入人工交接";
  button.disabled = true;
  const boxes = checks.map((copy) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => {
      button.disabled = !boxes.every((item) => item.querySelector("input").checked);
    });
    const span = document.createElement("span");
    span.textContent = copy;
    label.append(input, span);
    return label;
  });
  const result = document.createElement("p");
  result.className = "confirmation-result";
  button.addEventListener("click", async () => {
    button.disabled = true;
    result.textContent = "正在最终校验价格和库存...";
    try {
      const response = await callAction("booking_confirm", {
        confirmationId: confirmation.id,
        userConfirmed: true
      });
      if (response.code === "USER_CHECKOUT_REQUIRED") {
        result.textContent = response.message || "已完成复核并记录人工确认；后续 checkout 必须由用户本人控制。";
      } else if (response.code === "PRICE_CHANGED") {
        result.textContent = "价格已变化：请返回搜索并重新生成确认页。";
      } else if (response.code === "UNAVAILABLE") {
        result.textContent = "库存不可用：请返回搜索并重新选择。";
      } else {
        result.textContent = `${response.code || response.status}: ${response.message || "无法确认"}`;
      }
    } catch (error) {
      result.textContent = `确认失败：${error.message || error}`;
      button.disabled = false;
    }
  });
  panel.append(title, ...boxes, button, result);
  return panel;
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderPreflight(result) {
  els.assistantOutput.replaceChildren();
  const label = document.createElement("span");
  label.className = "output-label";
  label.textContent = "ANNA";
  const title = document.createElement("h3");
  title.textContent = "个人助理模式前置问候";
  const list = document.createElement("div");
  list.className = "preflight-list";
  for (const message of result.messages) {
    const item = document.createElement("p");
    item.dataset.kind = message.kind;
    item.textContent = message.text;
    list.append(item);
  }
  const grid = document.createElement("div");
  grid.className = "reasoning-grid";
  grid.append(
    reasoningCell("权限状态", [
      `位置：${result.context.permissions.location}`,
      `健康：${result.context.permissions.health}`
    ]),
    reasoningCell("下一步", result.next_actions),
    reasoningCell("边界", result.boundaries)
  );
  els.assistantOutput.append(label, title, list, grid);
}

async function announcePreflightToAnna(result, { force = false } = {}) {
  if (!state.runtime?.chat?.write_message) return;
  if (state.preflightAnnounced && !force) return;
  const content = [
    "Anna 个人助理模式已启动。",
    ...result.messages.map((message) => message.text),
    `下一步：${result.next_actions.join("；")}`,
    `边界：${result.boundaries.join("；")}`
  ].join("\n");
  try {
    await state.runtime.chat.write_message({
      role: "assistant",
      content
    });
    state.preflightAnnounced = true;
  } catch (error) {
    console.warn("Preflight chat announcement failed", error);
  }
}

function addAttachments(event) {
  const files = [...event.target.files].slice(0, 6 - state.attachments.length);
  for (const file of files) {
    state.attachments.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      size: file.size,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null
    });
  }
  event.target.value = "";
  renderAttachments();
}

function renderAttachments() {
  els.attachmentTray.hidden = state.attachments.length === 0;
  els.attachmentTray.replaceChildren(...state.attachments.map((attachment) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    if (attachment.preview) {
      const image = document.createElement("img");
      image.src = attachment.preview;
      image.alt = "";
      chip.append(image);
    }
    const label = document.createElement("span");
    label.textContent = attachment.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.ariaLabel = `移除 ${attachment.name}`;
    remove.addEventListener("click", () => {
      if (attachment.preview) URL.revokeObjectURL(attachment.preview);
      state.attachments = state.attachments.filter((item) => item.id !== attachment.id);
      renderAttachments();
    });
    chip.append(label, remove);
    return chip;
  }));
}

async function runAssistant(event) {
  event.preventDefault();
  const message = els.messageInput.value.trim();
  if (!message && state.attachments.length === 0) {
    showError(new Error("请先输入任务或添加附件"));
    return;
  }
  if (state.travelRun?.state === "await_user_confirmation" && isTravelAffirmative(message)) {
    await confirmTravelCandidate();
    els.messageInput.value = "";
    return;
  }
  if (state.travelRun?.state === "await_user_confirmation" && isTravelNegative(message)) {
    await rejectTravelCandidate();
    els.messageInput.value = "";
    return;
  }
  setBusy("正在选择能力", "分析文本、附件与可用工具");
  try {
    const result = await callAction("assist", {
      message,
      attachments: state.attachments.map(({ id, name, type, size }) => ({ id, name, type, size })),
      preferred_model: els.modelSelect.value || "anna-auto",
      location: state.location,
      health_session_id: state.healthSessionId
    });
    state.lastResult = result;
    renderRoute(result.route);
    if (result.context?.travel?.kind === "travel_bundle") {
      const primary = result.context.travel.primary_run || result.context.travel.runs?.[0];
      state.travelRun = primary;
      state.travelBundle = result.context.travel;
      syncTravelFormFromQuery(primary?.query);
      renderTravel(primary);
      renderTravelBundle(result.context.travel);
    } else if (result.context?.travel?.selected_offer) {
      state.travelRun = result.context.travel;
      state.travelBundle = null;
      syncTravelFormFromQuery(result.context.travel.query);
      renderTravel(result.context.travel);
      renderTravelBundle(null);
    }
    if (result.context?.booking?.comparison) {
      const comparison = result.context.booking.comparison;
      state.bookingComparison = comparison;
      state.selectedBookingBundle = comparison.recommendation;
      syncBookingFormFromPayload(result.context.booking.input);
      renderBookingComparison(comparison);
      els.bookingPrepareButton.disabled = !comparison.recommendation;
    }
    renderResponse(result.response);
    renderLearningFromResult(result);
    els.syncButton.disabled = !state.hostConnected;
    setIdle("回复结构已生成", `${result.route.intent} · ${result.route.selected_model.label}`);
  } catch (error) {
    showError(error);
  }
}

function syncBookingFormFromPayload(payload) {
  if (!payload || !els.bookingType) return;
  els.bookingType.value = payload.bookingType || els.bookingType.value;
  if (payload.flight) {
    els.bookingOrigin.value = payload.flight.origin || els.bookingOrigin.value;
    els.bookingDestination.value = payload.flight.destination || els.bookingDestination.value;
    els.bookingDepartureDate.value = payload.flight.departureDate || els.bookingDepartureDate.value;
    els.bookingReturnDate.value = payload.flight.returnDate || "";
    els.bookingCabinClass.value = payload.flight.cabinClass || els.bookingCabinClass.value;
    els.bookingAdults.value = payload.flight.passengers?.adults || els.bookingAdults.value;
    els.bookingFlightBudget.value = payload.flight.budget || "";
  }
  if (payload.hotel) {
    if (!payload.flight) {
      els.bookingDestination.value = payload.hotel.destination || els.bookingDestination.value;
    }
    els.bookingDepartureDate.value = payload.hotel.checkinDate || els.bookingDepartureDate.value;
    els.bookingHotelNights.value = payload.hotel.nights || els.bookingHotelNights.value;
    els.bookingHotelLocation.value = payload.hotel.hotelLocation || "";
    els.bookingAdults.value = payload.hotel.guests?.adults || els.bookingAdults.value;
    els.bookingHotelBudget.value = payload.hotel.budget || "";
  }
  syncBookingTypeFields();
}

function syncTravelFormFromQuery(query) {
  if (!query) return;
  els.travelProduct.value = query.product || els.travelProduct.value;
  syncTravelDefaults();
  syncTravelSiteOptions();
  els.travelOrigin.value = query.origin || "";
  els.travelDestination.value = query.destination || query.origin || "";
  els.travelDate.value = query.departureDate || els.travelDate.value;
  els.travelTripType.value = query.tripType || "oneway";
  els.travelReturnDate.value = query.returnDate || els.travelReturnDate.value;
  els.travelBudget.value = query.budgetCny || "";
  els.travelNights.value = query.nights || 1;
  els.travelAdults.value = query.passengers?.adults || 1;
  els.travelProvider.value = "official-handoff";
  syncTravelSiteOptions();
  syncTravelDefaults();
}

function travelStatusLabel(stateName) {
  return {
    await_user_confirmation: "等待用户确认",
    await_booking_authorization: "等待订购授权",
    await_official_site: "等待外站接管",
    await_user_details: "等待用户填写资料",
    await_payment: "等待付款交接",
    payment_handoff: "payment_handoff"
  }[stateName] || stateName;
}

function isTravelAffirmative(message) {
  return /^(是|确认|可以|订购|购买|yes|y|ok|confirm)$/i.test(message.trim());
}

function isTravelNegative(message) {
  return /^(否|不|不要|换一个|重新搜索|再搜|no|n|reject)$/i.test(message.trim());
}

async function runLearningCycle() {
  setBusy("正在进行强化学习", "自主学习书目原则、执行自测、复盘并强化记忆");
  const response = state.lastResult?.response || {
    opening: "个人助理模式强化学习",
    answer: "我会先自主学习，再自测、复盘，并把经验写入记忆。",
    reasoning: {
      observed: ["用户触发本次强化学习"],
      inferred: [],
      unknown: ["真实用户语境"]
    },
    next_actions: ["完成复盘并强化记忆"],
    boundaries: ["不复制受版权保护的书籍正文", "不保存原始私人对话"]
  };
  try {
    const cycle = await callAction("learning_cycle", {
      message: els.messageInput.value.trim() || "请进行本次强化学习并记住学习经验",
      route: state.lastResult?.route || { intent: "manual" },
      response,
      scenario: "user_requested_reinforcement"
    });
    state.learningStatus = {
      ...(state.learningStatus || {}),
      cycle_count: cycle.memory_update?.progress_after?.cycles_completed ||
        ((state.learningStatus?.cycle_count || 0) + 1),
      last_cycle: cycle,
      curriculum: state.learningStatus?.curriculum || cycle.reading_batch,
      memory: {
        ...(state.learningStatus?.memory || {}),
        progress: cycle.memory_update?.progress_after,
        experience_count: cycle.memory_update?.experience_count
      }
    };
    renderLearning(state.learningStatus);
    setIdle("强化学习已完成", `本轮自测 ${cycle.self_test.score} 分，经验已写入记忆`);
  } catch (error) {
    showError(error);
  }
}

function renderLearningFromResult(result) {
  const cycle = result.context?.learning || result.response?.learning || null;
  if (!cycle) return;
  const lastCycle = cycle.trial ? cycle : {
    id: cycle.cycle_id,
    mode: cycle.mode || "autonomous_reinforcement_learning",
    reading_phase: {
      total_books: cycle.total_books || 15
    },
    trial: {
      score: cycle.score,
      passed: cycle.passed
    },
    self_test: {
      score: cycle.self_test_score ?? cycle.score
    },
    corrections: cycle.corrections || [],
    retrospective: cycle.retrospective || null,
    memory_update: cycle.memory_update || null,
    reading_batch: (state.learningStatus?.curriculum || []).map((section) => ({
      category: section.category,
      label: section.label,
      books_read_this_cycle: section.required_books_per_cycle || section.books?.length || 0,
      books: section.books || []
    }))
  };
  state.learningStatus = {
    ...(state.learningStatus || {}),
    cycle_count: lastCycle.memory_update?.progress_after?.cycles_completed ||
      Math.max((state.learningStatus?.cycle_count || 0) + 1, 1),
    last_cycle: lastCycle,
    memory: {
      ...(state.learningStatus?.memory || {}),
      progress: lastCycle.memory_update?.progress_after,
      experience_count: lastCycle.memory_update?.experience_count
    }
  };
  renderLearning(state.learningStatus);
}

function renderLearning(status) {
  if (!status || !els.learningBooks) return;
  const last = status.last_cycle;
  const cycles = status.memory?.progress?.cycles_completed || status.cycle_count || 0;
  els.learningBadge.textContent = last ? `已记忆 ${cycles} 次` : "等待强化指示";
  els.learningScore.textContent = last?.self_test?.score != null
    ? `${last.self_test.score}`
    : last?.trial?.score != null
      ? `${last.trial.score}`
      : "--";
  els.learningSummary.textContent = last
    ? `已完成 ${last.reading_phase?.total_books || 15} 本书目级自主学习、自测、复盘，并强化本次学习记忆。`
    : "Anna会进行自主学习并强化本次学习的记忆。";
  const curriculum = status.curriculum || last?.reading_batch || [];
  els.learningBooks.replaceChildren(...curriculum.map((section) => learningBookColumn(section)));
  renderLearningCorrections(last?.corrections || []);
}

function learningBookColumn(section) {
  const column = document.createElement("div");
  column.className = "learning-book-column";
  const title = document.createElement("b");
  const count = section.required_books_per_cycle || section.books_read_this_cycle || section.books?.length || 0;
  title.textContent = `${section.label || section.category} · ${count} 本`;
  const list = document.createElement("ul");
  for (const book of (section.books || []).slice(0, 5)) {
    const item = document.createElement("li");
    item.textContent = `${book.title} · ${(book.focus || []).slice(0, 2).join(" / ")}`;
    list.append(item);
  }
  column.append(title, list);
  return column;
}

function renderLearningCorrections(corrections) {
  if (!els.learningCorrections) return;
  const retrospective = state.learningStatus?.last_cycle?.retrospective;
  els.learningCorrections.hidden = corrections.length === 0 && !retrospective;
  els.learningCorrections.replaceChildren();
  if (corrections.length === 0 && !retrospective) return;
  const heading = document.createElement("b");
  heading.textContent = "本轮复盘与强化";
  const list = document.createElement("ul");
  if (retrospective?.summary) {
    const item = document.createElement("li");
    item.textContent = retrospective.summary;
    list.append(item);
  }
  for (const correction of corrections.slice(0, 4)) {
    const item = document.createElement("li");
    item.textContent = `${correction.issue}：${correction.revision}`;
    list.append(item);
  }
  els.learningCorrections.append(heading, list);
}

function renderRoute(route) {
  document.querySelectorAll("[data-capability]").forEach((item) => {
    item.classList.toggle("active", route.required_capabilities.includes(item.dataset.capability));
  });
  els.modelDecision.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = route.selected_model.label;
  const detail = document.createElement("span");
  detail.textContent = route.warning
    || `任务需要：${route.required_capabilities.join(" + ")}；${route.selected_model.note}`;
  els.modelDecision.append(title, detail);
}

function renderResponse(response) {
  els.assistantOutput.replaceChildren();
  const label = document.createElement("span");
  label.className = "output-label";
  label.textContent = "ANNA";
  const title = document.createElement("h3");
  title.textContent = response.opening;
  const answer = document.createElement("p");
  answer.textContent = response.answer;
  const grid = document.createElement("div");
  grid.className = "reasoning-grid";
  grid.append(
    reasoningCell("已确认", response.reasoning.observed),
    reasoningCell("仍未知", response.reasoning.unknown),
    reasoningCell("下一步", response.next_actions),
    reasoningCell("强化记忆", response.learning
      ? [
          `自测 ${response.learning.self_test_score ?? response.learning.score} 分`,
          "已写入学习记忆",
          ...(response.learning.corrections || []).slice(0, 2).map((item) => item.issue)
        ]
      : response.memory?.applied
        ? [`已应用 ${response.memory.applied_rules_count} 条学习经验`]
        : [])
  );
  els.assistantOutput.append(label, title, answer, grid);
}

function reasoningCell(title, items) {
  const cell = document.createElement("div");
  const heading = document.createElement("b");
  heading.textContent = title;
  const content = document.createElement("span");
  content.textContent = (items || []).join("；") || "无";
  cell.append(heading, content);
  return cell;
}

async function syncToAnna() {
  if (!state.runtime || !state.lastResult) return;
  const payload = state.lastResult;
  await state.runtime.chat.write_message({
    role: "user",
    content: [
      "请基于个人助理模式的结构化结果回复我。",
      `任务路由：${payload.route.intent}`,
      `需要能力：${payload.route.required_capabilities.join(", ")}`,
      `已确认：${payload.response.reasoning.observed.join("；")}`,
      `仍未知：${payload.response.reasoning.unknown.join("；")}`,
      `建议框架：${payload.response.answer}`
    ].join("\n")
  });
  els.syncButton.textContent = "已交给 Anna 对话";
  els.syncButton.disabled = true;
}

async function callAction(action, args = {}) {
  if (state.runtime) {
    const result = await state.runtime.tools.invoke({
      tool_id: TOOL_ID,
      method: "personal_assistant",
      args: { action, ...args }
    });
    if (result?.success === false) throw new Error(result.error?.message || "工具调用失败");
    return result?.data || result;
  }
  const endpoints = {
    status: ["/api/status", "GET"],
    preflight: ["/api/preflight", "POST"],
    weather: ["/api/weather", "POST"],
    permission_registry: ["/api/permissions", "POST"],
    confirmation_queue: ["/api/confirmations/list", "POST"],
    confirmation_get: ["/api/confirmations/get", "POST"],
    confirmation_resolve: ["/api/confirmations/resolve", "POST"],
    health_connect: ["/api/health/connect", "POST"],
    health_connect_demo: ["/api/health/connect", "POST"],
    health_disconnect: ["/api/health/disconnect", "POST"],
    health_snapshot: ["/api/health/snapshot", "POST"],
    travel_search: ["/api/travel/search", "POST"],
    travel_start: ["/api/travel/start", "POST"],
    travel_continue: ["/api/travel/continue", "POST"],
    travel_get: ["/api/travel/get", "POST"],
    travel_compare: ["/api/travel/compare", "POST"],
    booking_prepare: ["/api/booking/prepare", "POST"],
    booking_get_confirmation: ["/api/booking/confirmation", "POST"],
    booking_confirm: ["/api/booking/confirm", "POST"],
    assist: ["/api/assistant", "POST"]
  };
  const [url, method] = endpoints[action];
  const response = await fetch(url, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(args) : undefined
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

function currentLocation() {
  return {
    label: els.locationLabel.value.trim() || "当前位置",
    latitude: Number(els.latitude.value),
    longitude: Number(els.longitude.value)
  };
}

function currentLocationOrNull() {
  if (state.location) return state.location;
  if (!els.latitude.value.trim() || !els.longitude.value.trim()) return null;
  const location = currentLocation();
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return null;
  }
  return location;
}

function localUserKey() {
  try {
    const existing = localStorage.getItem("annaPersonalAssistantUserKey");
    if (existing) return existing;
    const created = `local-${crypto.randomUUID()}`;
    localStorage.setItem("annaPersonalAssistantUserKey", created);
    return created;
  } catch {
    return "local-preview";
  }
}

function setBusy(title, detail) {
  document.querySelector(".persona-stage").classList.add("busy");
  els.personaState.textContent = title;
  els.personaDetail.textContent = detail;
  els.sendButton.disabled = true;
}

function setIdle(title, detail) {
  document.querySelector(".persona-stage").classList.remove("busy");
  els.personaState.textContent = title;
  els.personaDetail.textContent = detail;
  els.sendButton.disabled = false;
}

function showError(error) {
  setIdle("需要调整", error.message || String(error));
  els.personaDetail.classList.add("error");
  window.setTimeout(() => els.personaDetail.classList.remove("error"), 2400);
}

function display(value) {
  return Number.isFinite(Number(value)) ? Number(value) : "--";
}
