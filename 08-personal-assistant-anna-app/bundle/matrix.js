const commandList = document.getElementById("commandList");
const output = document.getElementById("output");
const refreshButton = document.getElementById("refreshButton");

refreshButton.addEventListener("click", refresh);
document.addEventListener("DOMContentLoaded", refresh);

async function refresh() {
  const status = await requestJson("/api/matrix/status");
  renderCommands(status.commands || {});
  renderOutput(status.commands || {});
}

function renderCommands(commands) {
  commandList.replaceChildren(...Object.values(commands).map((command) => {
    const item = document.createElement("article");
    item.className = "command";

    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = command.label;
    const description = document.createElement("p");
    description.textContent = `${command.id} · ${command.description}`;
    copy.append(title, description);

    const actions = document.createElement("div");
    actions.className = "actions";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "primary";
    start.textContent = command.running ? "运行中" : "启动";
    start.disabled = command.running;
    start.addEventListener("click", () => startCommand(command.id));
    actions.append(start);

    if (command.longRunning) {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "danger";
      stop.textContent = "停止";
      stop.disabled = !command.running;
      stop.addEventListener("click", () => stopCommand(command.id));
      actions.append(stop);
    }

    item.append(copy, actions);
    return item;
  }));
}

function renderOutput(commands) {
  const lines = [];
  for (const command of Object.values(commands)) {
    lines.push(`[${command.id}] ${command.running ? "running" : `exit ${command.lastExitCode ?? "-"}`}`);
    for (const entry of command.output || []) {
      lines.push(`  ${entry.stream}: ${entry.line}`);
    }
  }
  output.textContent = lines.join("\n") || "等待命令...";
}

async function startCommand(commandId) {
  await requestJson("/api/matrix/start", {
    method: "POST",
    body: JSON.stringify({ command_id: commandId })
  });
  await refresh();
}

async function stopCommand(commandId) {
  await requestJson("/api/matrix/stop", {
    method: "POST",
    body: JSON.stringify({ command_id: commandId })
  });
  await refresh();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.detail || "Matrix request failed");
  }
  return data;
}

setInterval(refresh, 3000);
