import test from "node:test";
import assert from "node:assert/strict";
import { AnnaProjectWorkspace } from "../src/workspace.js";

function createWorkspace() {
  let id = 0;
  return new AnnaProjectWorkspace({
    now: () => new Date("2026-06-14T06:00:00.000Z"),
    idFactory: () => `id-${++id}`,
    models: [
      {
        id: "openai-reasoning",
        label: "OpenAI reasoning model",
        provider: "openai",
        capabilities: ["text", "code", "tools"]
      },
      {
        id: "gemini-multimodal",
        label: "Gemini multimodal model",
        provider: "google",
        capabilities: ["text", "vision", "audio", "tools"]
      },
      {
        id: "gemma-local",
        label: "Gemma local model",
        provider: "local",
        capabilities: ["text", "code"]
      }
    ]
  });
}

test("three subprojects can use different models and share work through dependencies", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({
    name: "x",
    goal: "构建并汇总两个独立模块",
    instructions: "结论必须保留来源，模型输出不能自动成为事实。"
  });
  const one = workspace.createSubproject({
    projectId: project.id,
    name: "1",
    objective: "实现模块一",
    modelId: "openai-reasoning",
    requiredCapabilities: ["text", "code"]
  });
  const two = workspace.createSubproject({
    projectId: project.id,
    name: "2",
    objective: "分析图像输入并实现模块二",
    modelId: "gemini-multimodal",
    requiredCapabilities: ["text", "vision"]
  });

  const oneArtifact = workspace.addArtifact({
    projectId: project.id,
    subprojectId: one.id,
    name: "module-one.md",
    summary: "模块一接口和测试结果。",
    mediaType: "text/markdown",
    uri: "anna://projects/x/1/module-one.md",
    source: { kind: "model", model_id: "openai-reasoning" }
  });
  const twoArtifact = workspace.addArtifact({
    projectId: project.id,
    subprojectId: two.id,
    name: "module-two.json",
    summary: "模块二的视觉分析结构和输出契约。",
    mediaType: "application/json",
    uri: "anna://projects/x/2/module-two.json",
    source: { kind: "model", model_id: "gemini-multimodal" }
  });
  workspace.publishArtifact({
    projectId: project.id,
    artifactId: oneArtifact.id,
    visibility: "dependencies",
    approvedBy: "user"
  });
  workspace.publishArtifact({
    projectId: project.id,
    artifactId: twoArtifact.id,
    visibility: "dependencies",
    approvedBy: "user"
  });
  workspace.addMemory({
    projectId: project.id,
    subprojectId: one.id,
    kind: "decision",
    title: "统一输出格式",
    content: "两个模块都输出带 provenance 字段的 JSON。",
    scope: "project",
    source: { kind: "user" }
  });
  workspace.addMemory({
    projectId: project.id,
    subprojectId: one.id,
    kind: "note",
    title: "未共享的草稿",
    content: "这段内容只属于子项目 1。",
    scope: "subproject",
    source: { kind: "user" }
  });

  const three = workspace.createSubproject({
    projectId: project.id,
    name: "3",
    objective: "汇总模块一与模块二",
    modelId: "gemma-local",
    requiredCapabilities: ["text"],
    dependsOn: [one.id, two.id]
  });
  const context = workspace.compileContext({
    projectId: project.id,
    subprojectId: three.id,
    task: "整合两个模块并生成最终方案"
  });

  assert.equal(context.model_execution.selected_model_id, "gemma-local");
  assert.deepEqual(
    context.dependency_artifacts.map((item) => item.name).sort(),
    ["module-one.md", "module-two.json"]
  );
  assert.equal(context.shared_memory.length, 1);
  assert.equal(context.shared_memory[0].title, "统一输出格式");
  assert.equal(context.context_policy.raw_cross_subproject_chat_shared, false);
  assert.equal(
    context.dependency_artifacts[0].source.kind,
    "model"
  );
});

test("model selection falls back when the host has not confirmed required capabilities", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "vision" });
  const subproject = workspace.createSubproject({
    projectId: project.id,
    name: "image-task",
    modelId: "gemma-local",
    requiredCapabilities: ["text", "vision"]
  });

  assert.equal(subproject.model_binding.requested_model_id, "gemma-local");
  assert.equal(subproject.model_binding.selected_model_id, "anna-auto");
  assert.equal(subproject.model_binding.fallback_used, true);
  assert.match(subproject.model_binding.fallback_reason, /lacks confirmed capabilities/);
});

test("model memory remains proposed and private until the user promotes it", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "memory" });
  const source = workspace.createSubproject({
    projectId: project.id,
    name: "source",
    modelId: "openai-reasoning"
  });
  const target = workspace.createSubproject({
    projectId: project.id,
    name: "target",
    modelId: "gemma-local"
  });
  const memory = workspace.addMemory({
    projectId: project.id,
    subprojectId: source.id,
    kind: "summary",
    title: "模型总结",
    content: "这是模型生成、尚未经确认的项目结论。",
    source: { kind: "model", model_id: "openai-reasoning" }
  });

  assert.equal(memory.state, "proposed");
  assert.equal(
    workspace.compileContext({
      projectId: project.id,
      subprojectId: target.id
    }).shared_memory.length,
    0
  );
  assert.throws(
    () => workspace.promoteMemory({
      projectId: project.id,
      memoryId: memory.id,
      approvedBy: "model"
    }),
    /explicit user approval/
  );

  workspace.promoteMemory({
    projectId: project.id,
    memoryId: memory.id,
    approvedBy: "user"
  });
  const context = workspace.compileContext({
    projectId: project.id,
    subprojectId: target.id
  });
  assert.equal(context.shared_memory[0].state, "confirmed");
  assert.equal(context.shared_memory[0].approved_by, "user");
});

test("current thread is retained only inside its own subproject context", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "threads" });
  const one = workspace.createSubproject({
    projectId: project.id,
    name: "1",
    modelId: "openai-reasoning"
  });
  const two = workspace.createSubproject({
    projectId: project.id,
    name: "2",
    modelId: "gemini-multimodal"
  });
  workspace.appendTurn({
    projectId: project.id,
    subprojectId: one.id,
    role: "user",
    content: "只属于项目 1 的原始讨论"
  });

  const oneContext = workspace.compileContext({
    projectId: project.id,
    subprojectId: one.id
  });
  const twoContext = workspace.compileContext({
    projectId: project.id,
    subprojectId: two.id
  });
  assert.equal(oneContext.current_thread.length, 1);
  assert.equal(twoContext.current_thread.length, 0);
});

test("project exports as a versioned portable JSON snapshot", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "portable" });
  workspace.createSubproject({
    projectId: project.id,
    name: "child",
    modelId: "gemma-local"
  });
  const snapshot = workspace.exportProject(project.id);
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.schema_version, 1);
  assert.equal(snapshot.type, "anna.project");
  assert.match(serialized, /explicit_publish/);
  assert.equal(snapshot.subprojects.length, 1);
});

test("artifacts inherit the active model as provenance when none is supplied", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "provenance" });
  const subproject = workspace.createSubproject({
    projectId: project.id,
    name: "builder",
    modelId: "gemma-local"
  });
  const artifact = workspace.addArtifact({
    projectId: project.id,
    subprojectId: subproject.id,
    name: "result.txt",
    summary: "构建结果"
  });

  assert.equal(artifact.source.kind, "model");
  assert.equal(artifact.source.model_id, "gemma-local");
  assert.equal(artifact.visibility, "private");
});

test("model artifacts require user approval before cross-project publication", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "publication" });
  const source = workspace.createSubproject({
    projectId: project.id,
    name: "source",
    modelId: "openai-reasoning"
  });
  const target = workspace.createSubproject({
    projectId: project.id,
    name: "target",
    modelId: "gemma-local",
    dependsOn: [source.id]
  });
  assert.throws(
    () => workspace.addArtifact({
      projectId: project.id,
      subprojectId: source.id,
      name: "unsafe.txt",
      summary: "不应直接共享",
      visibility: "dependencies"
    }),
    /explicit user approval/
  );
  const artifact = workspace.addArtifact({
    projectId: project.id,
    subprojectId: source.id,
    name: "safe.txt",
    summary: "先私有，再由用户发布"
  });
  assert.equal(
    workspace.compileContext({
      projectId: project.id,
      subprojectId: target.id
    }).dependency_artifacts.length,
    0
  );
  workspace.publishArtifact({
    projectId: project.id,
    artifactId: artifact.id,
    approvedBy: "user"
  });
  assert.equal(
    workspace.compileContext({
      projectId: project.id,
      subprojectId: target.id
    }).dependency_artifacts.length,
    1
  );
});

test("offline models and forged provenance are rejected or routed safely", () => {
  const workspace = createWorkspace();
  workspace.registerModel({
    id: "offline-model",
    capabilities: ["text", "code"],
    status: "OFFLINE"
  });
  const project = workspace.createProject({ name: "model-safety" });
  const subproject = workspace.createSubproject({
    projectId: project.id,
    name: "worker",
    modelId: "offline-model",
    requiredCapabilities: ["text", "code"]
  });
  assert.equal(subproject.model_binding.selected_model_id, "anna-auto");
  assert.match(subproject.model_binding.fallback_reason, /unavailable/);
  assert.throws(
    () => workspace.addArtifact({
      projectId: project.id,
      subprojectId: subproject.id,
      name: "forged.txt",
      summary: "伪造",
      source: { kind: "model", model_id: "gemini-multimodal" }
    }),
    /not bound/
  );
});

test("context compiler honors small model windows and keeps dependency artifacts first", () => {
  const workspace = createWorkspace();
  workspace.registerModel({
    id: "small-model",
    capabilities: ["text"],
    context_window: 256
  });
  const project = workspace.createProject({
    name: "budget",
    goal: "验证上下文预算",
    instructions: "优先保留依赖产物"
  });
  const source = workspace.createSubproject({
    projectId: project.id,
    name: "source",
    modelId: "openai-reasoning"
  });
  const artifact = workspace.addArtifact({
    projectId: project.id,
    subprojectId: source.id,
    name: "critical.json",
    summary: `关键接口。${"A".repeat(180)}`
  });
  workspace.publishArtifact({
    projectId: project.id,
    artifactId: artifact.id,
    approvedBy: "user"
  });
  for (let index = 0; index < 12; index += 1) {
    workspace.addMemory({
      projectId: project.id,
      kind: "note",
      title: `memory-${index}`,
      content: "B".repeat(300),
      scope: "project",
      source: { kind: "user" }
    });
  }
  const target = workspace.createSubproject({
    projectId: project.id,
    name: "target",
    modelId: "small-model",
    dependsOn: [source.id]
  });
  const context = workspace.compileContext({
    projectId: project.id,
    subprojectId: target.id,
    task: "整合",
    maxItemCharacters: 300
  });

  assert.ok(context.context_budget.used <= context.context_budget.maximum);
  assert.equal(context.dependency_artifacts[0].name, "critical.json");
  assert.equal(context.context_budget.truncated, true);
  assert.ok(context.context_budget.omitted.memories > 0);
});

test("dependency updates reject cycles and preserve the previous graph", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "graph" });
  const one = workspace.createSubproject({
    projectId: project.id,
    name: "one",
    modelId: "gemma-local"
  });
  const two = workspace.createSubproject({
    projectId: project.id,
    name: "two",
    modelId: "gemma-local",
    dependsOn: [one.id]
  });
  assert.throws(
    () => workspace.setDependencies({
      projectId: project.id,
      subprojectId: one.id,
      dependsOn: [two.id]
    }),
    /dependency cycle/
  );
  const snapshot = workspace.exportProject(project.id);
  assert.deepEqual(
    snapshot.subprojects.find((item) => item.id === one.id).depends_on,
    []
  );
});

test("revision ordering keeps the newest memory when timestamps are identical", () => {
  const workspace = createWorkspace();
  const project = workspace.createProject({ name: "ordering" });
  const subproject = workspace.createSubproject({
    projectId: project.id,
    name: "worker",
    modelId: "gemma-local"
  });
  for (const title of ["first", "second", "third"]) {
    workspace.addMemory({
      projectId: project.id,
      kind: "note",
      title,
      content: title,
      scope: "project",
      source: { kind: "user" }
    });
  }
  const context = workspace.compileContext({
    projectId: project.id,
    subprojectId: subproject.id,
    maxMemoryItems: 1
  });

  assert.equal(context.shared_memory[0].title, "third");
});
