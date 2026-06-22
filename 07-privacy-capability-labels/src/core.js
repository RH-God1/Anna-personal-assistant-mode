export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schema !== 1) errors.push("schema must equal 1");
  if (!Array.isArray(manifest?.tools) || manifest.tools.length === 0) {
    errors.push("tools must be a non-empty array");
    return errors;
  }
  const ids = new Set();
  for (const tool of manifest.tools) {
    const prefix = tool?.id || "<missing-id>";
    if (!tool?.id || ids.has(tool.id)) errors.push(`${prefix}: id is missing or duplicated`);
    ids.add(tool?.id);
    errors.push(...validateCapabilities(tool?.capabilities, prefix));
  }
  return errors;
}

export function validateCapabilities(value, prefix = "capabilities") {
  const errors = [];
  if (!value || typeof value !== "object") return [`${prefix}: capabilities are required`];
  for (const key of ["reads_pii", "writes_external", "requires_human_confirmation"]) {
    if (typeof value[key] !== "boolean") errors.push(`${prefix}: ${key} must be boolean`);
  }
  if (!Array.isArray(value.data_classes)) errors.push(`${prefix}: data_classes must be an array`);
  if (!["none", "memory_only", "session", "local_until_deleted", "remote_until_deleted"].includes(value.retention)) {
    errors.push(`${prefix}: unsupported retention ${value.retention}`);
  }
  if (!Array.isArray(value.external_domains)) errors.push(`${prefix}: external_domains must be an array`);
  if (value.writes_external === true && (!Array.isArray(value.external_domains) || value.external_domains.length === 0)) {
    errors.push(`${prefix}: writes_external requires external_domains`);
  }
  if (value.writes_external === false && Array.isArray(value.external_domains) && value.external_domains.length > 0) {
    errors.push(`${prefix}: external_domains must be empty when writes_external is false`);
  }
  if (value.reads_pii === true && (!Array.isArray(value.data_classes) || value.data_classes.length === 0)) {
    errors.push(`${prefix}: reads_pii requires explicit data_classes`);
  }
  if (value.requires_human_confirmation === true &&
      (!Array.isArray(value.human_gates) || value.human_gates.length === 0)) {
    errors.push(`${prefix}: requires_human_confirmation requires human_gates`);
  }
  if (value.requires_human_confirmation === false &&
      Array.isArray(value.human_gates) && value.human_gates.length > 0) {
    errors.push(`${prefix}: human_gates must be empty when confirmation is not required`);
  }
  return errors;
}

export function riskLevel(capabilities) {
  if (capabilities.reads_pii && capabilities.writes_external) return "high";
  if (capabilities.reads_pii || capabilities.writes_external) return "medium";
  if (capabilities.requires_human_confirmation) return "guarded";
  return "low";
}

export function createRuntimeLabels(manifest) {
  return Object.fromEntries(manifest.tools.map((tool) => [
    tool.id,
    {
      title: tool.title,
      risk: riskLevel(tool.capabilities),
      badges: badges(tool.capabilities),
      mcp_annotations: {
        readOnlyHint: tool.capabilities.writes_external === false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: tool.capabilities.writes_external === true
      },
      consent: {
        required: tool.capabilities.requires_human_confirmation ||
          tool.capabilities.reads_pii ||
          tool.capabilities.writes_external,
        gates: tool.capabilities.human_gates || []
      }
    }
  ]));
}

export function renderMarkdown(manifest) {
  const rows = manifest.tools.map((tool) => {
    const caps = tool.capabilities;
    return `| ${tool.title} | ${riskLevel(caps)} | ${yesNo(caps.reads_pii)} | ${yesNo(caps.writes_external)} | ${yesNo(caps.requires_human_confirmation)} | ${caps.retention} |`;
  });
  const details = manifest.tools.map((tool) => {
    const caps = tool.capabilities;
    const domains = caps.external_domains.length ? caps.external_domains.join(", ") : "无";
    const gates = caps.human_gates.length ? caps.human_gates.join(", ") : "无";
    return `## ${tool.title}\n\n- 数据类别：${caps.data_classes.join(", ") || "无"}\n- 外部域名：${domains}\n- 人工确认点：${gates}\n- 用户提示：${promptFor(tool)}\n`;
  });
  return `# 隐私能力报告\n\n| 工具 | 风险 | 读取 PII | 外部写入 | 人工确认 | 保留策略 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\n${details.join("\n")}`;
}

export function promptFor(tool) {
  const caps = tool.capabilities;
  const parts = [];
  if (caps.reads_pii) parts.push("会读取个人信息");
  else parts.push("不读取个人信息");
  if (caps.writes_external) parts.push(`会连接 ${caps.external_domains.join(", ")}`);
  else parts.push("不向外部服务写入数据");
  if (caps.requires_human_confirmation) parts.push(`在 ${caps.human_gates.join(", ")} 前暂停`);
  return `${tool.title}：${parts.join("；")}。`;
}

function badges(capabilities) {
  return [
    capabilities.reads_pii ? "reads-pii" : "no-pii",
    capabilities.writes_external ? "external-write" : "local-only",
    capabilities.requires_human_confirmation ? "human-gated" : "automatic-safe-scope"
  ];
}

function yesNo(value) {
  return value ? "是" : "否";
}
