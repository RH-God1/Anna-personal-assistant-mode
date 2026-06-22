import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LEARNING_CURRICULUM = [
  {
    category: "psychology",
    label: "心理学",
    books: [
      {
        title: "Thinking, Fast and Slow",
        author: "Daniel Kahneman",
        focus: ["bias_awareness", "slow_thinking", "uncertainty"]
      },
      {
        title: "Motivational Interviewing",
        author: "William R. Miller and Stephen Rollnick",
        focus: ["autonomy", "reflective_listening", "non_coercion"]
      },
      {
        title: "The Principles of Psychology",
        author: "William James",
        focus: ["attention", "habit", "experience"]
      },
      {
        title: "Influence",
        author: "Robert B. Cialdini",
        focus: ["persuasion_awareness", "consent", "manipulation_boundary"]
      },
      {
        title: "Emotional Intelligence",
        author: "Daniel Goleman",
        focus: ["emotion_labeling", "self_regulation", "social_awareness"]
      }
    ]
  },
  {
    category: "logic",
    label: "逻辑学",
    books: [
      {
        title: "A Rulebook for Arguments",
        author: "Anthony Weston",
        focus: ["claim_evidence_fit", "counterexamples", "clear_structure"]
      },
      {
        title: "Introduction to Logic",
        author: "Irving M. Copi, Carl Cohen and Kenneth McMahon",
        focus: ["validity", "fallacies", "definitions"]
      },
      {
        title: "How to Read a Book",
        author: "Mortimer J. Adler and Charles Van Doren",
        focus: ["inspectional_reading", "analytical_questions", "synthesis"]
      },
      {
        title: "The Art of Reasoning",
        author: "David Kelley",
        focus: ["premises", "inference", "concept_clarity"]
      },
      {
        title: "The Uses of Argument",
        author: "Stephen Toulmin",
        focus: ["warrants", "qualifiers", "rebuttals"]
      }
    ]
  },
  {
    category: "response",
    label: "用户回复能力",
    books: [
      {
        title: "Nonviolent Communication",
        author: "Marshall B. Rosenberg",
        focus: ["observation_feeling_need_request", "deescalation", "agency"]
      },
      {
        title: "Difficult Conversations",
        author: "Douglas Stone, Bruce Patton and Sheila Heen",
        focus: ["third_story", "intent_impact", "identity_safety"]
      },
      {
        title: "On Writing Well",
        author: "William Zinsser",
        focus: ["clarity", "brevity", "plain_language"]
      },
      {
        title: "They Say / I Say",
        author: "Gerald Graff and Cathy Birkenstein",
        focus: ["contextual_reply", "fair_summary", "response_frames"]
      },
      {
        title: "Crucial Conversations",
        author: "Kerry Patterson, Joseph Grenny, Ron McMillan and Al Switzler",
        focus: ["shared_purpose", "safety", "actionable_dialogue"]
      }
    ]
  }
];

export const CONTEXT_MEMORY_IMPORTS = [
  {
    name: "project-memory",
    source: "https://github.com/SpillwaveSolutions/project-memory",
    imported_pattern: "用结构化项目记忆保存进度、决策和经验，而不是只依赖短上下文。"
  },
  {
    name: "memory-systems skill",
    source: "https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/skills/memory-systems",
    imported_pattern: "把记忆拆成事实、经验、规则和复盘摘要，读取时只取与当前任务相关的部分。"
  },
  {
    name: "memsearch",
    source: "https://github.com/zilliztech/memsearch",
    imported_pattern: "使用可重建的记忆记录，让后续检索和上下文增强有明确来源。"
  }
];

const RUBRIC = [
  {
    id: "source_separation",
    label: "区分事实、推断与未知",
    applies(response) {
      return Array.isArray(response?.reasoning?.observed) &&
        Array.isArray(response?.reasoning?.unknown);
    },
    repair: "补充分层推理：已观察到什么、只是推断什么、仍不知道什么。"
  },
  {
    id: "user_agency",
    label: "保留用户自主性",
    applies(response) {
      const text = flattenResponse(response);
      return /选择|你可以|由你|自主|决定|确认|授权/.test(text);
    },
    repair: "把建议改写成可选择的下一步，不替用户做不可逆决定。"
  },
  {
    id: "actionable_next_step",
    label: "给出可执行下一步",
    applies(response) {
      return Array.isArray(response?.next_actions) && response.next_actions.length > 0;
    },
    repair: "给出一个低风险、可逆、能立刻开始的下一步。"
  },
  {
    id: "warm_reflection",
    label: "先理解再建议",
    applies(response, message) {
      const text = `${String(message || "")} ${flattenResponse(response)}`;
      return /听到|理解|重点|感受|影响|先/.test(text);
    },
    repair: "先用一句话复述用户的目标或情绪，再进入建议。"
  },
  {
    id: "non_manipulation",
    label: "不操控、不制造依赖",
    applies(response) {
      const text = flattenResponse(response);
      return !/必须听我|只有我|离不开|我替你决定|保证/.test(text);
    },
    repair: "移除绝对化、依赖化或操控式措辞。"
  },
  {
    id: "safety_boundary",
    label: "保留安全与隐私边界",
    applies(response) {
      return Array.isArray(response?.boundaries) && response.boundaries.length > 0;
    },
    repair: "补充健康、隐私、安全或外部操作边界。"
  }
];

const DEFAULT_PROGRESS = {
  cycles_completed: 0,
  books_completed: {
    psychology: 0,
    logic: 0,
    response: 0,
    total: 0
  },
  self_tests_completed: 0,
  reinforced_rules: []
};

export function createLearningLoop({
  now = () => new Date(),
  maxCycles = 80,
  memoryPath,
  persistMemory = true
} = {}) {
  const limit = Math.max(1, Number(maxCycles) || 80);
  const store = createLearningMemoryStore({
    now,
    maxRecords: limit,
    memoryPath,
    persist: persistMemory
  });
  let memory = store.load();

  function remember(cycle) {
    const updatedMemory = updateMemory(memory, cycle, now(), limit);
    const enriched = {
      ...cycle,
      memory_update: {
        ...cycle.memory_update,
        stored: true,
        storage: store.storage,
        progress_after: updatedMemory.progress,
        experience_count: updatedMemory.experiences.length
      }
    };
    const lastExperience = updatedMemory.experiences.at(-1);
    if (lastExperience?.id === enriched.id) {
      lastExperience.cycle = compactCycleForMemory(enriched);
    }
    memory = updatedMemory;
    store.save(memory);
    return enriched;
  }

  return {
    status() {
      return {
        mode: "user_triggered_reinforcement_learning",
        trigger: "user_instruction_required",
        storage: store.storage,
        cycle_count: memory.progress.cycles_completed,
        last_cycle: memory.experiences.at(-1)?.cycle || null,
        curriculum: curriculumSummary(),
        memory: {
          storage: store.storage,
          path: store.publicPath,
          progress: memory.progress,
          experience_count: memory.experiences.length,
          imported_context_memory_patterns: CONTEXT_MEMORY_IMPORTS
        },
        safeguards: learningSafeguards()
      };
    },

    isLearningInstruction(message) {
      return isReinforcementLearningInstruction(message);
    },

    recall({ route = null } = {}) {
      return recallMemory(memory, route);
    },

    runCycle({
      message = "",
      route = null,
      response = null,
      scenario = "user_requested_reinforcement"
    } = {}) {
      const review = reviewResponse({ message, response });
      const read = readingBatch();
      const selfTest = buildSelfTest({ route, review });
      const reinforcementRules = buildReinforcementRules({ route, review });
      const cycleNumber = memory.progress.cycles_completed + 1;
      const cycle = {
        id: `learn_${cycleNumber}_${Date.now().toString(36)}`,
        mode: "autonomous_reinforcement_learning",
        scenario,
        created_at: new Date(now()).toISOString(),
        instruction: {
          user_triggered: scenario !== "assistant_background",
          kind: "reinforce_learning_memory",
          raw_text_stored: false
        },
        reading_batch: read,
        reading_phase: {
          status: "completed",
          total_books: read.reduce((sum, item) => sum + item.books_read_this_cycle, 0),
          categories: read.map((item) => ({
            category: item.category,
            label: item.label,
            books_completed: item.books_read_this_cycle,
            principles_absorbed: categoryPrinciples(item.category)
          }))
        },
        active_principles: activePrinciples(route),
        trial: {
          input_kind: route?.intent || "manual",
          score: review.score,
          passed: review.missing.length === 0,
          checks: review.checks
        },
        self_test: selfTest,
        corrections: review.missing.map((item) => ({
          rule_id: item.id,
          issue: item.label,
          revision: item.repair
        })),
        retrospective: buildRetrospective({ review, selfTest, reinforcementRules }),
        reinforcement: {
          applied: true,
          imported_into: "anna_personal_assistant_mode_runtime",
          rules: reinforcementRules
        },
        self_modification: buildSelfModification(review, reinforcementRules),
        memory_update: {
          stored: false,
          storage: store.storage,
          imported_context_memory_patterns: CONTEXT_MEMORY_IMPORTS
        },
        safeguards: learningSafeguards()
      };
      return remember(cycle);
    },

    apply(response, cycle) {
      if (!response || !cycle) return response;
      return applyLearningCycle(response, cycle);
    },

    applyMemory(response, recall) {
      if (!response || !recall?.applied_rules?.length) return response;
      return applyRememberedExperience(response, recall);
    },

    composeCycleResponse(cycle) {
      return composeReinforcementResponse(cycle);
    }
  };
}

export function curriculumSummary() {
  return LEARNING_CURRICULUM.map((section) => ({
    category: section.category,
    label: section.label,
    required_books_per_cycle: section.books.length,
    books: section.books.map(({ title, author, focus }) => ({ title, author, focus }))
  }));
}

export function isReinforcementLearningInstruction(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return /强化学习|自主学习|学习记忆|强化记忆|学习复盘|进行学习|训练一下|自我训练|自我测试|复盘并记忆|reinforce|self[-\s]?improve|learning cycle/i.test(text);
}

function createLearningMemoryStore({
  now,
  maxRecords,
  memoryPath,
  persist
}) {
  const resolvedPath = memoryPath || process.env.ANNA_LEARNING_MEMORY_PATH ||
    path.join(os.homedir(), ".anna", "personal-assistant-mode", "learning-memory.json");
  const storage = persist ? "persistent_json_file" : "memory_only";

  return {
    storage,
    publicPath: persist ? resolvedPath : null,
    load() {
      if (!persist) return emptyMemory(now());
      try {
        if (!fs.existsSync(resolvedPath)) return emptyMemory(now());
        const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
        return normalizeMemory(parsed, now(), maxRecords);
      } catch {
        return emptyMemory(now());
      }
    },
    save(memory) {
      if (!persist) return;
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, `${JSON.stringify(memory, null, 2)}\n`);
    }
  };
}

function emptyMemory(now) {
  const created = new Date(now).toISOString();
  return {
    schema: 1,
    created_at: created,
    updated_at: created,
    source: "anna_personal_assistant_learning_memory",
    imported_context_memory_patterns: CONTEXT_MEMORY_IMPORTS,
    progress: { ...DEFAULT_PROGRESS, books_completed: { ...DEFAULT_PROGRESS.books_completed }, reinforced_rules: [] },
    experiences: []
  };
}

function normalizeMemory(value, now, maxRecords) {
  const memory = value && typeof value === "object" ? value : emptyMemory(now);
  const progress = memory.progress && typeof memory.progress === "object"
    ? memory.progress
    : DEFAULT_PROGRESS;
  const experiences = Array.isArray(memory.experiences) ? memory.experiences.slice(-maxRecords) : [];
  return {
    schema: 1,
    created_at: memory.created_at || new Date(now).toISOString(),
    updated_at: memory.updated_at || new Date(now).toISOString(),
    source: "anna_personal_assistant_learning_memory",
    imported_context_memory_patterns: CONTEXT_MEMORY_IMPORTS,
    progress: {
      cycles_completed: Number(progress.cycles_completed) || experiences.length,
      books_completed: {
        psychology: Number(progress.books_completed?.psychology) || 0,
        logic: Number(progress.books_completed?.logic) || 0,
        response: Number(progress.books_completed?.response) || 0,
        total: Number(progress.books_completed?.total) || 0
      },
      self_tests_completed: Number(progress.self_tests_completed) || 0,
      reinforced_rules: Array.isArray(progress.reinforced_rules)
        ? progress.reinforced_rules.slice(-12)
        : []
    },
    experiences
  };
}

function updateMemory(memory, cycle, now, maxRecords) {
  const read = cycle.reading_batch || [];
  const booksCompleted = { ...memory.progress.books_completed };
  for (const item of read) {
    booksCompleted[item.category] = Number(booksCompleted[item.category] || 0) +
      Number(item.books_read_this_cycle || 0);
  }
  booksCompleted.total = Object.entries(booksCompleted)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);

  const reinforcedRules = [
    ...memory.progress.reinforced_rules,
    ...(cycle.reinforcement?.rules || [])
  ].slice(-12);
  const experiences = [
    ...memory.experiences,
    {
      id: cycle.id,
      created_at: cycle.created_at,
      summary: cycle.retrospective.summary,
      learned_experience: cycle.retrospective.learned_experience,
      score: cycle.trial.score,
      reinforced_rules: cycle.reinforcement.rules,
      cycle: compactCycleForMemory(cycle)
    }
  ].slice(-maxRecords);

  return {
    ...memory,
    updated_at: new Date(now).toISOString(),
    progress: {
      cycles_completed: Number(memory.progress.cycles_completed || 0) + 1,
      books_completed: booksCompleted,
      self_tests_completed: Number(memory.progress.self_tests_completed || 0) +
        Number(cycle.self_test?.cases?.length || 0),
      reinforced_rules: reinforcedRules
    },
    experiences
  };
}

function compactCycleForMemory(cycle) {
  return {
    id: cycle.id,
    mode: cycle.mode,
    scenario: cycle.scenario,
    created_at: cycle.created_at,
    reading_batch: cycle.reading_batch.map((item) => ({
      category: item.category,
      label: item.label,
      books_read_this_cycle: item.books_read_this_cycle,
      books: item.books.map(({ title, author, focus }) => ({ title, author, focus }))
    })),
    reading_phase: cycle.reading_phase,
    trial: cycle.trial,
    self_test: cycle.self_test,
    corrections: cycle.corrections,
    retrospective: cycle.retrospective,
    reinforcement: cycle.reinforcement,
    memory_update: cycle.memory_update,
    safeguards: cycle.safeguards
  };
}

function recallMemory(memory, route) {
  const rules = memory.progress.reinforced_rules || [];
  const intent = route?.intent || "general";
  const scoped = rules.filter((rule) =>
    rule.intent === "all" || rule.intent === intent || rule.intent === "general"
  );
  return {
    applied: scoped.length > 0,
    applied_rules: scoped.slice(-4),
    progress: memory.progress,
    last_experience: memory.experiences.at(-1) || null
  };
}

function readingBatch() {
  return curriculumSummary().map((section) => ({
    category: section.category,
    label: section.label,
    books_read_this_cycle: section.books.length,
    books: section.books
  }));
}

function categoryPrinciples(category) {
  return {
    psychology: ["识别认知偏差", "先共情再建议", "避免操控式说服"],
    logic: ["区分前提和结论", "主动寻找反例", "用限定语表达不确定性"],
    response: ["先复述用户目标", "用清晰短句", "给可执行且可逆的下一步"]
  }[category] || [];
}

function activePrinciples(route) {
  const intent = route?.intent || "general";
  const base = [
    "先确认用户目标，再给建议",
    "把事实、推断和未知分开",
    "建议保持可逆，避免替用户裁决",
    "不诊断、不操控、不制造依赖"
  ];
  if (intent === "companion") {
    base.push("优先反映情绪和影响，再进入行动");
  }
  if (intent === "decision") {
    base.push("列出选项、代价、证据和反例");
  }
  if (intent === "health") {
    base.push("健康数据只做日常提醒，不做医疗判断");
  }
  if (intent === "travel") {
    base.push("外部订购、身份资料和付款必须保留人工确认门");
  }
  return base;
}

function reviewResponse({ message, response }) {
  const checks = RUBRIC.map((rule) => ({
    id: rule.id,
    label: rule.label,
    passed: Boolean(rule.applies(response, message)),
    repair: rule.repair
  }));
  const missing = checks.filter((item) => !item.passed);
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { checks, missing, score };
}

function buildSelfTest({ route, review }) {
  const intent = route?.intent || "general";
  const cases = [
    {
      id: "understanding",
      prompt: "用户给出含混请求时，Anna 是否先确认目标和状态？",
      expected: ["warm_reflection", "user_agency"],
      passed: review.checks.some((item) => item.id === "warm_reflection" && item.passed) &&
        review.checks.some((item) => item.id === "user_agency" && item.passed)
    },
    {
      id: "reasoning",
      prompt: "Anna 是否把事实、推断和未知分开？",
      expected: ["source_separation"],
      passed: review.checks.some((item) => item.id === "source_separation" && item.passed)
    },
    {
      id: "safe_action",
      prompt: "Anna 是否保留安全边界并给出可执行下一步？",
      expected: ["actionable_next_step", "safety_boundary"],
      passed: review.checks.some((item) => item.id === "actionable_next_step" && item.passed) &&
        review.checks.some((item) => item.id === "safety_boundary" && item.passed)
    }
  ];
  return {
    intent,
    cases,
    passed: cases.every((item) => item.passed),
    score: Math.round((cases.filter((item) => item.passed).length / cases.length) * 100)
  };
}

function buildReinforcementRules({ route, review }) {
  const intent = route?.intent || "general";
  const repairs = review.missing.map((item) => ({
    id: `repair_${item.id}`,
    intent,
    rule: item.repair
  }));
  const defaults = [
    {
      id: "reinforce_understand_before_answer",
      intent: "all",
      rule: "回答前先提炼用户真实目标、情绪或限制，再进入建议。"
    },
    {
      id: "reinforce_clear_uncertainty",
      intent: "all",
      rule: "把已知、推断、未知和下一步分开表达，避免过度确定。"
    },
    {
      id: "reinforce_memory_recap",
      intent: "all",
      rule: "在复杂任务后沉淀一条可复用经验，供后续上下文读取。"
    }
  ];
  return dedupeRules([...defaults, ...repairs]).slice(0, 6);
}

function dedupeRules(rules) {
  const seen = new Set();
  return rules.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function buildRetrospective({ review, selfTest, reinforcementRules }) {
  const missing = review.missing.map((item) => item.label);
  return {
    summary: missing.length === 0
      ? "本次学习完成后，Anna 的回复结构满足核心检查；已把成功经验强化为后续回复规则。"
      : `本次学习完成后，Anna 发现 ${missing.join("、")} 仍需强化，并已写入后续回复规则。`,
    learned_experience: [
      "心理学层面：先识别用户状态和自主性，避免操控式建议。",
      "逻辑学层面：用事实、推断、未知和反例降低误判。",
      "回复能力层面：先复述目标，再给清晰、可逆、可执行的下一步。"
    ],
    self_test_result: selfTest.passed ? "passed" : "needs_reinforcement",
    reinforcement_rules: reinforcementRules
  };
}

function buildSelfModification(review, reinforcementRules) {
  return {
    applied: true,
    summary: review.missing.length === 0
      ? "本次学习经验已导入个人助理模式，后续回复会优先使用已强化规则。"
      : "本次学习发现缺口，已将修正规则写入个人助理模式的学习记忆。",
    prompt_patch: reinforcementRules.map((item) => item.rule)
  };
}

function applyLearningCycle(response, cycle) {
  const nextActions = Array.isArray(response.next_actions) ? [...response.next_actions] : [];
  for (const rule of cycle.reinforcement.rules.slice(0, 2)) {
    if (!nextActions.includes(rule.rule)) {
      nextActions.push(rule.rule);
    }
  }
  const reasoning = {
    ...(response.reasoning || {}),
    inferred: [
      ...((response.reasoning && Array.isArray(response.reasoning.inferred))
        ? response.reasoning.inferred
        : []),
      "已完成本次自主学习、自测、复盘和记忆强化"
    ]
  };
  return {
    ...response,
    reasoning,
    next_actions: nextActions,
    learning: learningMetadata(cycle)
  };
}

function applyRememberedExperience(response, recall) {
  const reasoning = {
    ...(response.reasoning || {}),
    inferred: [
      ...((response.reasoning && Array.isArray(response.reasoning.inferred))
        ? response.reasoning.inferred
        : []),
      `已应用 ${recall.applied_rules.length} 条强化学习记忆`
    ]
  };
  return {
    ...response,
    reasoning,
    memory: {
      applied: true,
      applied_rules_count: recall.applied_rules.length,
      last_memory_id: recall.last_experience?.id || null
    }
  };
}

function composeReinforcementResponse(cycle) {
  return {
    opening: "本次强化学习已完成，并已写入记忆。",
    answer: [
      `Anna 已完成 ${cycle.reading_phase.total_books} 本书目原则的自主学习：心理学 5 本、逻辑学 5 本、回复能力 5 本。`,
      `随后完成自我测试，综合自评分 ${cycle.trial.score}，并形成复盘：${cycle.retrospective.summary}`,
      "这些经验已经导入个人助理模式，后续会用于更清晰、准确地理解和回复用户指令。"
    ].join(""),
    reasoning: {
      observed: [
        `学习批次：${cycle.reading_phase.total_books} 本`,
        `自测用例：${cycle.self_test.cases.length} 个`,
        `记忆进度：第 ${cycle.memory_update.progress_after.cycles_completed} 次强化学习`,
        `累计书目进度：${cycle.memory_update.progress_after.books_completed.total} 本次书目学习记录`
      ],
      inferred: ["本轮复盘经验已作为强化规则写入个人助理模式"],
      unknown: ["书籍受版权保护的正文内容", "Anna 主机底层模型权重是否改变"]
    },
    next_actions: cycle.reinforcement.rules.slice(0, 3).map((item) => item.rule),
    boundaries: learningSafeguards(),
    learning: learningMetadata(cycle)
  };
}

function learningMetadata(cycle) {
  return {
    cycle_id: cycle.id,
    mode: cycle.mode,
    score: cycle.trial.score,
    self_test_score: cycle.self_test.score,
    passed: cycle.trial.passed,
    reading_categories: cycle.reading_batch.map((item) => ({
      category: item.category,
      books: item.books_read_this_cycle
    })),
    total_books: cycle.reading_phase.total_books,
    corrections: cycle.corrections,
    retrospective: cycle.retrospective,
    memory_update: cycle.memory_update
  };
}

function learningSafeguards() {
  return [
    "只使用书目元数据、原则标签和自写评估规则，不复制受版权保护的正文",
    "学习记忆只保存进度、复盘和强化规则，不保存用户原始私人对话",
    "自我修改只调整回复策略和下一步建议，不绕过用户确认、健康、隐私或付款边界",
    "高风险、医疗、法律、金融等场景仍需要明确不确定性和专业边界"
  ];
}

function flattenResponse(response) {
  if (!response) return "";
  return [
    response.opening,
    response.answer,
    ...(response.next_actions || []),
    ...(response.boundaries || [])
  ].filter(Boolean).join(" ");
}
