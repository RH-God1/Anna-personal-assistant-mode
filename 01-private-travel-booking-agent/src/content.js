(function travelAgentContent() {
  const SETTINGS_KEY = "travelAgent.settings";
  const STATE_KEY = "travelAgent.safeState";
  const HIGHLIGHT_CLASS = "ta-sensitive-field";
  const SCAN_DELAY_MS = 900;
  const ACTION_COOLDOWN_MS = 1800;

  const SENSITIVE_FIELD_KEYWORDS = [
    "姓名",
    "乘机人",
    "旅客",
    "乘客",
    "联系人",
    "身份证",
    "证件",
    "护照",
    "台胞证",
    "港澳",
    "出生",
    "手机号",
    "手机号码",
    "电话",
    "邮箱",
    "银行卡",
    "信用卡",
    "借记卡",
    "cvv",
    "cvc",
    "验证码",
    "支付密码",
    "密码",
    "name",
    "passenger",
    "traveler",
    "guest",
    "contact",
    "passport",
    "identity",
    "id card",
    "phone",
    "mobile",
    "email",
    "card",
    "verification",
    "password"
  ];

  const PAYMENT_KEYWORDS = [
    "支付",
    "付款",
    "收银台",
    "银行卡",
    "信用卡",
    "借记卡",
    "支付密码",
    "微信支付",
    "支付宝",
    "银联",
    "payment",
    "cashier",
    "checkout",
    "wallet",
    "card number"
  ];

  const SUCCESS_KEYWORDS = [
    "支付成功",
    "付款成功",
    "预订成功",
    "订购成功",
    "订单完成",
    "出票中",
    "出票成功",
    "已确认",
    "booking confirmed",
    "payment successful",
    "payment success",
    "order complete",
    "reservation confirmed"
  ];

  const PENDING_PAYMENT_KEYWORDS = [
    "待支付",
    "待付款",
    "未支付",
    "订单待支付",
    "付款中",
    "支付中",
    "awaiting payment",
    "pending payment",
    "unpaid"
  ];

  const SAFE_ACTION_KEYWORDS = [
    "搜索",
    "查询",
    "筛选",
    "下一步",
    "继续",
    "选择",
    "查看",
    "search",
    "find",
    "filter",
    "next",
    "continue",
    "select",
    "view"
  ];

  const HUMAN_ACTION_KEYWORDS = [
    "去支付",
    "立即支付",
    "确认支付",
    "付款",
    "支付",
    "提交订单",
    "确认订单",
    "确认预订",
    "提交预订",
    "完成预订",
    "短信验证码",
    "验证码",
    "payment",
    "checkout",
    "submit order",
    "confirm order",
    "complete booking",
    "place order"
  ];

  let state = {
    active: false,
    phase: "idle",
    status: "未启动",
    lastAction: "等待启动",
    pausedReason: null,
    sensitiveFieldCount: 0,
    paymentDetectedAt: null,
    manualGate: null,
    manualGateUntil: 0
  };

  let settings = {
    autoNavigation: true,
    quietMode: true
  };

  let panel = null;
  let scanTimer = null;
  let lastActionAt = 0;
  let highlightedFields = [];

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "TRAVEL_AGENT_START") {
      void startAgent(message.settings).then(sendResponse);
      return true;
    }

    if (message.type === "TRAVEL_AGENT_STOP") {
      void stopAgent().then(sendResponse);
      return true;
    }

    if (message.type === "TRAVEL_AGENT_SCAN") {
      void scanPage({ allowNavigation: false }).then(() => sendResponse(publicState()));
      return true;
    }

    if (message.type === "TRAVEL_AGENT_STATUS") {
      sendResponse(publicState());
      return true;
    }

    return false;
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button, a, [role='button'], input[type='button'], input[type='submit']") : null;

    if (!target) {
      return;
    }

    if (state.active && hasHumanActionText(getElementText(target))) {
      setSafeState({
        phase: "user_confirmation",
        status: "等待用户确认",
        lastAction: "用户正在处理需要人工确认的动作",
        pausedReason: "human_action"
      });
      renderPanel();
      scheduleScan();
    }
  }, true);

  void hydrate();

  async function hydrate() {
    await loadSettings();
    chrome.storage.local.get([STATE_KEY], (result) => {
      const saved = result[STATE_KEY];

      if (saved && saved.active) {
        state = { ...state, ...saved };
        renderPanel();
        scheduleScan();
      }
    });
  }

  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SETTINGS_KEY], (result) => {
        settings = { ...settings, ...(result[SETTINGS_KEY] || {}) };
        resolve(settings);
      });
    });
  }

  async function startAgent(nextSettings) {
    await loadSettings();
    if (nextSettings) {
      settings = { ...settings, ...nextSettings };
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }

    setSafeState({
      active: true,
      phase: "running",
      status: "运行中",
      lastAction: "开始检测当前页面",
      pausedReason: null,
      sensitiveFieldCount: 0,
      paymentDetectedAt: null,
      manualGate: null,
      manualGateUntil: 0
    });
    renderPanel();
    await scanPage();
    return publicState();
  }

  async function stopAgent() {
    clearTimeout(scanTimer);
    clearHighlights();
    setSafeState({
      active: false,
      phase: "idle",
      status: "已停止",
      lastAction: "用户停止了 Agent",
      pausedReason: null,
      sensitiveFieldCount: 0,
      paymentDetectedAt: null,
      manualGate: null,
      manualGateUntil: 0
    });
    renderPanel();
    return publicState();
  }

  async function scanPage({ allowNavigation } = {}) {
    if (!state.active) {
      return;
    }

    await loadSettings();
    const shouldNavigate = allowNavigation === undefined
      ? settings.autoNavigation
      : allowNavigation === true;

    const successDetected = isSuccessPage();
    if (successDetected) {
      clearHighlights();
      setSafeState({
        phase: "post_payment",
        status: "已捕捉付款完成",
        lastAction: "检测到订单或支付完成状态",
        pausedReason: null,
        sensitiveFieldCount: 0,
        manualGate: null,
        manualGateUntil: 0
      });
      renderPanel();
      scheduleScan(2200);
      return;
    }

    const gateCooldownActive = Boolean(state.manualGate) && Date.now() < state.manualGateUntil;
    const skipSensitiveScan = state.manualGate === "sensitive_confirmation" && gateCooldownActive;
    const sensitiveFields = skipSensitiveScan ? [] : findSensitiveFields();
    if (sensitiveFields.length > 0) {
      highlightFields(sensitiveFields);
      setSafeState({
        phase: "needs_user_input",
        status: "等待用户输入",
        lastAction: "检测到个人信息字段，已暂停",
        pausedReason: "sensitive_fields",
        sensitiveFieldCount: sensitiveFields.length,
        manualGate: null,
        manualGateUntil: 0
      });
      renderPanel();
      scheduleScan(1600);
      return;
    }

    clearHighlights();

    if (isPaymentPage()) {
      setSafeState({
        phase: "payment_hold",
        status: "等待用户付款",
        lastAction: "检测到付款页面，已暂停自动操作",
        pausedReason: "payment",
        sensitiveFieldCount: 0,
        paymentDetectedAt: state.paymentDetectedAt || Date.now(),
        manualGate: null,
        manualGateUntil: 0
      });
      renderPanel();
      scheduleScan(1400);
      return;
    }

    const humanAction = gateCooldownActive ? null : findHumanActionCandidate();
    if (humanAction) {
      setSafeState({
        phase: "user_confirmation",
        status: "等待用户确认",
        lastAction: "检测到可能提交订单或敏感信息的动作，已暂停",
        pausedReason: "human_action",
        sensitiveFieldCount: 0,
        manualGate: "human_action",
        manualGateUntil: Date.now() + 60000
      });
      renderPanel();
      scheduleScan(1600);
      return;
    }

    setSafeState({
      phase: "running",
      status: "运行中",
      pausedReason: null,
      sensitiveFieldCount: 0,
      manualGate: null,
      manualGateUntil: 0
    });
    renderPanel();

    if (shouldNavigate) {
      runSafeNavigationStep();
    }

    scheduleScan();
  }

  function runSafeNavigationStep() {
    if (Date.now() - lastActionAt < ACTION_COOLDOWN_MS) {
      return;
    }

    const candidate = findSafeActionCandidate();
    if (!candidate) {
      setSafeState({
        lastAction: "等待页面变化或用户选择"
      });
      renderPanel();
      return;
    }

    lastActionAt = Date.now();
    setSafeState({
      lastAction: `执行非敏感导航：${normalizeActionLabel(getElementText(candidate))}`
    });
    renderPanel();
    candidate.click();
  }

  function findSensitiveFields() {
    const fields = Array.from(document.querySelectorAll("input, textarea, select"))
      .filter(isVisible)
      .filter((field) => !isSearchOnlyField(field))
      .filter((field) => {
        const type = (field.getAttribute("type") || "").toLowerCase();
        if (["hidden", "button", "submit", "reset", "checkbox", "radio"].includes(type)) {
          return false;
        }

        if (["password", "tel", "email"].includes(type)) {
          return true;
        }

        return includesAny(collectFieldContext(field), SENSITIVE_FIELD_KEYWORDS);
      });

    return fields.slice(0, 12);
  }

  function findSafeActionCandidate() {
    return getClickableCandidates().find((element) => {
      const label = getElementText(element);

      if (!label || hasHumanActionText(label)) {
        return false;
      }

      if (isInsideSensitiveArea(element)) {
        return false;
      }

      return includesAny(label, SAFE_ACTION_KEYWORDS);
    });
  }

  function findHumanActionCandidate() {
    return getClickableCandidates().find((element) => {
      const label = getElementText(element);

      if (!label) {
        return false;
      }

      return hasHumanActionText(label) || isInsideSensitiveArea(element);
    });
  }

  function getClickableCandidates() {
    const selector = [
      "button",
      "a[href]",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']"
    ].join(",");

    return Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .filter((element) => !isAgentUi(element))
      .filter((element) => !element.disabled)
      .filter((element) => element.getAttribute("aria-disabled") !== "true")
      .slice(0, 160);
  }

  function isPaymentPage() {
    const bodyText = getVisiblePageText();
    const href = window.location.href.toLowerCase();

    if (includesAny(getVisiblePageText({ includeActions: false }), SUCCESS_KEYWORDS)) {
      return false;
    }

    return includesAny(bodyText, PAYMENT_KEYWORDS) || /\/(?:pay|payment|cashier|checkout)(?:[/?#-]|$)/.test(href);
  }

  function isSuccessPage() {
    const bodyText = getVisiblePageText({ includeActions: false });
    const hasPendingPaymentText = includesAny(bodyText, PENDING_PAYMENT_KEYWORDS);

    if (hasPendingPaymentText && !includesAny(bodyText, SUCCESS_KEYWORDS)) {
      return false;
    }

    return includesAny(bodyText, SUCCESS_KEYWORDS);
  }

  function collectFieldContext(field) {
    const parts = [
      field.getAttribute("name"),
      field.getAttribute("id"),
      field.getAttribute("placeholder"),
      field.getAttribute("aria-label"),
      field.getAttribute("autocomplete"),
      getLabelText(field),
      getNearbyText(field)
    ];

    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  function getLabelText(field) {
    const id = field.getAttribute("id");
    const labels = [];

    if (id) {
      labels.push(...Array.from(document.querySelectorAll(`label[for='${cssEscape(id)}']`)));
    }

    const wrappedLabel = field.closest("label");
    if (wrappedLabel) {
      labels.push(wrappedLabel);
    }

    return labels.map((label) => label.textContent || "").join(" ");
  }

  function getNearbyText(field) {
    const parent = field.closest("li, label, div, section, form, td, tr") || field.parentElement;
    if (!parent) {
      return "";
    }

    return (parent.textContent || "").slice(0, 220);
  }

  function getVisiblePageText({ includeActions = true } = {}) {
    const selector = includeActions
      ? "h1, h2, h3, button, a, [role='button'], label, strong, p, span"
      : "h1, h2, h3, label, strong, p, span";

    const candidates = Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .filter((element) => !isAgentUi(element))
      .map((element) => element.textContent || "")
      .join(" ");

    return candidates.slice(0, 12000).toLowerCase();
  }

  function getElementText(element) {
    if (!element) {
      return "";
    }

    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("value"),
      element.textContent
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function normalizeActionLabel(label) {
    const cleaned = (label || "").replace(/\s+/g, " ").trim();
    if (!cleaned) {
      return "继续";
    }

    return cleaned.length > 16 ? `${cleaned.slice(0, 16)}...` : cleaned;
  }

  function isSearchOnlyField(field) {
    const context = collectFieldContext(field);
    const safeWords = ["出发", "到达", "城市", "日期", "入住", "离店", "目的地", "关键字", "航班", "车次", "origin", "destination", "date", "city", "hotel", "keyword"];
    return includesAny(context, safeWords) && !includesAny(context, SENSITIVE_FIELD_KEYWORDS);
  }

  function isInsideSensitiveArea(element) {
    const area = element.closest("form, section, div, li, tr, td");
    if (!area) {
      return false;
    }

    const text = (area.textContent || "").slice(0, 800).toLowerCase();
    return includesAny(text, SENSITIVE_FIELD_KEYWORDS) || includesAny(text, HUMAN_ACTION_KEYWORDS);
  }

  function hasHumanActionText(text) {
    return includesAny(text, HUMAN_ACTION_KEYWORDS);
  }

  function includesAny(source, keywords) {
    const haystack = String(source || "").toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || "1") > 0.01;
  }

  function isAgentUi(element) {
    return Boolean(element.closest(".ta-panel"));
  }

  function highlightFields(fields) {
    clearHighlights();
    highlightedFields = fields;
    highlightedFields.forEach((field) => field.classList.add(HIGHLIGHT_CLASS));
  }

  function clearHighlights() {
    highlightedFields.forEach((field) => field.classList.remove(HIGHLIGHT_CLASS));
    highlightedFields = [];
  }

  function renderPanel() {
    if (!state.active && state.phase === "idle" && panel) {
      panel.remove();
      panel = null;
      return;
    }

    if (!panel) {
      panel = document.createElement("section");
      panel.className = "ta-panel";
      panel.setAttribute("aria-live", "polite");
      document.body.appendChild(panel);
    }

    panel.dataset.phase = state.phase;

    const message = getPanelMessage();
    const meta = getPanelMeta();
    const primaryAction = getPrimaryAction();

    panel.innerHTML = `
      <div class="ta-panel__header">
        <h2 class="ta-panel__title">Travel Agent</h2>
        <span class="ta-panel__status">${escapeHtml(state.status)}</span>
      </div>
      <div class="ta-panel__body">
        <p class="ta-panel__message">${escapeHtml(message)}</p>
        <p class="ta-panel__meta">${escapeHtml(meta)}</p>
        <div class="ta-panel__actions">
          ${primaryAction ? `<button class="ta-button ta-button--primary" data-ta-action="${primaryAction.action}">${escapeHtml(primaryAction.label)}</button>` : ""}
          <button class="ta-button" data-ta-action="scan">重新扫描</button>
          <button class="ta-button ta-button--danger" data-ta-action="stop">停止</button>
        </div>
      </div>
    `;

    panel.querySelectorAll("[data-ta-action]").forEach((button) => {
      button.addEventListener("click", onPanelAction);
    });
  }

  function getPanelMessage() {
    if (state.phase === "needs_user_input") {
      return "页面需要个人信息。请你直接在网页字段中输入，我不会读取或保存这些值。";
    }

    if (state.phase === "payment_hold") {
      return "已进入付款步骤。请你自行完成付款，我不会点击付款按钮或读取支付信息。";
    }

    if (state.phase === "post_payment") {
      return "检测到付款或订单完成状态，可以继续后续页面检查。";
    }

    if (state.phase === "user_confirmation") {
      return "请在网页中自行确认订单或继续下一步；页面变化后我会继续检查。";
    }

    if (state.phase === "running") {
      return settings.autoNavigation ? "正在执行非敏感导航，并持续检查人工接管点。" : "正在观察页面，自动导航已关闭。";
    }

    return "Agent 已停止。";
  }

  function getPanelMeta() {
    if (state.phase === "needs_user_input") {
      return `已高亮 ${state.sensitiveFieldCount} 个字段。完成后点击“我已输入”。`;
    }

    if (state.phase === "user_confirmation") {
      return "我会等待页面跳转，不会点击确认订单或提交订单。";
    }

    return state.lastAction || "等待页面变化";
  }

  function getPrimaryAction() {
    if (state.phase === "needs_user_input") {
      return { action: "resume", label: "我已输入" };
    }

    if (state.phase === "payment_hold") {
      return { action: "scan", label: "我已付款，检查状态" };
    }

    if (state.phase === "user_confirmation") {
      return { action: "resume", label: "我已确认" };
    }

    if (state.phase === "post_payment") {
      return { action: "resume", label: "继续检查" };
    }

    return null;
  }

  function onPanelAction(event) {
    const action = event.currentTarget.getAttribute("data-ta-action");

    if (action === "stop") {
      void stopAgent();
      return;
    }

    if (action === "scan") {
      void scanPage({ allowNavigation: false });
      return;
    }

    if (action === "resume") {
      clearHighlights();
      if (state.phase === "needs_user_input") {
        setSafeState({
          phase: "user_confirmation",
          status: "等待用户确认",
          lastAction: "用户已输入信息，等待用户在网页中确认",
          pausedReason: "sensitive_fields_done",
          sensitiveFieldCount: 0,
          manualGate: "sensitive_confirmation",
          manualGateUntil: Date.now() + 60000
        });
      } else {
        setSafeState({
          phase: "running",
          status: "运行中",
          lastAction: "用户确认完成，继续检查页面",
          pausedReason: null,
          sensitiveFieldCount: 0,
          manualGate: null,
          manualGateUntil: 0
        });
      }
      renderPanel();
      scheduleScan(400);
    }
  }

  function scheduleScan(delay = SCAN_DELAY_MS) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      void scanPage();
    }, delay);
  }

  function setSafeState(nextState) {
    state = { ...state, ...nextState };
    chrome.storage.local.set({
      [STATE_KEY]: publicState()
    });
  }

  function publicState() {
    return {
      active: state.active,
      phase: state.phase,
      status: state.status,
      lastAction: state.lastAction,
      pausedReason: state.pausedReason,
      sensitiveFieldCount: state.sensitiveFieldCount,
      paymentDetectedAt: state.paymentDetectedAt,
      manualGate: state.manualGate,
      manualGateUntil: state.manualGateUntil
    };
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return String(value).replace(/'/g, "\\'");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
