import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const definitions = [
  {
    slug: "private-travel-agent",
    project: "04-travel-agent-anna-app",
    accent: "#ff7a59",
    summary: "匿名行程、PII 拒绝与付款人工门禁",
    executas: {
      "travel-agent": {
        directory: "executas/travel-agent-node",
        entry: "travel_agent_plugin.cjs"
      }
    }
  },
  {
    slug: "personal-assistant-mode",
    project: "08-personal-assistant-anna-app",
    accent: "#7cc8ff",
    summary: "能力路由、环境信息与会话级健康授权",
    executas: {
      "personal-assistant": {
        directory: "executas/personal-assistant-node",
        entry: "personal_assistant_plugin.cjs"
      }
    }
  }
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadAppRegistry() {
  const apps = new Map();
  const tools = new Map();

  for (const definition of definitions) {
    const projectDir = path.join(projectRoot, definition.project);
    const manifest = readJson(path.join(projectDir, "manifest.json"));
    const listing = readJson(path.join(projectDir, "app.json"));
    const toolIds = {};
    const toolAliases = new Map();

    for (const [alias, spec] of Object.entries(definition.executas)) {
      const executaDir = path.join(projectDir, spec.directory);
      const executa = readJson(path.join(executaDir, "executa.json"));
      const entry = path.join(executaDir, spec.entry);
      const tool = {
        alias,
        appSlug: definition.slug,
        toolId: executa.tool_id,
        entry,
        directory: executaDir,
        environment: definition.environment
      };
      toolIds[alias] = tool.toolId;
      toolAliases.set(alias, tool.toolId);
      tools.set(tool.toolId, tool);
    }

    const requiredAliases = new Set(
      manifest.required_executas
        .map(({ tool_id: toolId }) => toolId.startsWith("bundled:")
          ? toolId.slice("bundled:".length)
          : null)
        .filter(Boolean)
    );
    const allowedToolIds = new Set(
      [...requiredAliases].map((alias) => toolAliases.get(alias)).filter(Boolean)
    );

    apps.set(definition.slug, {
      slug: definition.slug,
      name: listing.name,
      version: listing.version,
      summary: definition.summary,
      accent: definition.accent,
      projectDir,
      bundleDir: path.join(projectDir, "bundle"),
      manifest,
      listing,
      toolIds,
      allowedToolIds
    });
  }

  return { apps, tools, projectRoot };
}
