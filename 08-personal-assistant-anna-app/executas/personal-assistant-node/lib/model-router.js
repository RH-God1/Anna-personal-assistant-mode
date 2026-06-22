export const MODEL_PROFILES = Object.freeze([
  {
    id: "anna-auto",
    label: "Anna 自动选择",
    capabilities: ["text", "vision", "audio", "tools"],
    status: "host-managed",
    note: "实验版只声明任务所需能力，具体模型由 Anna 主机确认。",
    routing_focus: ["tools", "vision", "audio", "capability-mismatch"]
  },
  {
    id: "gemma-4-e4b-it",
    label: "Gemma 4 E4B-it",
    capabilities: ["text"],
    status: "needs-host-confirmation",
    note: "适合隐私优先的纯文本整理、摘要与安静型说明，其他能力等待 Anna 主机握手。",
    routing_focus: ["summarize", "privacy-first", "plain-text"]
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite 预览",
    capabilities: ["text"],
    status: "needs-host-confirmation",
    note: "适合快速通用问答与轻量任务，能力不在实验中写死。",
    routing_focus: ["general", "quick-reply", "everyday"]
  },
  {
    id: "mimo-v2-flash",
    label: "MiMo-V2-Flash",
    capabilities: ["text"],
    status: "needs-host-confirmation",
    note: "适合头脑风暴、改写、命名和创意草稿，能力不在实验中写死。",
    routing_focus: ["creative", "rewrite", "brainstorm"]
  },
  {
    id: "minimax-m2-7",
    label: "MiniMax M2.7",
    capabilities: ["text"],
    status: "needs-host-confirmation",
    note: "适合语气敏感、陪伴式与沟通型文本支持，能力不在实验中写死。",
    routing_focus: ["companion", "tone", "conversation"]
  },
  {
    id: "qwen-plus",
    label: "Qwen Plus",
    capabilities: ["text"],
    status: "needs-host-confirmation",
    note: "适合结构化写作、计划拆解与可执行清单，能力不在实验中写死。",
    routing_focus: ["writing", "planning", "structured-output"]
  },
  {
    id: "qwen3-max",
    label: "Qwen3 Max",
    capabilities: ["text"],
    status: "needs-host-confirmation",
    note: "适合复杂决策、逻辑比较与高风险请求的审慎回应，能力不在实验中写死。",
    routing_focus: ["decision", "safety", "analysis"]
  }
]);

const WEATHER_TERMS = /天气|气温|下雨|空气|空气质量|雾霾|weather|temperature|rain|air quality/i;
const HEALTH_TERMS = /步数|步行|心率|呼吸|睡眠|健康|手表|watch|steps?|heart rate|respir|sleep|health/i;
const TRAVEL_TERMS = /机票|航班|酒店|订房|行程|旅行|出差|flight|hotel|itinerary|travel|book(?:ing)?/i;
const SAFETY_TERMS = /窃取|盗取|绕过登录|绕过验证|爆破|钓鱼|木马|恶意软件|勒索|隐藏痕迹|权限维持|未授权攻击|攻击公网|偷(?:取)?\s*(?:token|cookie|密码|账号)|steal|credential theft|bypass login|phishing|malware|ransomware|persistence|exfiltrat|ddos/i;
const COMPANION_TERMS = /难受|焦虑|压力|冲突|拒绝|沟通|关系|情绪|纠结|upset|anxious|stress|conflict|emotion/i;
const DECISION_TERMS = /应该|选择|决定|比较|判断|原因|逻辑|证据|should|decide|compare|reason|evidence/i;
const CREATIVE_TERMS = /头脑风暴|灵感|创意|命名|slogan|文案|故事|改写|rewrite|brainstorm|creative|story|tagline/i;
const WRITING_TERMS = /总结|摘要|整理|大纲|邮件|计划|清单|润色|翻译|summary|summari[sz]e|outline|email|plan|checklist|translate/i;

export function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.slice(0, 6).map((item, index) => {
    const type = String(item?.type || "").slice(0, 120);
    const kind = type.startsWith("image/")
      ? "image"
      : type.startsWith("audio/")
        ? "audio"
        : "file";
    return {
      id: String(item?.id || `attachment-${index + 1}`).slice(0, 80),
      name: String(item?.name || `附件 ${index + 1}`).slice(0, 160),
      type,
      kind,
      size: Number.isFinite(Number(item?.size)) ? Math.max(0, Number(item.size)) : 0
    };
  });
}

export function detectIntent(message, attachments = []) {
  const text = String(message || "");
  if (SAFETY_TERMS.test(text)) return "safety";
  if (WEATHER_TERMS.test(text)) return "weather";
  if (HEALTH_TERMS.test(text)) return "health";
  if (TRAVEL_TERMS.test(text)) return "travel";
  if (DECISION_TERMS.test(text)) return "decision";
  if (COMPANION_TERMS.test(text)) return "companion";
  if (CREATIVE_TERMS.test(text)) return "creative";
  if (WRITING_TERMS.test(text)) return "writing";
  if (attachments.some((item) => item.kind === "image" || item.kind === "audio")) {
    return "multimodal";
  }
  return "general";
}

export function requiredCapabilities(intent, attachments = []) {
  const required = new Set(["text"]);
  if (["weather", "health", "travel"].includes(intent)) required.add("tools");
  if (attachments.some((item) => item.kind === "image")) required.add("vision");
  if (attachments.some((item) => item.kind === "audio")) required.add("audio");
  return [...required];
}

export function routeModel({
  message,
  attachments,
  preferredModel = "anna-auto",
  registry = MODEL_PROFILES
}) {
  const normalized = normalizeAttachments(attachments);
  const intent = detectIntent(message, normalized);
  const required = requiredCapabilities(intent, normalized);
  const preferred = registry.find((model) => model.id === preferredModel);
  const preferredFits = preferred && required.every((capability) =>
    preferred.capabilities.includes(capability)
  );
  const hostManagedOnly = required.some((capability) => capability !== "text");
  const selected = hostManagedOnly
    ? registry[0]
    : pickTextModel({
      intent,
      preferred,
      preferredFits,
      registry
    });
  const fallbackUsed = hostManagedOnly
    ? Boolean(preferred && preferred.id !== "anna-auto" && !preferredFits)
    : Boolean(preferred && preferred.id !== selected.id);

  return {
    intent,
    required_capabilities: required,
    selected_model: selected,
    preferred_model: preferred?.id || null,
    host_preference: hostManagedOnly ? "anna-auto" : null,
    selection_mode: hostManagedOnly ? "host-managed-capabilities" : "text-specialized-hint",
    fallback_used: fallbackUsed,
    warning: buildWarning({
      hostManagedOnly,
      preferred,
      preferredFits,
      selected
    }),
    attachments: normalized
  };
}

function pickTextModel({ intent, preferred, preferredFits, registry }) {
  if (preferred && preferred.id !== "anna-auto" && preferredFits) return preferred;
  const byId = new Map(registry.map((model) => [model.id, model]));
  const intentModelId = {
    safety: "qwen3-max",
    decision: "qwen3-max",
    companion: "minimax-m2-7",
    creative: "mimo-v2-flash",
    writing: "qwen-plus",
    general: "gemini-3.1-flash-lite-preview"
  }[intent] || "gemma-4-e4b-it";
  return byId.get(intentModelId) || byId.get("anna-auto") || registry[0];
}

function buildWarning({ hostManagedOnly, preferred, preferredFits, selected }) {
  if (hostManagedOnly && preferred && !preferredFits) {
    return `${preferred.label} 的实验能力声明不足，已交给 Anna 主机按能力自动选择。`;
  }
  if (!hostManagedOnly && preferred?.id === "anna-auto" && selected.id !== "anna-auto") {
    return `当前是纯文本任务，实验路由建议优先使用 ${selected.label}；若 Anna 主机另有实时能力/负载判断，应以主机结果为准。`;
  }
  if (!hostManagedOnly && preferred && preferred.id !== selected.id) {
    return `${preferred.label} 不是当前文本任务的优先实验路由，已改为 ${selected.label}。`;
  }
  return null;
}
