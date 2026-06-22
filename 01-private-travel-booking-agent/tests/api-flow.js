process.env.OPENAI_LLM_MODE = "mock";

const { server } = require("../server");

const HOST = "127.0.0.1";

async function main() {
  const listener = await listen();
  const baseUrl = `http://${HOST}:${listener.port}`;

  try {
    const health = await getJson(`${baseUrl}/health`);
    assert(health.ok === true, "health should be ok");

    const platforms = await getJson(`${baseUrl}/api/platforms`);
    assert(platforms.platforms.some((platform) => platform.id === "sandbox-flight"), "sandbox-flight should exist");
    assert(platforms.platforms.some((platform) => platform.id === "china-rail-12306-handoff"), "12306 handoff should exist");

    const llmStatus = await getJson(`${baseUrl}/api/llm/status`);
    assert(llmStatus.backendOnly === true, "LLM adapter should be backend-only");
    assert(llmStatus.keyExposedToBrowser === false, "LLM key must not be exposed");

    const run = await postJson(`${baseUrl}/api/agent/run`, {
      product: "flight",
      provider: "sandbox-flight",
      search: {
        product: "flight",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01",
        passengers: {
          adults: 1
        }
      }
    });
    assert(run.state === "await_traveler_info", `expected await_traveler_info, got ${run.state}`);
    assert(run.selectedOffer && run.selectedOffer.canAutoBook === false, "offer must not be auto-bookable");

    const skippedPayment = await postJson(`${baseUrl}/api/agent/runs/${run.id}/continue`, {
      event: "payment_completed"
    }, 409);
    assert(/not allowed/.test(skippedPayment.error), "payment cannot complete before traveler info");

    const afterInfo = await postJson(`${baseUrl}/api/agent/runs/${run.id}/continue`, {
      event: "traveler_info_completed"
    });
    assert(afterInfo.state === "await_payment", `expected await_payment, got ${afterInfo.state}`);

    const repeatedInfo = await postJson(`${baseUrl}/api/agent/runs/${run.id}/continue`, {
      event: "traveler_info_completed"
    }, 409);
    assert(/not allowed/.test(repeatedInfo.error), "traveler info cannot be confirmed twice");

    const adviceRun = await postJson(`${baseUrl}/api/agent/runs/${run.id}/llm-advice`, {
      consentToShareWithLLM: false
    });
    assert(adviceRun.llmAdvice.mode === "mock", "LLM advice should use mock mode in tests");
    assert(adviceRun.llmAdvice.privacy.externalTransmission === false, "LLM advice should not transmit externally without consent");

    const directAdvice = await postJson(`${baseUrl}/api/llm/recommend`, {
      state: "await_payment",
      query: {
        product: "flight",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01"
      },
      selectedOffer: {
        platformName: "Sandbox 官方合作航司 A",
        title: "SHA -> BJS 直飞"
      },
      consentToShareWithLLM: false
    });
    assert(directAdvice.mode === "mock", "direct LLM advice should return local mock advice");

    const afterPayment = await postJson(`${baseUrl}/api/agent/runs/${run.id}/continue`, {
      event: "payment_completed"
    });
    assert(afterPayment.state === "post_payment", `expected post_payment, got ${afterPayment.state}`);

    const rejected = await postJson(`${baseUrl}/api/agent/run`, {
      product: "rail",
      provider: "sandbox-rail",
      search: {
        product: "rail",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01",
        passengerName: "Sensitive User"
      }
    }, 400);
    assert(/Sensitive user data/.test(rejected.error), "PII payload should be rejected");

    const rejectedLLM = await postJson(`${baseUrl}/api/llm/recommend`, {
      state: "await_traveler_info",
      contactName: "Sensitive User"
    }, 400);
    assert(/Sensitive user data/.test(rejectedLLM.error), "LLM payload should reject PII");

    const invalidPassengers = await postJson(`${baseUrl}/api/agent/run`, {
      product: "flight",
      provider: "sandbox-flight",
      search: {
        product: "flight",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01",
        passengers: { adults: -1 }
      }
    }, 400);
    assert(/passengers\.adults/.test(invalidPassengers.error), "negative passenger counts should be rejected");

    const handoff = await postJson(`${baseUrl}/api/agent/run`, {
      product: "rail",
      provider: "china-rail-12306-handoff",
      search: {
        product: "rail",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01"
      }
    });
    assert(handoff.state === "await_official_site", "official handoff should use its own state");
    const handedOff = await postJson(`${baseUrl}/api/agent/runs/${handoff.id}/continue`, {
      event: "official_site_opened"
    });
    assert(handedOff.state === "human_handoff", "official handoff should end in human_handoff");

    const malformed = await postRaw(`${baseUrl}/api/search`, "{bad json", 400);
    assert(/valid JSON/.test(malformed.error), "malformed JSON should return 400");

    const crossOrigin = await postRaw(
      `${baseUrl}/api/search`,
      JSON.stringify({ product: "flight" }),
      403,
      {
        "Content-Type": "application/json",
        "Origin": "https://attacker.example"
      }
    );
    assert(/Cross-origin/.test(crossOrigin.error), "cross-origin POST should be rejected");

    const simpleRequest = await postRaw(
      `${baseUrl}/api/search`,
      JSON.stringify({ product: "flight" }),
      415,
      { "Content-Type": "text/plain" }
    );
    assert(/application\/json/.test(simpleRequest.error), "simple POST should be rejected");

    const tooLarge = await postJson(`${baseUrl}/api/search`, {
      product: "flight",
      notes: "x".repeat(70 * 1024)
    }, 413);
    assert(/exceeds/.test(tooLarge.error), "oversized JSON should return 413");

    console.log("API flow OK");
    console.log(JSON.stringify({
      health: health.ok,
      runId: run.id,
      finalState: afterPayment.state,
      llmMode: adviceRun.llmAdvice.mode,
      piiRejected: true,
      stateTransitionsProtected: true,
      inputValidation: true
    }, null, 2));
  } finally {
    await close(listener.server);
  }
}

function listen() {
  return new Promise((resolve) => {
    const instance = server.listen(0, HOST, () => {
      resolve({
        server: instance,
        port: instance.address().port
      });
    });
  });
}

function close(instance) {
  return new Promise((resolve) => instance.close(resolve));
}

async function getJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function postJson(url, body, expectedStatus = 200) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  assert(response.status === expectedStatus, `expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function postRaw(url, body, expectedStatus, headers = {
  "Content-Type": "application/json"
}) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body
  });
  const payload = await response.json();
  assert(response.status === expectedStatus, `expected status ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
