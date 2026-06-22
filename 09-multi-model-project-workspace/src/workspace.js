import { randomUUID } from "node:crypto";

const MEMORY_SCOPES = new Set(["subproject", "project"]);
const MEMORY_STATES = new Set(["proposed", "confirmed"]);
const MEMORY_KINDS = new Set([
  "fact",
  "decision",
  "constraint",
  "summary",
  "note"
]);
const ARTIFACT_VISIBILITY = new Set([
  "private",
  "dependencies",
  "project"
]);
const TURN_ROLES = new Set(["user", "assistant", "tool"]);
const SOURCE_KINDS = new Set(["user", "model", "tool", "system"]);
const UNAVAILABLE_MODEL_STATUSES = new Set([
  "disabled",
  "offline",
  "unavailable"
]);
const DEFAULT_CONTEXT_CHARACTERS = 64000;
const CONTEXT_WINDOW_CHARACTER_RATIO = 4;
const CONTEXT_INPUT_SHARE = 0.65;

export class AnnaProjectWorkspace {
  constructor({
    now = () => new Date(),
    idFactory = () => randomUUID(),
    models = []
  } = {}) {
    this.now = now;
    this.idFactory = idFactory;
    this.models = new Map();
    this.projects = new Map();

    this.registerModel({
      id: "anna-auto",
      label: "Anna 自动选择",
      provider: "anna-host",
      capabilities: ["text", "vision", "audio", "tools", "code"],
      status: "host-managed"
    });
    for (const model of models) this.registerModel(model);
  }

  registerModel(profile) {
    const id = requiredText(profile?.id, "model.id");
    const capabilities = uniqueStrings(profile?.capabilities);
    if (capabilities.length === 0) {
      throw new Error(`model ${id} must declare at least one capability`);
    }
    const status = (optionalText(profile.status) || "available").toLowerCase();
    const normalized = {
      id,
      label: optionalText(profile.label) || id,
      provider: optionalText(profile.provider) || "unknown",
      capabilities,
      status,
      available: typeof profile.available === "boolean"
        ? profile.available
        : !UNAVAILABLE_MODEL_STATUSES.has(status),
      context_window: finitePositiveInteger(profile.context_window),
      registered_at: timestamp(this.now)
    };
    this.models.set(id, normalized);
    return clone(normalized);
  }

  listModels() {
    return [...this.models.values()].map(clone);
  }

  createProject({
    name,
    goal = "",
    instructions = "",
    sharingPolicy = "explicit_publish"
  }) {
    if (sharingPolicy !== "explicit_publish") {
      throw new Error(`unsupported sharing policy: ${sharingPolicy}`);
    }
    const at = timestamp(this.now);
    const project = {
      schema_version: 1,
      type: "anna.project",
      id: this.idFactory(),
      name: requiredText(name, "project.name"),
      goal: optionalText(goal),
      instructions: optionalText(instructions),
      sharing_policy: sharingPolicy,
      created_at: at,
      updated_at: at,
      revision: 1,
      subprojects: [],
      memories: [],
      artifacts: [],
      events: []
    };
    this.projects.set(project.id, project);
    this.record(project, "project.created", {
      project_id: project.id,
      name: project.name
    });
    return clone(project);
  }

  createSubproject({
    projectId,
    name,
    objective = "",
    modelId = "anna-auto",
    requiredCapabilities = ["text"],
    dependsOn = []
  }) {
    const project = this.project(projectId);
    const normalizedName = requiredText(name, "subproject.name");
    if (project.subprojects.some((item) => item.name === normalizedName)) {
      throw new Error(`subproject name already exists: ${normalizedName}`);
    }

    const dependencyIds = uniqueStrings(dependsOn);
    for (const dependencyId of dependencyIds) {
      this.subproject(project, dependencyId);
    }

    const at = timestamp(this.now);
    const binding = this.resolveModel(modelId, requiredCapabilities);
    const subproject = {
      id: this.idFactory(),
      name: normalizedName,
      objective: optionalText(objective),
      status: "active",
      depends_on: dependencyIds,
      model_binding: binding,
      model_history: [{ ...binding, bound_at: at }],
      turns: [],
      updated_revision: project.revision + 1,
      created_at: at,
      updated_at: at
    };
    project.subprojects.push(subproject);
    this.touch(project);
    this.record(project, "subproject.created", {
      subproject_id: subproject.id,
      name: subproject.name,
      model_binding: binding,
      depends_on: dependencyIds
    });
    return clone(subproject);
  }

  setDependencies({ projectId, subprojectId, dependsOn = [] }) {
    const project = this.project(projectId);
    const subproject = this.subproject(project, subprojectId);
    const dependencyIds = uniqueStrings(dependsOn);
    if (dependencyIds.includes(subproject.id)) {
      throw new Error("subproject cannot depend on itself");
    }
    for (const dependencyId of dependencyIds) {
      this.subproject(project, dependencyId);
    }

    const previous = subproject.depends_on;
    subproject.depends_on = dependencyIds;
    try {
      this.assertAcyclic(project);
    } catch (error) {
      subproject.depends_on = previous;
      throw error;
    }

    const at = timestamp(this.now);
    subproject.updated_at = at;
    subproject.updated_revision = project.revision + 1;
    this.touch(project);
    this.record(project, "subproject.dependencies_set", {
      subproject_id: subproject.id,
      depends_on: dependencyIds
    });
    return clone(subproject);
  }

  bindModel({
    projectId,
    subprojectId,
    modelId,
    requiredCapabilities = ["text"]
  }) {
    const project = this.project(projectId);
    const subproject = this.subproject(project, subprojectId);
    const binding = this.resolveModel(modelId, requiredCapabilities);
    const at = timestamp(this.now);
    subproject.model_binding = binding;
    subproject.model_history.push({ ...binding, bound_at: at });
    subproject.updated_at = at;
    subproject.updated_revision = project.revision + 1;
    this.touch(project);
    this.record(project, "subproject.model_bound", {
      subproject_id: subproject.id,
      model_binding: binding
    });
    return clone(binding);
  }

  appendTurn({
    projectId,
    subprojectId,
    role,
    content,
    modelId = null,
    attachments = []
  }) {
    const project = this.project(projectId);
    const subproject = this.subproject(project, subprojectId);
    if (!TURN_ROLES.has(role)) throw new Error(`unsupported turn role: ${role}`);
    const turnModelId = role === "assistant"
      ? optionalText(modelId) || subproject.model_binding.selected_model_id
      : null;
    if (turnModelId) this.assertBoundModel(subproject, turnModelId);
    const at = timestamp(this.now);
    const turn = {
      id: this.idFactory(),
      role,
      content: requiredText(content, "turn.content"),
      model_id: turnModelId,
      attachments: normalizeAttachments(attachments),
      updated_revision: project.revision + 1,
      created_at: at
    };
    subproject.turns.push(turn);
    subproject.updated_at = at;
    subproject.updated_revision = project.revision + 1;
    this.touch(project);
    return clone(turn);
  }

  addMemory({
    projectId,
    subprojectId = null,
    kind = "note",
    title,
    content,
    scope = "subproject",
    state = null,
    source = { kind: "user" },
    approvedBy = null
  }) {
    const project = this.project(projectId);
    if (!MEMORY_KINDS.has(kind)) throw new Error(`unsupported memory kind: ${kind}`);
    if (!MEMORY_SCOPES.has(scope)) throw new Error(`unsupported memory scope: ${scope}`);
    if (scope === "subproject" && !subprojectId) {
      throw new Error("subproject memory requires subprojectId");
    }
    if (subprojectId) this.subproject(project, subprojectId);

    const owner = subprojectId ? this.subproject(project, subprojectId) : null;
    const normalizedSource = this.normalizeSource(source, owner);
    const normalizedState = state || (normalizedSource.kind === "user" ? "confirmed" : "proposed");
    if (!MEMORY_STATES.has(normalizedState)) {
      throw new Error(`unsupported memory state: ${normalizedState}`);
    }
    if (
      scope === "project" &&
      normalizedState === "confirmed" &&
      normalizedSource.kind !== "user" &&
      approvedBy !== "user"
    ) {
      throw new Error("confirmed model or tool memory requires user approval before project sharing");
    }

    const at = timestamp(this.now);
    const memory = {
      id: this.idFactory(),
      subproject_id: subprojectId,
      kind,
      title: requiredText(title, "memory.title"),
      content: requiredText(content, "memory.content"),
      scope,
      state: normalizedState,
      source: normalizedSource,
      approved_by: approvedBy,
      updated_revision: project.revision + 1,
      created_at: at,
      updated_at: at
    };
    project.memories.push(memory);
    this.touch(project);
    this.record(project, "memory.added", {
      memory_id: memory.id,
      subproject_id: subprojectId,
      scope,
      state: normalizedState
    });
    return clone(memory);
  }

  promoteMemory({ projectId, memoryId, approvedBy }) {
    if (approvedBy !== "user") {
      throw new Error("project memory promotion requires explicit user approval");
    }
    const project = this.project(projectId);
    const memory = project.memories.find((item) => item.id === memoryId);
    if (!memory) throw new Error(`memory not found: ${memoryId}`);
    const at = timestamp(this.now);
    memory.scope = "project";
    memory.state = "confirmed";
    memory.approved_by = "user";
    memory.updated_at = at;
    memory.updated_revision = project.revision + 1;
    this.touch(project);
    this.record(project, "memory.promoted", {
      memory_id: memory.id,
      from_subproject_id: memory.subproject_id
    });
    return clone(memory);
  }

  addArtifact({
    projectId,
    subprojectId,
    name,
    summary,
    mediaType = "application/octet-stream",
    uri = null,
    contentHash = null,
    visibility = "private",
    source = { kind: "model" },
    approvedBy = null
  }) {
    const project = this.project(projectId);
    const owner = this.subproject(project, subprojectId);
    if (!ARTIFACT_VISIBILITY.has(visibility)) {
      throw new Error(`unsupported artifact visibility: ${visibility}`);
    }
    const artifactSource = this.normalizeSource(source, owner);
    if (
      visibility !== "private" &&
      artifactSource.kind !== "user" &&
      approvedBy !== "user"
    ) {
      throw new Error("sharing model or tool artifacts requires explicit user approval");
    }
    const at = timestamp(this.now);
    const artifact = {
      id: this.idFactory(),
      subproject_id: subprojectId,
      name: requiredText(name, "artifact.name"),
      summary: requiredText(summary, "artifact.summary"),
      media_type: optionalText(mediaType) || "application/octet-stream",
      uri: optionalText(uri),
      content_hash: optionalText(contentHash),
      visibility,
      source: artifactSource,
      approved_by: approvedBy,
      updated_revision: project.revision + 1,
      created_at: at,
      updated_at: at
    };
    project.artifacts.push(artifact);
    this.touch(project);
    this.record(project, "artifact.added", {
      artifact_id: artifact.id,
      subproject_id: subprojectId,
      visibility
    });
    return clone(artifact);
  }

  publishArtifact({
    projectId,
    artifactId,
    visibility = "dependencies",
    approvedBy
  }) {
    if (approvedBy !== "user") {
      throw new Error("artifact publication requires explicit user approval");
    }
    if (!["dependencies", "project"].includes(visibility)) {
      throw new Error("published artifact visibility must be dependencies or project");
    }
    const project = this.project(projectId);
    const artifact = project.artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new Error(`artifact not found: ${artifactId}`);
    const at = timestamp(this.now);
    artifact.visibility = visibility;
    artifact.approved_by = "user";
    artifact.updated_at = at;
    artifact.updated_revision = project.revision + 1;
    this.touch(project);
    this.record(project, "artifact.published", {
      artifact_id: artifact.id,
      visibility
    });
    return clone(artifact);
  }

  compileContext({
    projectId,
    subprojectId,
    task = "",
    includeProposedMemory = false,
    maxMemoryItems = 20,
    maxArtifacts = 20,
    maxTurns = 12,
    maxItemCharacters = 4000,
    maxContextCharacters = null
  }) {
    const project = this.project(projectId);
    const subproject = this.subproject(project, subprojectId);
    this.assertAcyclic(project);
    const dependencyIds = this.dependencyClosure(project, subproject);
    const contentBudget = createCharacterBudget(
      contextCharacterLimit(subproject.model_binding, maxContextCharacters)
    );
    const normalizedTask = contentBudget.take(task, maxItemCharacters);
    const projectInstructions = contentBudget.take(
      project.instructions,
      maxItemCharacters
    );
    const projectGoal = contentBudget.take(project.goal, maxItemCharacters);
    const subprojectObjective = contentBudget.take(
      subproject.objective,
      maxItemCharacters
    );

    const memoryCandidates = project.memories
      .filter((memory) => includeProposedMemory || memory.state === "confirmed")
      .filter((memory) =>
        memory.scope === "project" || memory.subproject_id === subproject.id
      )
      .sort(newestFirst);

    const artifactCandidates = project.artifacts
      .filter((artifact) => {
        if (artifact.subproject_id === subproject.id) return true;
        if (artifact.visibility === "project") return true;
        return artifact.visibility === "dependencies" &&
          dependencyIds.has(artifact.subproject_id);
      })
      .sort(newestFirst);

    const allTurnCandidates = [...subproject.turns].sort(newestFirst);
    const turnCandidates = allTurnCandidates.slice(0, limit(maxTurns, 12));
    const artifacts = takeItems(artifactCandidates, "summary", contentBudget, {
      limit: maxArtifacts,
      maxItemCharacters
    });
    const memories = takeItems(memoryCandidates, "content", contentBudget, {
      limit: maxMemoryItems,
      maxItemCharacters
    });
    const turns = takeItems(turnCandidates, "content", contentBudget, {
      limit: maxTurns,
      maxItemCharacters
    }).reverse();

    return {
      schema_version: 1,
      type: "anna.context-package",
      compiled_at: timestamp(this.now),
      project: {
        id: project.id,
        name: project.name,
        goal: projectGoal,
        instructions: projectInstructions,
        revision: project.revision,
        sharing_policy: project.sharing_policy
      },
      subproject: {
        id: subproject.id,
        name: subproject.name,
        objective: subprojectObjective,
        status: subproject.status,
        depends_on: [...subproject.depends_on]
      },
      task: normalizedTask,
      model_execution: {
        ...clone(subproject.model_binding),
        host_must_revalidate_capabilities: true
      },
      shared_memory: memories,
      dependency_artifacts: artifacts,
      current_thread: turns,
      context_budget: {
        unit: "characters",
        maximum: contentBudget.maximum,
        used: contentBudget.used,
        remaining: contentBudget.remaining(),
        truncated: contentBudget.truncated,
        omitted: {
          memories: Math.max(0, memoryCandidates.length - memories.length),
          artifacts: Math.max(0, artifactCandidates.length - artifacts.length),
          turns: Math.max(0, allTurnCandidates.length - turns.length)
        }
      },
      context_policy: {
        instruction_precedence: [
          "anna_system_policy",
          "project.instructions",
          "current_user_task"
        ],
        linked_content_role: "reference_data",
        embedded_instructions_in_memory_or_artifacts: "untrusted",
        raw_cross_subproject_chat_shared: false,
        model_outputs_become_shared_facts_automatically: false,
        content_budget_priority: [
          "current_task",
          "project_rules",
          "dependency_artifacts",
          "shared_memory",
          "current_thread"
        ]
      }
    };
  }

  exportProject(projectId) {
    return clone(this.project(projectId));
  }

  resolveModel(modelId, requiredCapabilities = ["text"]) {
    const requestedModelId = requiredText(modelId || "anna-auto", "modelId");
    const required = uniqueStrings(requiredCapabilities);
    if (required.length === 0) required.push("text");
    const requested = this.models.get(requestedModelId);
    const available = requested?.available === true;
    const hasCapabilities = requested &&
      required.every((capability) => requested.capabilities.includes(capability));
    const fits = available && hasCapabilities;
    const selected = fits ? requested : this.models.get("anna-auto");
    return {
      requested_model_id: requestedModelId,
      selected_model_id: selected.id,
      required_capabilities: required,
      fallback_used: !fits,
      fallback_reason: fits
        ? null
        : !requested
          ? "requested model is not present in the Anna host registry"
          : !available
            ? `requested model is unavailable: ${requested.status}`
            : `requested model lacks confirmed capabilities: ${required.join(", ")}`,
      selected_profile: {
        label: selected.label,
        provider: selected.provider,
        capabilities: [...selected.capabilities],
        status: selected.status,
        available: selected.available,
        context_window: selected.context_window
      }
    };
  }

  dependencyClosure(project, subproject) {
    const result = new Set();
    const pending = [...subproject.depends_on];
    while (pending.length > 0) {
      const id = pending.pop();
      if (result.has(id)) continue;
      result.add(id);
      const dependency = this.subproject(project, id);
      pending.push(...dependency.depends_on);
    }
    return result;
  }

  assertAcyclic(project) {
    const visiting = new Set();
    const visited = new Set();
    const visit = (subproject) => {
      if (visiting.has(subproject.id)) {
        throw new Error(`dependency cycle detected at subproject: ${subproject.id}`);
      }
      if (visited.has(subproject.id)) return;
      visiting.add(subproject.id);
      for (const dependencyId of subproject.depends_on) {
        visit(this.subproject(project, dependencyId));
      }
      visiting.delete(subproject.id);
      visited.add(subproject.id);
    };
    for (const subproject of project.subprojects) visit(subproject);
  }

  assertBoundModel(subproject, modelId) {
    if (!this.models.has(modelId)) {
      throw new Error(`source model is not registered: ${modelId}`);
    }
    const bound = subproject.model_history.some(
      (binding) => binding.selected_model_id === modelId
    );
    if (!bound) {
      throw new Error(`source model was not bound to subproject: ${modelId}`);
    }
  }

  normalizeSource(source, subproject) {
    const kind = source?.kind || "user";
    if (!SOURCE_KINDS.has(kind)) throw new Error(`unsupported source kind: ${kind}`);
    let modelId = optionalText(source?.model_id);
    const toolId = optionalText(source?.tool_id);
    if (kind === "model") {
      if (!subproject) throw new Error("model source requires a subproject");
      modelId ||= subproject.model_binding.selected_model_id;
      this.assertBoundModel(subproject, modelId);
    }
    if (kind === "tool" && !toolId) {
      throw new Error("tool source requires tool_id");
    }
    return {
      kind,
      model_id: modelId,
      tool_id: toolId,
      subproject_id: subproject?.id || null
    };
  }

  project(projectId) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    return project;
  }

  subproject(project, subprojectId) {
    const subproject = project.subprojects.find((item) => item.id === subprojectId);
    if (!subproject) throw new Error(`subproject not found: ${subprojectId}`);
    return subproject;
  }

  touch(project) {
    project.updated_at = timestamp(this.now);
    project.revision += 1;
  }

  record(project, type, data) {
    project.events.push({
      id: this.idFactory(),
      type,
      data: clone(data),
      created_at: timestamp(this.now)
    });
  }
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.slice(0, 12).map((attachment, index) => ({
    id: optionalText(attachment?.id) || `attachment-${index + 1}`,
    name: optionalText(attachment?.name) || `附件 ${index + 1}`,
    media_type: optionalText(attachment?.media_type || attachment?.type) ||
      "application/octet-stream",
    uri: optionalText(attachment?.uri),
    size: Number.isFinite(Number(attachment?.size))
      ? Math.max(0, Number(attachment.size))
      : 0
  }));
}

function requiredText(value, field) {
  const normalized = optionalText(value);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(optionalText).filter(Boolean))];
}

function finitePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function limit(value, fallback) {
  return finitePositiveInteger(value) || fallback;
}

function timestamp(now) {
  return now().toISOString();
}

function newestFirst(a, b) {
  const revisionDifference =
    Number(b.updated_revision || 0) - Number(a.updated_revision || 0);
  return revisionDifference || b.updated_at.localeCompare(a.updated_at);
}

function contextCharacterLimit(binding, explicitMaximum) {
  const explicit = finitePositiveInteger(explicitMaximum);
  if (explicit) return explicit;
  const contextWindow = binding?.selected_profile?.context_window;
  if (!contextWindow) return DEFAULT_CONTEXT_CHARACTERS;
  return Math.max(
    256,
    Math.floor(
      contextWindow *
      CONTEXT_WINDOW_CHARACTER_RATIO *
      CONTEXT_INPUT_SHARE
    )
  );
}

function createCharacterBudget(maximum) {
  let used = 0;
  let truncated = false;
  return {
    maximum,
    get used() {
      return used;
    },
    get truncated() {
      return truncated;
    },
    remaining() {
      return Math.max(0, maximum - used);
    },
    take(value, maxItemCharacters) {
      const text = optionalText(value);
      if (!text) return null;
      const available = this.remaining();
      if (available === 0) {
        truncated = true;
        return null;
      }
      const itemMaximum = Math.min(
        available,
        limit(maxItemCharacters, 4000)
      );
      const result = clipTo(text, itemMaximum);
      used += result.length;
      if (result !== text) truncated = true;
      return result;
    }
  };
}

function takeItems(items, field, budget, {
  limit: itemLimit,
  maxItemCharacters
}) {
  const output = [];
  for (const item of items.slice(0, limit(itemLimit, 20))) {
    const content = budget.take(item[field], maxItemCharacters);
    if (!content) continue;
    output.push({
      ...clone(item),
      [field]: content
    });
  }
  return output;
}

function clipTo(text, maximum) {
  if (text.length <= maximum) return text;
  const marker = "\n[已截断]";
  if (maximum <= marker.length) return text.slice(0, maximum);
  return `${text.slice(0, maximum - marker.length)}${marker}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
