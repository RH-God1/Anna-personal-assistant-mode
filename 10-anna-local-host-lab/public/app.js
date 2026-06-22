const els = {
  appGrid: document.querySelector("#appGrid"),
  frame: document.querySelector("#appFrame"),
  empty: document.querySelector("#emptyState"),
  title: document.querySelector("#windowTitle"),
  network: document.querySelector("#networkGrant"),
  audit: document.querySelector("#auditList")
};

let apps = [];
let activeWindow = null;
let auditTimer = null;

async function request(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      "X-Anna-Admin-Token": window.__ANNA_ADMIN_TOKEN__
    }
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || `HTTP ${response.status}`);
  return value;
}

async function init() {
  const status = await request("/api/status");
  apps = status.apps;
  renderApps();
  await refreshAudit();
  auditTimer = setInterval(() => {
    refreshAudit().catch(handleHostError);
  }, 1500);
  window.addEventListener("message", (event) => {
    if (event.source !== els.frame.contentWindow) return;
    if (event.data?.type === "anna:title") els.title.textContent = event.data.title;
  });
}

function renderApps() {
  els.appGrid.replaceChildren(...apps.map((app, index) => {
    const button = document.createElement("button");
    button.className = "app-card";
    button.type = "button";
    button.dataset.app = app.slug;
    button.style.setProperty("--app-accent", app.accent);
    const number = document.createElement("small");
    number.textContent = `APP ${String(index + 1).padStart(2, "0")} · ${app.version}`;
    const name = document.createElement("strong");
    name.textContent = app.name;
    const summary = document.createElement("span");
    summary.textContent = app.summary;
    button.append(number, name, summary);
    button.addEventListener("click", () => openApp(app, button));
    return button;
  }));
}

async function openApp(app, button) {
  if (activeWindow) {
    await request(`/api/windows/${activeWindow.window_id}`, { method: "DELETE" });
    activeWindow = null;
  }
  const created = await request("/api/windows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_slug: app.slug })
  });
  activeWindow = created;
  document.querySelectorAll(".app-card").forEach((card) => card.classList.remove("active"));
  button.classList.add("active");
  els.title.textContent = `${app.name} / ${created.window_id.slice(0, 12)}`;
  els.empty.hidden = true;
  els.frame.hidden = false;
  els.frame.src = created.url;
  els.network.disabled = false;
  els.network.checked = false;
  await refreshAudit();
}

els.network.addEventListener("change", async () => {
  if (!activeWindow) return;
  await request(`/api/windows/${activeWindow.window_id}/grants`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_network: els.network.checked })
  });
  await refreshAudit();
});

async function refreshAudit() {
  const { entries } = await request("/api/audit?limit=40");
  els.audit.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    item.className = entry.outcome === "ok" ? "" : "denied";
    const title = document.createElement("b");
    title.textContent = `${entry.namespace}.${entry.method} / ${entry.outcome}`;
    const detail = document.createElement("span");
    const keys = entry.arg_keys?.length ? entry.arg_keys.join(", ") : "no args";
    detail.textContent = `${entry.app} · keys: ${keys}${entry.error_code ? ` · ${entry.error_code}` : ""}`;
    item.append(title, detail);
    return item;
  }));
}

function handleHostError(error) {
  if (/Invalid Host management token|Failed to fetch/.test(error.message)) {
    if (auditTimer) clearInterval(auditTimer);
    els.title.textContent = "Host 连接已失效，请刷新页面";
    return;
  }
  console.error(error);
}

init().catch((error) => {
  handleHostError(error);
  if (!/Invalid Host management token|Failed to fetch/.test(error.message)) {
    els.title.textContent = `Host 启动失败：${error.message}`;
  }
});
