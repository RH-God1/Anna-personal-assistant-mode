import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssistantService } from "../executas/personal-assistant-node/lib/service.js";

const options = parseArgs(process.argv.slice(2));
const format = options.format || "json";
const outFile = options.out || null;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-learning-memory-smoke-"));
const memoryPath = path.join(dir, "learning-memory.json");

const service = createAssistantService({
  now: () => new Date("2026-06-20T10:00:00.000Z"),
  learningMemoryPath: memoryPath
});

const before = service.learningStatus();
assert.equal(before.trigger, "user_instruction_required");
assert.equal(before.cycle_count, 0);
assert.deepEqual(
  before.curriculum.map((section) => section.required_books_per_cycle),
  [5, 5, 5]
);

const normalBefore = await service.assist({
  message: "我有点焦虑，帮我把回复说得稳一点"
});
assert.equal(normalBefore.context.learning, undefined);
assert.equal(normalBefore.context.learning_memory.applied, false);
assert.equal(service.learningStatus().cycle_count, 0);

const learning = await service.assist({
  message: "请进行本次强化学习并记住学习经验"
});
const cycle = learning.context.learning;
assert.equal(cycle.mode, "autonomous_reinforcement_learning");
assert.equal(cycle.reading_phase.total_books, 15);
assert.deepEqual(
  cycle.reading_batch.map((section) => section.books_read_this_cycle),
  [5, 5, 5]
);
assert.equal(cycle.memory_update.stored, true);
assert.equal(cycle.self_test.cases.length, 3);
assert.match(learning.response.opening, /强化学习已完成/);
assert.equal(fs.existsSync(memoryPath), true);

const restored = createAssistantService({
  now: () => new Date("2026-06-20T10:05:00.000Z"),
  learningMemoryPath: memoryPath
});
const restoredStatus = restored.learningStatus();
assert.equal(restoredStatus.cycle_count, 1);
assert.equal(restoredStatus.memory.progress.books_completed.total, 15);
assert.equal(restoredStatus.memory.progress.self_tests_completed, 3);

const normalAfter = await restored.assist({
  message: "帮我比较两个选择，并说明事实、推断和未知"
});
assert.equal(normalAfter.context.learning_memory.applied, true);
assert.equal(normalAfter.response.memory.applied, true);

const summary = {
  scenario: "anna-personal-assistant-learning-memory-smoke",
  generated_at: new Date().toISOString(),
  generated_at_shanghai: formatShanghaiTime(new Date()),
  memory_path: memoryPath,
  curriculum: {
    categories: before.curriculum.map((section) => section.label),
    books_per_cycle: before.curriculum.map((section) => section.required_books_per_cycle),
    total_books_per_cycle: cycle.reading_phase.total_books
  },
  checks: {
    normal_assist_does_not_train: true,
    learning_instruction_trains: true,
    self_test_cases: cycle.self_test.cases.length,
    memory_file_written: true,
    restored_cycle_count: restoredStatus.cycle_count,
    restored_total_books: restoredStatus.memory.progress.books_completed.total,
    remembered_rules_applied_after_restart: normalAfter.response.memory.applied
  },
  latest_retrospective: cycle.retrospective.summary,
  safeguards: cycle.safeguards
};

const rendered = format === "markdown"
  ? renderMarkdown(summary)
  : JSON.stringify(summary, null, 2);

if (outFile) {
  const absolute = path.resolve(outFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${rendered}\n`);
  console.log(`Wrote ${absolute}`);
} else {
  console.log(rendered);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--format") {
      parsed.format = argv[index + 1];
      index += 1;
    } else if (arg === "--out") {
      parsed.out = argv[index + 1];
      index += 1;
    }
  }
  if (parsed.format && !["json", "markdown"].includes(parsed.format)) {
    throw new Error("--format must be json or markdown");
  }
  return parsed;
}

function renderMarkdown(result) {
  return [
    "# Anna 个人助理强化学习记忆 Smoke 报告",
    "",
    `生成时间：${result.generated_at_shanghai}（Asia/Shanghai）`,
    `UTC：${result.generated_at}`,
    "",
    "## 结论",
    "",
    "- 普通 assist 不会误触发强化学习。",
    "- 用户明确发出强化学习指令后，会完成心理学、逻辑学、回复能力各 5 本的书目级学习记录。",
    "- 学习循环会完成自测、复盘、规则修正和记忆写入。",
    "- 服务重启后可以读取同一份学习记忆，并在普通回复中应用强化规则。",
    "",
    "## 检查项",
    "",
    `- 每轮课程分类：${result.curriculum.categories.join("、")}`,
    `- 每类书目数：${result.curriculum.books_per_cycle.join(" / ")}`,
    `- 每轮总书目记录：${result.curriculum.total_books_per_cycle}`,
    `- 自测用例数：${result.checks.self_test_cases}`,
    `- 恢复后的学习轮数：${result.checks.restored_cycle_count}`,
    `- 恢复后的累计书目记录：${result.checks.restored_total_books}`,
    `- 后续回复应用记忆：${result.checks.remembered_rules_applied_after_restart ? "是" : "否"}`,
    "",
    "## 本轮复盘",
    "",
    result.latest_retrospective,
    "",
    "## 安全边界",
    "",
    ...result.safeguards.map((item) => `- ${item}`)
  ].join("\n");
}

function formatShanghaiTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date).replace(/\//g, "-");
}

