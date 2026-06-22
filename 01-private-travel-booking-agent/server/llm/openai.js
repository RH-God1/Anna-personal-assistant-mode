const DEFAULT_MODEL = "gpt-4.1-mini";

function createLLMAdapter(env = process.env) {
  const apiKey = env.OPENAI_API_KEY || "";
  const forcedMode = env.OPENAI_LLM_MODE || "";
  const model = env.OPENAI_LLM_MODEL || DEFAULT_MODEL;
  const openAIBaseUrl = env.OPENAI_BASE_URL || "https://api.openai.com";
  const hasKey = Boolean(apiKey);
  const mode = forcedMode || (hasKey ? "openai" : "mock");

  return {
    status() {
      return {
        provider: "openai",
        mode: mode === "openai" ? "openai" : "mock",
        configured: hasKey,
        model,
        backendOnly: true,
        keyExposedToBrowser: false
      };
    },

    async recommend(input) {
      const safeInput = buildSafeInput(input);

      if (mode !== "openai" || !hasKey) {
        return localRecommendation(safeInput, "mock_or_missing_key");
      }

      if (input.consentToShareWithLLM !== true) {
        return localRecommendation(safeInput, "missing_llm_consent");
      }

      const response = await fetch(`${openAIBaseUrl}/v1/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: [
                    "你是一个隐私优先的出行预订 Agent 后端助手。",
                    "只基于非个人行程信息给出下一步建议。",
                    "不要要求用户把姓名、证件、手机号、银行卡、验证码或支付密码交给 Agent。",
                    "确认订单和付款必须由用户自己操作。"
                  ].join("\n")
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify(safeInput)
                }
              ]
            }
          ],
          max_output_tokens: 260
        })
      });

      if (!response.ok) {
        const error = new Error(`OpenAI Responses API failed with ${response.status}`);
        error.statusCode = 502;
        throw error;
      }

      const body = await response.json();
      return {
        provider: "openai",
        mode: "openai",
        model,
        advice: extractResponseText(body) || "已完成模型调用，但没有返回可展示文本。",
        privacy: {
          externalTransmission: true,
          piiAccepted: false,
          keyExposedToBrowser: false
        }
      };
    }
  };
}

function buildSafeInput(input) {
  const run = input.run || {};

  return {
    task: input.task || "travel_booking_next_step",
    state: input.state || run.state || null,
    product: input.product || run.product || null,
    provider: input.provider || run.provider || null,
    query: input.query || run.query || null,
    selectedOffer: summarizeOffer(input.selectedOffer || run.selectedOffer || null),
    nextGate: input.nextGate || run.nextGate || null
  };
}

function summarizeOffer(offer) {
  if (!offer) {
    return null;
  }

  return {
    id: offer.id,
    product: offer.product,
    platformName: offer.platformName,
    title: offer.title,
    schedule: offer.schedule || null,
    stay: offer.stay || null,
    price: offer.price || null,
    gates: offer.gates || [],
    canAutoBook: Boolean(offer.canAutoBook)
  };
}

function localRecommendation(input, reason) {
  const gate = input.nextGate || nextGateFromState(input.state);
  const advice = buildLocalAdvice(input, gate);

  return {
    provider: "openai",
    mode: "mock",
    model: null,
    advice,
    reason,
    privacy: {
      externalTransmission: false,
      piiAccepted: false,
      keyExposedToBrowser: false
    }
  };
}

function buildLocalAdvice(input, gate) {
  if (gate === "traveler_info" || gate === "guest_info") {
    return "下一步需要用户自己输入旅客、联系人或入住人信息。Agent 只能提示和等待，不读取、不保存这些字段。";
  }

  if (gate === "payment") {
    return "下一步是付款。Agent 必须暂停，用户自行在官方页面完成付款；付款完成后只捕捉完成状态。";
  }

  if (input.state === "post_payment") {
    return "付款完成状态已捕捉。Agent 可以继续检查出票、确认号、酒店确认状态等非支付后续信息。";
  }

  return "可以继续执行非敏感导航或查询步骤；一旦出现个人信息、订单确认或付款动作，就切换到用户接管。";
}

function nextGateFromState(state) {
  if (state === "await_traveler_info") {
    return "traveler_info";
  }

  if (state === "await_payment") {
    return "payment";
  }

  return null;
}

function extractResponseText(body) {
  if (typeof body.output_text === "string") {
    return body.output_text;
  }

  const parts = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      } else if (typeof content.output_text === "string") {
        parts.push(content.output_text);
      }
    }
  }

  return parts.join("\n").trim();
}

module.exports = {
  createLLMAdapter
};
