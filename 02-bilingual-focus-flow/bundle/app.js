import {
  createTranslator,
  formatFocusedMinutes,
  formatTime,
  loadLocale,
  normalizeLocale
} from "./i18n.js";

const TOOL_ID = window.__ANNA_TOOL_IDS__?.["focus-session"] || "tool-test-focus-session-12345678";
const CIRCUMFERENCE = 2 * Math.PI * 96;
const DEFAULT_MINUTES = 25;
const els = {
  locale: document.querySelector("#locale"),
  theme: document.querySelector("#theme"),
  topic: document.querySelector("#topic"),
  time: document.querySelector("#time"),
  status: document.querySelector("#status"),
  primary: document.querySelector("#primary"),
  end: document.querySelector("#end"),
  coach: document.querySelector("#coach"),
  summary: document.querySelector("#summary"),
  history: document.querySelector("#history"),
  connection: document.querySelector("#connection"),
  connectionText: document.querySelector("#connectionText"),
  progress: document.querySelector(".progress"),
  presets: [...document.querySelectorAll("[data-minutes]")]
};

let runtime;
let locale = "zh-CN";
let t = (key) => key;
let chosenMinutes = DEFAULT_MINUTES;
let state = { active: null, today: { session_count: 0, focused_seconds: 0 }, recent: [] };
let lastTitleKey = "";
const localState = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Sandboxed Anna hosts may intentionally expose an opaque origin.
    }
  }
};

async function init() {
  locale = normalizeLocale(localState.get("focus-flow:locale") || navigator.language);
  await applyLocale(locale);
  runtime = await connectRuntime();
  bind();
  await refresh();
  render();
  setInterval(tick, 1000);
  setInterval(() => state.active && refresh(), 30000);
}

async function connectRuntime() {
  try {
    const { AnnaAppRuntime } = await import("/static/anna-apps/_sdk/latest/index.js");
    const anna = await AnnaAppRuntime.connect();
    els.connection.classList.add("connected");
    els.connectionText.textContent = t("connected");
    return anna;
  } catch (_error) {
    els.connection.classList.remove("connected");
    els.connectionText.textContent = t("standalone");
    return createStandaloneRuntime();
  }
}

function bind() {
  els.locale.addEventListener("change", async () => {
    await applyLocale(els.locale.value);
    render();
  });
  els.theme.addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  });
  els.primary.addEventListener("click", () => {
    if (!state.active) return invoke("start", {
      duration_minutes: chosenMinutes,
      topic: els.topic.value.trim()
    });
    return invoke(state.active.status === "running" ? "pause" : "resume");
  });
  els.end.addEventListener("click", () => invoke("complete"));
  els.coach.addEventListener("click", async () => {
    await runtime.chat.write_message({ role: "user", content: t("coachPrompt") });
  });
  els.presets.forEach((button) => {
    button.addEventListener("click", () => {
      chosenMinutes = Number(button.dataset.minutes);
      els.presets.forEach((item) => item.classList.toggle("active", item === button));
      renderActive();
    });
  });
}

async function applyLocale(nextLocale) {
  const loaded = await loadLocale(nextLocale);
  locale = loaded.locale;
  t = createTranslator(loaded.catalog, locale);
  localState.set("focus-flow:locale", locale);
  document.documentElement.lang = locale;
  els.locale.value = locale;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  els.topic.placeholder = t("topicPlaceholder");
  els.theme.setAttribute("aria-label", t("theme"));
  els.locale.setAttribute("aria-label", t("language"));
  document.querySelector(".ring").setAttribute("aria-label", t("timerLabel"));
  document.querySelector(".presets").setAttribute("aria-label", t("durationPresets"));
  document.querySelectorAll(".minute-unit").forEach((unit) => {
    unit.textContent = locale === "zh-CN" ? "分" : "m";
  });
  if (runtime) {
    els.connectionText.textContent = els.connection.classList.contains("connected")
      ? t("connected")
      : t("standalone");
  }
  lastTitleKey = "";
}

async function invoke(action, extra = {}) {
  const result = await runtime.tools.invoke({
    tool_id: TOOL_ID,
    method: "session",
    args: { action, ...extra }
  });
  const data = result?.data || result;

  if (action === "start") {
    const topicText = extra.topic ? ` "${extra.topic}"` : "";
    await runtime.chat.write_message({
      role: "user",
      content: t("sessionStarted", { minutes: extra.duration_minutes, topic: topicText })
    });
  }
  if (action === "complete" && data.completed) {
    await runtime.chat.write_message({
      role: "user",
      content: t("sessionCompleted", {
        minutes: t("minutesShort", {
          value: formatFocusedMinutes(data.completed.focused_seconds, locale)
        })
      })
    });
  }
  await refresh();
}

async function refresh() {
  const result = await runtime.tools.invoke({
    tool_id: TOOL_ID,
    method: "session",
    args: { action: "get_state" }
  });
  const data = result?.data || result;
  state = {
    active: data.active || null,
    today: data.today || { session_count: 0, focused_seconds: 0 },
    recent: Array.isArray(data.recent) ? data.recent : []
  };
  render();
}

function tick() {
  const active = state.active;
  if (!active || active.status !== "running") return;
  active.remaining_seconds = Math.max(0, Number(active.remaining_seconds || 0) - 1);
  active.focused_seconds = Number(active.focused_seconds || 0) + 1;
  renderActive();
  syncTitle();
  if (active.remaining_seconds === 0) refresh();
}

function render() {
  renderActive();
  renderSummary();
  renderHistory();
  syncTitle();
}

function renderActive() {
  const active = state.active;
  document.body.dataset.state = active?.status || "idle";
  const remaining = active
    ? Math.max(0, Number(active.remaining_seconds ?? active.duration_seconds))
    : chosenMinutes * 60;
  els.time.textContent = formatClock(remaining);
  els.status.textContent = active
    ? t(active.status === "running" ? "focusing" : "paused")
    : t("ready");
  els.primary.textContent = active
    ? t(active.status === "running" ? "pause" : "resume")
    : t("start");
  els.end.hidden = !active;
  els.end.textContent = t("end");
  els.coach.textContent = t("askCoach");
  els.topic.disabled = Boolean(active);
  if (active?.topic) els.topic.value = active.topic;
  els.presets.forEach((button) => {
    button.disabled = Boolean(active);
  });
  const total = Math.max(1, Number(active?.duration_seconds || chosenMinutes * 60));
  const elapsed = Math.min(total, Math.max(0, total - remaining));
  els.progress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - elapsed / total));
}

function renderSummary() {
  const count = Number(state.today.session_count || 0);
  const minutes = formatFocusedMinutes(state.today.focused_seconds, locale);
  els.summary.textContent = `${t("sessions", { count })} · ${t("minutesShort", { value: minutes })}`;
}

function renderHistory() {
  els.history.replaceChildren();
  if (!state.recent.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = t("emptyHistory");
    els.history.append(item);
    return;
  }
  state.recent.slice(0, 8).forEach((entry) => {
    const item = document.createElement("li");
    const topic = document.createElement("span");
    const meta = document.createElement("span");
    topic.textContent = entry.topic || t("untitled");
    meta.textContent = `${t("minutesShort", {
      value: formatFocusedMinutes(entry.focused_seconds, locale)
    })} · ${formatTime(entry.completed_at, locale)}`;
    item.append(topic, meta);
    els.history.append(item);
  });
}

function syncTitle() {
  const active = state.active;
  const minuteBucket = active ? Math.ceil(Number(active.remaining_seconds || 0) / 60) : null;
  const titleKey = `${locale}:${active?.status || "idle"}:${minuteBucket}:${active?.topic || ""}`;
  if (titleKey === lastTitleKey) return;
  lastTitleKey = titleKey;
  const title = active
    ? `${formatClock(active.remaining_seconds)}${active.topic ? ` · ${active.topic}` : ""} · ${t("appName")}`
    : t("appName");
  runtime.window.set_title({ title }).catch(() => {});
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function createStandaloneRuntime() {
  const key = "focus-flow:standalone-state";
  const read = () => JSON.parse(localState.get(key) || '{"active":null,"history":[]}');
  const write = (value) => localState.set(key, JSON.stringify(value));
  const now = () => Date.now() / 1000;
  const view = (active) => {
    if (!active) return null;
    const focused = active.accumulated_seconds +
      (active.status === "running" ? Math.max(0, now() - active.running_since) : 0);
    return {
      ...active,
      focused_seconds: Math.floor(focused),
      remaining_seconds: Math.max(0, Math.floor(active.duration_seconds - focused))
    };
  };
  const totals = (history) => ({
    session_count: history.length,
    focused_seconds: history.reduce((sum, entry) => sum + entry.focused_seconds, 0)
  });

  return {
    tools: {
      async invoke({ args }) {
        const saved = read();
        if (args.action === "start") {
          saved.active = {
            topic: String(args.topic || "").slice(0, 120),
            duration_seconds: Number(args.duration_minutes) * 60,
            accumulated_seconds: 0,
            running_since: now(),
            status: "running"
          };
          write(saved);
        } else if (args.action === "pause" && saved.active?.status === "running") {
          saved.active.accumulated_seconds = view(saved.active).focused_seconds;
          saved.active.status = "paused";
          saved.active.running_since = null;
          write(saved);
        } else if (args.action === "resume" && saved.active) {
          saved.active.status = "running";
          saved.active.running_since = now();
          write(saved);
        } else if (args.action === "complete" && saved.active) {
          const active = view(saved.active);
          const completed = { ...active, completed_at: now() };
          saved.history.unshift(completed);
          saved.active = null;
          write(saved);
          return { completed, today: totals(saved.history) };
        }
        return {
          active: view(saved.active),
          today: totals(saved.history),
          recent: saved.history.slice(0, 10)
        };
      }
    },
    storage: {
      async get({ key: storageKey }) {
        return { value: localState.get(`anna:${storageKey}`) };
      },
      async set({ key: storageKey, value }) {
        localState.set(`anna:${storageKey}`, value);
      }
    },
    chat: {
      async write_message(message) {
        console.info("[standalone chat]", message.content);
      }
    },
    window: {
      async set_title({ title }) {
        document.title = title;
      }
    }
  };
}

document.addEventListener("DOMContentLoaded", init);
