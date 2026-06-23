import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function assertFile(relativePath) {
  await access(path.join(root, relativePath));
}

function assertIncludes(values, expected, label) {
  assert.ok(Array.isArray(values), `${label} must be an array`);
  assert.ok(values.includes(expected), `${label} must include ${expected}`);
}

await Promise.all([
  assertFile("app.json"),
  assertFile("manifest.json"),
  assertFile("SKILL.md"),
  assertFile("bundle/index.html"),
  assertFile("bundle/app.js"),
  assertFile("bundle/style.css"),
  assertFile("bundle/anna-tool-ids.js"),
  assertFile(".mcp.json"),
  assertFile("../.mcp.json"),
  assertFile("mcp/amadeus-travel-server.js"),
  assertFile("executas/personal-assistant-node/executa.json"),
  assertFile("executas/personal-assistant-node/personal_assistant_plugin.cjs"),
  assertFile("scripts/amadeus-mcp-smoke.mjs"),
  assertFile("scripts/dashboard-live-smoke.mjs"),
  assertFile("scripts/ctrip-api-probe.mjs")
]);

const [
  app,
  manifest,
  mcpConfig,
  executa,
  packageJson,
  frontend,
  skill,
  mcpSource,
  toolIds,
  html,
  providerRegistry,
  duffelProvider,
  amadeusProvider,
  hotelbedsProvider,
  travelportProvider,
  pluginSource,
  bookingStore,
  safetyStore,
  ctripProbeSource
] = await Promise.all([
  readJson("app.json"),
  readJson("manifest.json"),
  readJson(".mcp.json"),
  readJson("executas/personal-assistant-node/executa.json"),
  readJson("package.json"),
  readFile(path.join(root, "bundle/app.js"), "utf8"),
  readFile(path.join(root, "SKILL.md"), "utf8"),
  readFile(path.join(root, "mcp/amadeus-travel-server.js"), "utf8"),
  readFile(path.join(root, "bundle/anna-tool-ids.js"), "utf8"),
  readFile(path.join(root, "bundle/index.html"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/lib/providers/index.js"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/lib/providers/duffel.js"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/lib/providers/amadeus.js"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/lib/providers/hotelbeds.js"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/lib/providers/travelport.js"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/personal_assistant_plugin.cjs"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/lib/booking.js"), "utf8"),
  readFile(path.join(root, "executas/personal-assistant-node/lib/safety.js"), "utf8"),
  readFile(path.join(root, "scripts/ctrip-api-probe.mjs"), "utf8")
]);

assert.equal(app.slug, "personal-assistant-mode", "app slug should match this Anna App");
assert.equal(app.bundled_executas?.["personal-assistant"]?.path, "./executas/personal-assistant-node");
assert.ok(app.description.includes("英文"), "app description must declare English language support");

assert.equal(manifest.schema, 2, "manifest schema must be v2");
assert.equal(manifest.ui?.bundle?.format, "static-spa");
assert.equal(manifest.ui?.bundle?.entry, "index.html");
assertIncludes(manifest.permissions, "tools.invoke", "manifest.permissions");
assertIncludes(manifest.permissions, "chat.write_message", "manifest.permissions");
assertIncludes(manifest.ui?.host_api?.tools, "required:bundled:personal-assistant", "manifest.ui.host_api.tools");
assertIncludes(manifest.ui?.host_api?.chat, "write_message", "manifest.ui.host_api.chat");
assert.ok(
  manifest.required_executas?.some((item) => item.tool_id === "bundled:personal-assistant"),
  "manifest.required_executas must declare bundled:personal-assistant"
);

assert.equal(executa.slug, "personal-assistant-runtime-20260620");
assert.equal(executa.executa_type, "tool");
assert.equal(executa.enabled, true);
assert.ok(executa.tool_id, "executa must define a local tool_id for dev and tests");
assert.match(executa.version, /^0\.1\.\d+$/, "executa runtime version should use the current published binary build series");
assert.equal(
  executa.distribution?.active,
  "binary",
  "executa distribution must publish the installable binary profile, not the local dev shim"
);
assert.equal(
  executa.distribution?.profiles?.local?.type,
  "local",
  "executa distribution should keep a local profile for development fallback"
);
const binaryDistribution = executa.distribution?.profiles?.binary;
assert.equal(binaryDistribution?.type, "binary", "executa binary profile must use binary distribution");
assert.equal(binaryDistribution?.supports_protocol, true, "executa binary profile must support the Anna stdio protocol");
const darwinArm64Asset = binaryDistribution?.binary_urls?.["darwin-arm64"];
assert.ok(
  darwinArm64Asset?.url?.includes(`/personal-assistant-mode/${app.version}/executa/`),
  "darwin-arm64 binary URL must point at the current hosted bundle asset"
);
assert.equal(darwinArm64Asset?.entrypoint, `bin/${executa.tool_id}`, "binary entrypoint must match the tool id executable");
assert.equal(darwinArm64Asset?.format, "tar.gz", "binary asset format must be tar.gz");
assert.match(darwinArm64Asset?.sha256 || "", /^[a-f0-9]{64}$/, "binary asset must carry a sha256");
assert.ok(Number(darwinArm64Asset?.size) > 0, "binary asset must carry a positive size");

assert.ok(frontend.includes("AnnaAppRuntime.connect"), "frontend should connect to the Anna runtime");
assert.ok(frontend.includes("state.runtime.tools.invoke"), "frontend should invoke the personal assistant tool");
assert.ok(frontend.includes("state.runtime.chat.write_message"), "frontend should declare matching chat write usage");
assert.ok(frontend.includes("announcePreflightToAnna"), "frontend should auto-announce preflight to Anna chat");
assert.ok(frontend.includes('role: "assistant"'), "preflight announcements should be assistant-authored");
assert.ok(frontend.includes('method: "personal_assistant"'), "frontend should call the personal_assistant method");
assert.ok(
  frontend.indexOf("state.runtime = await connectAnna();") < frontend.indexOf("const confirmationId = confirmationIdFromPath();"),
  "confirmation hash routes must connect Anna Runtime before reading booking confirmations"
);
assert.ok(
  frontend.includes("window.history.pushState") && frontend.includes("${window.location.pathname}${window.location.search}#/booking/confirm/"),
  "booking confirmation navigation must preserve the Anna Dashboard wid/token query string"
);
assert.ok(toolIds.includes('"personal-assistant"'), "anna-tool-ids.js should map the bundled personal-assistant handle");

assert.ok(
  manifest.system_prompt_addendum.includes("permission_registry") &&
    manifest.system_prompt_addendum.includes("confirmation_queue"),
  "manifest system prompt must expose permission registry and confirmation queue"
);
assert.ok(
  manifest.system_prompt_addendum.includes("Duffel sandbox/test or Amadeus sandbox"),
  "manifest system prompt must enforce backend-only Duffel/Amadeus sandbox travel supplier access"
);
assert.ok(
  manifest.system_prompt_addendum.includes("Anna orchestration -> Amadeus MCP HTTP bridge -> Amadeus sandbox") &&
    manifest.system_prompt_addendum.includes("search_flights") &&
    manifest.system_prompt_addendum.includes("search_hotels") &&
    manifest.system_prompt_addendum.includes("get_offer_details") &&
    manifest.system_prompt_addendum.includes("open_booking_url"),
  "manifest system prompt must declare the Anna -> MCP -> Amadeus travel architecture"
);
assert.ok(
  manifest.system_prompt_addendum.includes("Follow project SKILL.md") &&
    manifest.system_prompt_addendum.includes("Anna guides") &&
    manifest.system_prompt_addendum.includes("Do not import behavior from the archived bilingual Focus Flow project"),
  "manifest system prompt must bind the runtime to the Anna personal assistant SKILL.md and exclude bilingual Focus Flow"
);
assert.ok(
  manifest.system_prompt_addendum.includes("当前通过 Duffel 没有查到可预订报价"),
  "manifest system prompt must include the Duffel no-result wording"
);
assert.ok(
  manifest.system_prompt_addendum.includes("Language system supports Chinese and English") &&
    manifest.system_prompt_addendum.includes("answer English-language users in English"),
  "manifest system prompt must explicitly support English language users"
);
assert.ok(
  skill.includes("name: anna-personal-assistant-mode") &&
    skill.includes("personal_assistant") &&
    skill.includes("Do not import behavior from `02-bilingual-focus-flow`"),
  "SKILL.md must define the Anna personal assistant behavior contract and exclude bilingual focus flow"
);
for (const requiredSkillRule of [
  "You are Anna, the user's personal assistant",
  "Use Duffel sandbox/test and Amadeus sandbox as the only structured travel suppliers",
  "The preferred Dashboard booking architecture is three layers",
  "Search before showing any flight or hotel option",
  "— Flight —",
  "— Hotel —",
  "— Total —",
  "When both flight and hotel are requested, start `search_flights` and `search_hotels` in parallel",
  "Shall I open the [airline/hotel] checkout page for you?",
  "Each explicit yes permits at most one checkout URL",
  "Do not store, repeat, or quote card data",
  "I wasn’t able to retrieve flight results right now.",
  "If `open_booking_url` fails, provide the raw URL",
  "Supplier order creation is handled only by the backend `booking_confirm` path after explicit user confirmation",
  "Ctrip TourAPI is not enabled in this phase",
  "Do not open a browser or official travel website unless the user confirms the selected booking URL handoff or explicitly asks for official website handoff",
  "`booking_confirm` must revalidate price/inventory and, after explicit user confirmation, may call the backend provider `createOrder`",
  "当前通过 Duffel 没有查到可预订报价。",
  "Booking confirmation pages opened inside Anna Dashboard must preserve the app window query string",
  "run the learning loop before producing the normal final reply",
  "Use `anna-auto` for tools, vision, audio",
  "synthesize one final answer"
]) {
  assert.ok(skill.includes(requiredSkillRule), `SKILL.md must include rule: ${requiredSkillRule}`);
}
for (const requiredManifestRule of [
  "Search before showing any flight/hotel option",
  "search_flights/search_hotels in parallel",
  "— Flight —/— Hotel —/— Total —",
  "Shall I open the [airline/hotel] checkout page for you?",
  "each yes opens at most one checkout URL",
  "I wasn’t able to retrieve flight results right now.",
  "provide raw URL",
  "supplier order creation is handled only by backend booking_confirm after explicit user confirmation",
  "Reject or defer traveler identity",
  "Do not store, repeat, or quote card data",
  "do not claim Ctrip API search/order/payment",
  "must not open a browser or official travel website",
  "show concise summary",
  "ask explicit user confirmation",
  "Before any booking confirmation, require current price",
  "Dashboard confirmation pages must preserve wid/runtime token",
  "qwen3-max for safety/decision/logic",
  "all available models",
  "synthesize one final answer",
  "Do not expose hidden chain-of-thought"
]) {
  assert.ok(
    manifest.system_prompt_addendum.includes(requiredManifestRule),
    `manifest system prompt must include runtime rule: ${requiredManifestRule}`
  );
}
assert.ok(
  pluginSource.includes("Chinese/English personal assistant"),
  "personal assistant plugin manifest must advertise Chinese/English support"
);
for (const code of ["supplier_no_result", "invalid_search_params", "route_maybe_unsupported", "supplier_error", "rate_limited"]) {
  assert.ok(
    manifest.system_prompt_addendum.includes(code),
    `manifest system prompt must preserve ${code}`
  );
}
assert.ok(
  !html.includes('value="hotelbeds"') && !html.includes('value="travelport"'),
  "booking UI must not expose disabled supplier choices in this phase"
);
assert.ok(
  providerRegistry.includes('["duffel", createDuffelProvider(options)]'),
  "provider registry must register Duffel"
);
assert.ok(
  providerRegistry.includes('["amadeus", createAmadeusProvider(options)]'),
  "provider registry must register Amadeus sandbox"
);
assert.ok(
  !providerRegistry.includes("createHotelbedsProvider") &&
    !providerRegistry.includes("createTravelportProvider") &&
    !providerRegistry.includes("createCtripProvider"),
  "provider registry must not load Hotelbeds, Travelport, or Ctrip in this phase"
);
assert.ok(
  ctripProbeSource.includes("tourapi-fat.ctripqa.com/api/BasicInfo/") &&
    ctripProbeSource.includes("tourapi.ctrip.com/api/BasicInfo/") &&
    ctripProbeSource.includes("abandon_this_integration_attempt"),
  "Ctrip probe must record both provided endpoints and the abandon decision"
);
assert.ok(
  duffelProvider.includes("process.env.DUFFEL_ACCESS_TOKEN"),
  "Duffel provider must read token from DUFFEL_ACCESS_TOKEN"
);
assert.ok(
  !duffelProvider.includes("DUFFEL_API_KEY"),
  "Duffel provider must not use legacy DUFFEL_API_KEY"
);
assert.ok(
  bookingStore.includes("当前通过 Duffel 没有查到可预订报价。"),
  "booking store must return the required Duffel no-result wording"
);
assert.ok(
  bookingStore.includes("ORDER_CREATED") &&
    bookingStore.includes("createProviderOrders") &&
    bookingStore.includes("provider.createOrder") &&
    bookingStore.includes("order_information") &&
    frontend.includes("orderInformationCard"),
  "booking confirm must create provider orders and Dashboard must display order information after explicit user confirmation"
);
assert.ok(
  safetyStore.includes("travel.search.amadeus_sandbox") &&
    safetyStore.includes("booking.create_order") &&
    safetyStore.includes("requires_user_confirmation") &&
    safetyStore.includes("payment.confirm") &&
    safetyStore.includes("blocked_in_this_runtime"),
  "safety state must register Amadeus sandbox, require confirmation for order creation, and block payment"
);
assert.ok(
  amadeusProvider.includes("amadeus_sandbox_fixture") &&
    amadeusProvider.includes("async createOrder") &&
    amadeusProvider.includes("amadeus_test_order_") &&
    amadeusProvider.includes("AMADEUS_CLIENT_ID"),
  "Amadeus provider must expose sandbox fixtures and confirmed order creation"
);
const mcpServer = mcpConfig.mcpServers?.["anna-personal-assistant-amadeus-travel"];
assert.equal(mcpServer?.type, "http", ".mcp.json must register the Amadeus MCP server as HTTP");
assert.equal(mcpServer?.url, "http://127.0.0.1:8765/mcp", ".mcp.json must point Anna at the local MCP URL");
for (const toolName of ["search_flights", "search_hotels", "get_offer_details", "open_booking_url"]) {
  assert.ok(
    mcpServer.tools?.some((tool) => tool.name === toolName),
    `.mcp.json must declare ${toolName}`
  );
  assert.ok(mcpSource.includes(`"${toolName}"`), `MCP server must implement ${toolName}`);
}
for (const requiredMcpSource of [
  "/v1/security/oauth2/token",
  "/v2/shopping/flight-offers",
  "/v1/reference-data/locations/hotels/by-city",
  "/v3/shopping/hotel-offers",
  "AMADEUS_CLIENT_ID",
  "AMADEUS_CLIENT_SECRET",
  "normalizeFlightOffer",
  "normalizeHotelOfferGroup",
  "openUrlInSystemBrowser",
  "mcp_handles_payment: false",
  "requires_same_turn_confirmation",
  "max_urls_per_confirmation",
  "open_failure_fallback"
]) {
  assert.ok(mcpSource.includes(requiredMcpSource), `MCP server must include ${requiredMcpSource}`);
}
for (const [name, source] of [
  ["hotelbeds", hotelbedsProvider],
  ["travelport", travelportProvider]
]) {
  assert.ok(source.includes("future_placeholder"), `${name} provider must remain a disabled placeholder`);
  assert.ok(!source.includes("test_order_"), `${name} provider must not create test orders in this phase`);
}

for (const scriptName of ["serve", "check", "test", "doctor:anna-guide", "validate:anna", "build:executa-binary", "smoke:anna", "dashboard:live", "dashboard:live:report", "probe:ctrip", "mcp:amadeus", "smoke:amadeus-mcp"]) {
  assert.ok(packageJson.scripts?.[scriptName], `package.json scripts must include ${scriptName}`);
}
assert.match(packageJson.engines?.node || "", />=\s*22/, "Anna beginner guide requires Node.js 22+");

console.log("Anna guide compliance checks passed.");
