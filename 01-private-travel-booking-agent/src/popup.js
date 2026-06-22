const SETTINGS_KEY = "travelAgent.settings";

const phaseEl = document.getElementById("phase");
const statusEl = document.getElementById("status");
const lastActionEl = document.getElementById("lastAction");
const autoNavigationEl = document.getElementById("autoNavigation");
const statusBlockEl = document.querySelector(".status-block");

document.getElementById("start").addEventListener("click", async () => {
  const settings = await getSettings();
  await sendToActiveTab("TRAVEL_AGENT_START", { settings });
  await refreshStatus();
});

document.getElementById("stop").addEventListener("click", async () => {
  await sendToActiveTab("TRAVEL_AGENT_STOP");
  await refreshStatus();
});

document.getElementById("scan").addEventListener("click", async () => {
  await sendToActiveTab("TRAVEL_AGENT_SCAN");
  await refreshStatus();
});

autoNavigationEl.addEventListener("change", async () => {
  const settings = await getSettings();
  const nextSettings = {
    ...settings,
    autoNavigation: autoNavigationEl.checked
  };

  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
});

void init();

async function init() {
  const settings = await getSettings();
  autoNavigationEl.checked = Boolean(settings.autoNavigation);
  await refreshStatus();
}

async function refreshStatus() {
  const response = await sendToActiveTab("TRAVEL_AGENT_STATUS");

  if (!response) {
    renderStatus({
      phase: "unavailable",
      status: "当前页面不可连接",
      lastAction: "请切换到普通网页后重试"
    });
    return;
  }

  renderStatus(response);
}

async function getSettings() {
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  return {
    autoNavigation: true,
    quietMode: true,
    ...(result[SETTINGS_KEY] || {})
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToActiveTab(type, payload = {}) {
  const tab = await getActiveTab();

  if (!tab || !tab.id) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...payload });
  } catch (_error) {
    return null;
  }
}

function renderStatus(status) {
  const phase = status.phase || "idle";
  phaseEl.textContent = phaseLabel(phase);
  statusEl.textContent = status.status || "等待页面状态";
  lastActionEl.textContent = status.lastAction || "未执行动作";
  statusBlockEl.dataset.phase = phase;
}

function phaseLabel(phase) {
  const labels = {
    idle: "未启动",
    running: "运行中",
    needs_user_input: "需输入",
    payment_hold: "付款中",
    post_payment: "已完成",
    user_confirmation: "需确认",
    unavailable: "不可用"
  };

  return labels[phase] || phase;
}
