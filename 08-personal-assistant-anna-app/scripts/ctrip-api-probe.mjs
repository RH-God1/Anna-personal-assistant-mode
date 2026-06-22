#!/usr/bin/env node
import fs from "node:fs";

const endpoints = [
  {
    name: "ctrip-fat-basicinfo",
    environment: "fat",
    url: "https://tourapi-fat.ctripqa.com/api/BasicInfo/"
  },
  {
    name: "ctrip-prod-basicinfo",
    environment: "production",
    url: "http://tourapi.ctrip.com/api/BasicInfo/"
  }
];

const timeoutMs = Number(process.env.CTRIP_PROBE_TIMEOUT_MS || 12000);
const startedAt = new Date();
const results = [];

for (const endpoint of endpoints) {
  results.push(await probe(endpoint));
}

const successful = results.filter((item) => item.ok);
const report = {
  scenario: "ctrip-tourapi-connectivity-probe",
  generated_at: startedAt.toISOString(),
  generated_at_shanghai: startedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
  attempts: results.length,
  successful_attempts: successful.length,
  integration_decision: successful.length === results.length ? "candidate_for_manual_contract_mapping" : "abandon_this_integration_attempt",
  reason: successful.length === results.length
    ? "Both provided category roots responded with success-class HTTP status. Interface names, request signing, credentials, and payload schemas still require official documentation before enabling a provider."
    : "The provided Ctrip category roots did not return success-class API responses. Per project rule, after two unsuccessful connection attempts this Ctrip API integration attempt is abandoned and no runtime provider is enabled.",
  boundaries: [
    "This probe does not send traveler identity, phone, email, passport, payment, login, or order data.",
    "This probe does not create a Ctrip order.",
    "Anna remains Duffel-only for structured flight/hotel booking until a usable Ctrip interface contract and credentials are available."
  ],
  endpoints: results
};

const format = argValue("--format") || "json";
const out = argValue("--out");
const output = format === "markdown" ? toMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;

if (out) {
  fs.writeFileSync(out, output);
} else {
  process.stdout.write(output);
}

async function probe(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(endpoint.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "anna-personal-assistant-ctrip-probe/0.1"
      }
    });
    const text = await response.text();
    return {
      ...endpoint,
      ok: response.ok,
      status: response.status,
      status_text: response.statusText,
      elapsed_ms: Date.now() - started,
      content_type: response.headers.get("content-type"),
      body_preview: normalizePreview(text)
    };
  } catch (error) {
    return {
      ...endpoint,
      ok: false,
      status: null,
      error: error?.name === "AbortError" ? "timeout" : (error?.message || String(error)),
      elapsed_ms: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizePreview(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || "";
}

function toMarkdown(report) {
  const lines = [
    "# Ctrip TourAPI Probe",
    "",
    `- Generated: ${report.generated_at}`,
    `- Generated Shanghai: ${report.generated_at_shanghai}`,
    `- Attempts: ${report.attempts}`,
    `- Successful attempts: ${report.successful_attempts}`,
    `- Decision: ${report.integration_decision}`,
    `- Reason: ${report.reason}`,
    "",
    "## Endpoints",
    "",
    "| Environment | URL | OK | HTTP | Content-Type | Preview |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const item of report.endpoints) {
    lines.push(`| ${item.environment} | ${item.url} | ${item.ok ? "yes" : "no"} | ${item.status ?? item.error ?? "n/a"} | ${item.content_type || ""} | ${escapePipes(item.body_preview || "")} |`);
  }
  lines.push("", "## Boundaries", "");
  for (const boundary of report.boundaries) lines.push(`- ${boundary}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapePipes(value) {
  return String(value).replaceAll("|", "\\|");
}
