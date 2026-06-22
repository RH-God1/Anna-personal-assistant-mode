import { AnnaProjectWorkspace } from "./workspace.js";

export const VIRTUAL_MODEL_PROFILES = Object.freeze([
  {
    id: "virtual-architect",
    label: "Virtual Architect",
    provider: "anna-lab",
    capabilities: ["text", "code", "tools"],
    context_window: 4096
  },
  {
    id: "virtual-vision",
    label: "Virtual Vision",
    provider: "anna-lab",
    capabilities: ["text", "vision", "audio"],
    context_window: 4096
  },
  {
    id: "virtual-synth-small",
    label: "Virtual Small Synthesizer",
    provider: "anna-lab",
    capabilities: ["text", "code"],
    context_window: 512
  },
  {
    id: "virtual-text-only",
    label: "Virtual Text Only",
    provider: "anna-lab",
    capabilities: ["text"],
    context_window: 2048
  },
  {
    id: "virtual-offline",
    label: "Virtual Offline Model",
    provider: "anna-lab",
    capabilities: ["text", "code", "vision"],
    status: "OFFLINE",
    context_window: 8192
  }
]);

class VirtualModel {
  constructor(profile, handler) {
    this.profile = profile;
    this.handler = handler;
  }

  execute(context) {
    if (context.model_execution.selected_model_id !== this.profile.id) {
      throw new Error(
        `${this.profile.id} cannot execute binding for ` +
        context.model_execution.selected_model_id
      );
    }
    const missing = context.model_execution.required_capabilities.filter(
      (capability) => !this.profile.capabilities.includes(capability)
    );
    if (missing.length) {
      throw new Error(`${this.profile.id} is missing capabilities: ${missing.join(", ")}`);
    }
    if (context.context_budget.used > context.context_budget.maximum) {
      throw new Error(`${this.profile.id} received an over-budget context`);
    }
    return this.handler(context);
  }
}

export function runVirtualModelExperiment() {
  let id = 0;
  let second = 0;
  const workspace = new AnnaProjectWorkspace({
    idFactory: () => `lab-${++id}`,
    now: () => new Date(Date.UTC(2026, 5, 14, 8, 0, second++)),
    models: VIRTUAL_MODEL_PROFILES
  });
  const models = createVirtualModels();
  const checks = [];
  const check = (name, condition, details = null) => {
    if (!condition) throw new Error(`experiment check failed: ${name}`);
    checks.push({ name, passed: true, details });
  };

  const project = workspace.createProject({
    name: "虚拟多模型产品实验",
    goal: "分别生成接口、分析界面，再由小上下文模型整合。",
    instructions: "所有跨项目模型产物必须经用户发布，并保留来源。"
  });
  workspace.addMemory({
    projectId: project.id,
    kind: "constraint",
    title: "输出约束",
    content: "最终方案必须同时引用接口产物和视觉产物。",
    scope: "project",
    source: { kind: "user" }
  });

  const architecture = workspace.createSubproject({
    projectId: project.id,
    name: "1-接口构建",
    objective: "设计项目 API 和测试契约。",
    modelId: "virtual-architect",
    requiredCapabilities: ["text", "code", "tools"]
  });
  workspace.appendTurn({
    projectId: project.id,
    subprojectId: architecture.id,
    role: "user",
    content: "请生成项目 API 契约。"
  });
  const architectureContext = workspace.compileContext({
    projectId: project.id,
    subprojectId: architecture.id,
    task: "构建 API 契约"
  });
  const architectureResult = models.get("virtual-architect").execute(
    architectureContext
  );
  workspace.appendTurn({
    projectId: project.id,
    subprojectId: architecture.id,
    role: "assistant",
    content: architectureResult.response
  });
  const architectureArtifact = workspace.addArtifact({
    projectId: project.id,
    subprojectId: architecture.id,
    ...architectureResult.artifact
  });
  const proposedMemory = workspace.addMemory({
    projectId: project.id,
    subprojectId: architecture.id,
    kind: "decision",
    title: "接口版本",
    content: "接口使用 schema_version: 1。",
    source: { kind: "model" }
  });
  check(
    "model memory starts proposed",
    proposedMemory.state === "proposed"
  );

  const isolationProbe = workspace.createSubproject({
    projectId: project.id,
    name: "隔离探针",
    objective: "检查未发布产物是否泄漏。",
    modelId: "virtual-text-only",
    dependsOn: [architecture.id]
  });
  const isolatedContext = workspace.compileContext({
    projectId: project.id,
    subprojectId: isolationProbe.id
  });
  check(
    "private artifact is isolated",
    isolatedContext.dependency_artifacts.length === 0
  );
  expectError(
    () => workspace.publishArtifact({
      projectId: project.id,
      artifactId: architectureArtifact.id,
      visibility: "dependencies",
      approvedBy: "model"
    }),
    /explicit user approval/
  );
  workspace.publishArtifact({
    projectId: project.id,
    artifactId: architectureArtifact.id,
    visibility: "dependencies",
    approvedBy: "user"
  });
  workspace.promoteMemory({
    projectId: project.id,
    memoryId: proposedMemory.id,
    approvedBy: "user"
  });

  const vision = workspace.createSubproject({
    projectId: project.id,
    name: "2-视觉分析",
    objective: "分析产品界面草图并输出布局说明。",
    modelId: "virtual-vision",
    requiredCapabilities: ["text", "vision"]
  });
  workspace.appendTurn({
    projectId: project.id,
    subprojectId: vision.id,
    role: "user",
    content: "分析附件中的项目管理界面。",
    attachments: [{
      name: "workspace-wireframe.png",
      media_type: "image/png",
      size: 2048,
      uri: "anna://lab/workspace-wireframe.png"
    }]
  });
  const visionContext = workspace.compileContext({
    projectId: project.id,
    subprojectId: vision.id,
    task: "分析界面层级"
  });
  const visionResult = models.get("virtual-vision").execute(visionContext);
  const visionArtifact = workspace.addArtifact({
    projectId: project.id,
    subprojectId: vision.id,
    ...visionResult.artifact
  });
  workspace.publishArtifact({
    projectId: project.id,
    artifactId: visionArtifact.id,
    visibility: "dependencies",
    approvedBy: "user"
  });

  for (let index = 1; index <= 8; index += 1) {
    workspace.addMemory({
      projectId: project.id,
      kind: "note",
      title: `压力记忆 ${index}`,
      content: `第 ${index} 条压力记忆。${"上下文负载。".repeat(45)}`,
      scope: "project",
      source: { kind: "user" }
    });
  }

  const synthesis = workspace.createSubproject({
    projectId: project.id,
    name: "3-整合",
    objective: "使用小上下文模型整合两个上游项目。",
    modelId: "virtual-synth-small",
    requiredCapabilities: ["text", "code"],
    dependsOn: [architecture.id, vision.id]
  });
  const synthesisContext = workspace.compileContext({
    projectId: project.id,
    subprojectId: synthesis.id,
    task: "合并接口和界面方案",
    maxItemCharacters: 600
  });
  const synthesisResult = models.get("virtual-synth-small").execute(
    synthesisContext
  );
  check(
    "small model context stays within budget",
    synthesisContext.context_budget.used <=
      synthesisContext.context_budget.maximum,
    synthesisContext.context_budget
  );
  check(
    "dependency artifacts survive context pressure",
    synthesisContext.dependency_artifacts.length === 2,
    synthesisContext.dependency_artifacts.map((item) => item.name)
  );
  check(
    "large context reports truncation",
    synthesisContext.context_budget.truncated === true &&
      synthesisContext.context_budget.omitted.memories > 0,
    synthesisContext.context_budget
  );
  check(
    "synthesizer consumed both upstream outputs",
    synthesisResult.used_artifacts.length === 2,
    synthesisResult.used_artifacts
  );

  const unavailable = workspace.createSubproject({
    projectId: project.id,
    name: "离线模型探针",
    modelId: "virtual-offline",
    requiredCapabilities: ["text", "code"]
  });
  check(
    "offline model falls back",
    unavailable.model_binding.selected_model_id === "anna-auto" &&
      unavailable.model_binding.fallback_reason.includes("unavailable"),
    unavailable.model_binding
  );

  const capabilityMismatch = workspace.createSubproject({
    projectId: project.id,
    name: "能力探针",
    modelId: "virtual-text-only",
    requiredCapabilities: ["text", "vision"]
  });
  check(
    "capability mismatch falls back",
    capabilityMismatch.model_binding.selected_model_id === "anna-auto",
    capabilityMismatch.model_binding
  );

  expectError(
    () => workspace.addArtifact({
      projectId: project.id,
      subprojectId: architecture.id,
      name: "forged.txt",
      summary: "伪造来源",
      source: { kind: "model", model_id: "virtual-vision" }
    }),
    /not bound/
  );
  check("forged model provenance is rejected", true);

  const cycleA = workspace.createSubproject({
    projectId: project.id,
    name: "循环-A",
    modelId: "virtual-text-only"
  });
  const cycleB = workspace.createSubproject({
    projectId: project.id,
    name: "循环-B",
    modelId: "virtual-text-only",
    dependsOn: [cycleA.id]
  });
  expectError(
    () => workspace.setDependencies({
      projectId: project.id,
      subprojectId: cycleA.id,
      dependsOn: [cycleB.id]
    }),
    /dependency cycle/
  );
  check("dependency cycle is rejected", true);

  return {
    experiment: "anna-virtual-multi-model-lab",
    project_id: project.id,
    virtual_models: VIRTUAL_MODEL_PROFILES.map((profile) => ({
      id: profile.id,
      capabilities: profile.capabilities,
      status: profile.status || "available",
      context_window: profile.context_window
    })),
    subproject_count: workspace.exportProject(project.id).subprojects.length,
    checks,
    synthesis: {
      context_budget: synthesisContext.context_budget,
      used_artifacts: synthesisResult.used_artifacts
    },
    passed: checks.every((item) => item.passed)
  };
}

function createVirtualModels() {
  const profiles = new Map(VIRTUAL_MODEL_PROFILES.map((profile) => [
    profile.id,
    profile
  ]));
  return new Map([
    ["virtual-architect", new VirtualModel(
      profiles.get("virtual-architect"),
      () => ({
        response: "已生成带版本号和来源字段的 API 契约。",
        artifact: {
          name: "api-contract.json",
          summary: "API 契约包含 projects、subprojects、memories 和 artifacts。",
          mediaType: "application/json",
          uri: "anna://lab/1/api-contract.json"
        }
      })
    )],
    ["virtual-vision", new VirtualModel(
      profiles.get("virtual-vision"),
      (context) => {
        const hasImage = context.current_thread.some((turn) =>
          turn.attachments.some((attachment) =>
            attachment.media_type.startsWith("image/")
          )
        );
        if (!hasImage) throw new Error("virtual-vision did not receive image metadata");
        return {
          response: "已分析项目树、模型选择器和上下文预览区。",
          artifact: {
            name: "ui-analysis.md",
            summary: "界面包含总项目树、子项目模型标签、依赖关系和共享审批入口。",
            mediaType: "text/markdown",
            uri: "anna://lab/2/ui-analysis.md"
          }
        };
      }
    )],
    ["virtual-synth-small", new VirtualModel(
      profiles.get("virtual-synth-small"),
      (context) => {
        if (context.dependency_artifacts.length < 2) {
          throw new Error("virtual-synth-small is missing dependency artifacts");
        }
        return {
          response: "已在小上下文窗口中完成接口与界面方案整合。",
          used_artifacts: context.dependency_artifacts.map((item) => item.name)
        };
      }
    )]
  ]);
}

function expectError(operation, pattern) {
  try {
    operation();
  } catch (error) {
    if (pattern.test(error.message)) return;
    throw error;
  }
  throw new Error(`expected operation to fail with ${pattern}`);
}
