const TOOL_ID = window.__ANNA_TOOL_IDS__?.["travel-agent"] || "tool-test-private-travel-agent-12345678";
const els = {
  form: document.querySelector("#searchForm"),
  product: document.querySelector("#product"),
  provider: document.querySelector("#provider"),
  origin: document.querySelector("#origin"),
  destination: document.querySelector("#destination"),
  date: document.querySelector("#date"),
  submit: document.querySelector("#searchForm button[type=submit]"),
  status: document.querySelector("#status"),
  offer: document.querySelector("#offer"),
  travelerDone: document.querySelector("#travelerDone"),
  officialOpened: document.querySelector("#officialOpened"),
  paymentDone: document.querySelector("#paymentDone"),
  log: document.querySelector("#log"),
  connection: document.querySelector("#connection")
};

let runtime;
let run = null;
let starting = false;

async function init() {
  els.submit.disabled = true;
  els.form.addEventListener("submit", startRun);
  els.submit.addEventListener("click", startRun);
  els.travelerDone.addEventListener("click", () => continueRun("traveler_info_completed"));
  els.officialOpened.addEventListener("click", () => continueRun("official_site_opened"));
  els.paymentDone.addEventListener("click", () => continueRun("payment_completed"));
  runtime = await connectRuntime();
  els.submit.disabled = false;
  render();
}

async function connectRuntime() {
  try {
    const { AnnaAppRuntime } = await import("/static/anna-apps/_sdk/latest/index.js");
    const anna = await AnnaAppRuntime.connect();
    els.connection.textContent = "已连接 Anna";
    return anna;
  } catch (_error) {
    els.connection.textContent = "独立预览";
    return createStandaloneRuntime();
  }
}

async function startRun(event) {
  event.preventDefault();
  if (starting) return;
  starting = true;
  els.submit.disabled = true;
  const product = els.product.value;
  try {
    const result = await invoke("start_run", {
      product,
      provider: els.provider.value,
      search: {
        product,
        origin: els.origin.value.trim(),
        destination: els.destination.value.trim(),
        departureDate: els.date.value,
        passengers: { adults: 1, children: 0 }
      }
    });
    run = result;
    await runtime.chat.write_message({
      role: "user",
      content: `已启动匿名${product}查询；当前状态 ${run.state}。`
    }).catch(() => {});
    render();
  } finally {
    starting = false;
    els.submit.disabled = false;
  }
}

async function continueRun(event) {
  if (!run) return;
  run = await invoke("continue", { run_id: run.id, event });
  render();
}

async function invoke(action, args) {
  try {
    const result = await runtime.tools.invoke({
      tool_id: TOOL_ID,
      method: "travel_agent",
      args: { action, ...args }
    });
    return result?.data || result;
  } catch (error) {
    els.status.textContent = "操作被拒绝";
    els.log.textContent = error.message || String(error);
    throw error;
  }
}

function render() {
  els.status.textContent = run?.state || "等待搜索";
  els.log.textContent = run ? JSON.stringify(run, null, 2) : "";
  els.travelerDone.disabled = run?.state !== "await_traveler_info";
  els.officialOpened.disabled = run?.state !== "await_official_site";
  els.paymentDone.disabled = run?.state !== "await_payment";
  if (!run?.selectedOffer) {
    els.offer.className = "offer empty";
    els.offer.textContent = "尚未选择报价";
    return;
  }
  els.offer.className = "offer";
  const price = Number.isFinite(run.selectedOffer.price)
    ? `参考价 ¥${run.selectedOffer.price}`
    : "价格由官方页面显示";
  els.offer.textContent = `${run.selectedOffer.title}\n${run.selectedOffer.schedule}\n${price}`;
}

function createStandaloneRuntime() {
  const runs = new Map();
  return {
    tools: {
      async invoke({ args }) {
        if (args.action === "start_run") {
          const id = `preview_${Date.now()}`;
          const official = args.provider === "official-handoff";
          const created = {
            id,
            state: official ? "await_official_site" : "await_traveler_info",
            nextGate: official ? "official_site" : "traveler_info",
            query: args.search,
            selectedOffer: {
              id: official ? "official-handoff" : "sandbox-1",
              title: official ? "官方网页人工接管" : "Sandbox 推荐方案",
              schedule: `${args.search.origin} → ${args.search.destination} · ${args.search.departureDate}`,
              price: official ? null : 680,
              canAutoBook: false
            },
            events: []
          };
          runs.set(id, created);
          return structuredClone(created);
        }
        const current = runs.get(args.run_id);
        if (!current) throw new Error("Run not found");
        const transitions = {
          "await_traveler_info:traveler_info_completed": ["await_payment", "payment"],
          "await_payment:payment_completed": ["post_payment", null],
          "await_official_site:official_site_opened": ["human_handoff", null]
        };
        const next = transitions[`${current.state}:${args.event}`];
        if (!next) throw new Error(`Event ${args.event} is not allowed in ${current.state}`);
        current.state = next[0];
        current.nextGate = next[1];
        current.events.push({ event: args.event, at: new Date().toISOString() });
        return structuredClone(current);
      }
    },
    chat: { async write_message() {} },
    window: { async set_title({ title }) { document.title = title; } }
  };
}

document.addEventListener("DOMContentLoaded", init);
