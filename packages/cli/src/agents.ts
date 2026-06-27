/**
 * Agent registry: static metadata describing how to find, write to, and
 * remove from each supported agent.
 *
 * Only agents that expose a native read-deny mechanism are listed here.
 * Antigravity and gemini-cli are global-only (their project tier is either
 * absent or broken upstream); the installer skips them at project scope with
 * a clear message rather than fabricating a rule.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { expandTilde } from "./paths.ts";
import {
  applyAntigravity,
  applyClaudeCode,
  applyCodex,
  applyCursor,
  applyGeminiCli,
  applyOpencode,
  applyZed,
  hasAntigravity,
  hasClaudeCode,
  hasCodex,
  hasCursor,
  hasGeminiCli,
  hasOpencode,
  hasZed,
  removeAntigravity,
  removeClaudeCode,
  removeCodex,
  removeCursor,
  removeGeminiCli,
  removeOpencode,
  removeZed,
} from "./rules.ts";
import type { AgentConfig, AgentType, ParsedConfig, RuleContext } from "./types.ts";

// Returns true if any of `paths` exists inside `dir`.
function anyExists(dir: string, paths: string[]): boolean {
  return paths.some((p) => existsSync(join(dir, p)));
}

const claudeCode: AgentConfig = {
  type: "claude",
  displayName: "Claude Code",
  globalConfigPath: "~/.claude/settings.json",
  projectConfigPath: ".claude/settings.json",
  projectDetectPaths: [".claude", ".mcp.json", "CLAUDE.md"],
  globalDetectPath: "~/.claude",
  format: "json",
  ruleKeyHint: "permissions.deny",
  applyDenyRule: applyClaudeCode,
  removeDenyRule: removeClaudeCode,
  hasDenyRule: hasClaudeCode,
};

// Writes a custom `humansmd` permission profile. We do NOT set
// `default_permissions` — the user must opt in to avoid clobbering
// `sandbox_mode`. The installer reports this clearly.
const codex: AgentConfig = {
  type: "codex",
  displayName: "Codex",
  globalConfigPath: "~/.codex/config.toml",
  projectConfigPath: ".codex/config.toml",
  projectDetectPaths: [".codex", "AGENTS.md"],
  globalDetectPath: "~/.codex",
  format: "toml",
  ruleKeyHint: "permissions.humansmd",
  applyDenyRule: applyCodex,
  removeDenyRule: removeCodex,
  hasDenyRule: hasCodex,
};

// The rule is a single line in `.cursorignore` (project scope only).
// The installer handles cursor via a dedicated file writer; the registry
// entry exists so detection and the multiselect flow include it.
const cursor: AgentConfig = {
  type: "cursor",
  displayName: "Cursor",
  globalConfigPath: "~/.cursor/mcp.json",
  projectConfigPath: ".cursorignore",
  projectDetectPaths: [".cursor", ".cursorignore"],
  globalDetectPath: "~/.cursor",
  format: "json",
  applyDenyRule: applyCursor,
  removeDenyRule: removeCursor,
  hasDenyRule: hasCursor,
};

// Workspace tier is broken upstream (gemini-cli#18186); user-tier only.
// The policies file is namespaced under ~/.gemini/policies/<name>.toml.
const geminiCli: AgentConfig = {
  type: "gemini-cli",
  displayName: "Gemini CLI",
  globalConfigPath: "~/.gemini/policies/humansmd.toml",
  globalDetectPath: "~/.gemini",
  projectDetectPaths: [".gemini"],
  format: "toml",
  ruleKeyHint: "rule",
  applyDenyRule: applyGeminiCli,
  removeDenyRule: removeGeminiCli,
  hasDenyRule: hasGeminiCli,
};

const opencode: AgentConfig = {
  type: "opencode",
  displayName: "OpenCode",
  globalConfigPath: "~/.config/opencode/opencode.json",
  projectConfigPath: "opencode.json",
  projectDetectPaths: ["opencode.json", ".opencode"],
  globalDetectPath: "~/.config/opencode",
  format: "json",
  ruleKeyHint: "permission.read",
  applyDenyRule: applyOpencode,
  removeDenyRule: removeOpencode,
  hasDenyRule: hasOpencode,
};

const zed: AgentConfig = {
  type: "zed",
  displayName: "Zed",
  globalConfigPath: "~/Library/Application Support/Zed/settings.json",
  projectConfigPath: ".zed/settings.json",
  projectDetectPaths: [".zed"],
  globalDetectPath: "~/Library/Application Support/Zed",
  format: "json",
  ruleKeyHint: "agent.tool_permissions.tools",
  applyDenyRule: applyZed,
  removeDenyRule: removeZed,
  hasDenyRule: hasZed,
};

// Project-level config not supported; global only.
const antigravity: AgentConfig = {
  type: "antigravity",
  displayName: "Antigravity",
  globalConfigPath: "~/.gemini/antigravity-cli/settings.json",
  globalDetectPath: "~/.gemini/antigravity-cli",
  projectDetectPaths: [],
  format: "json",
  ruleKeyHint: "permissions.deny",
  applyDenyRule: applyAntigravity,
  removeDenyRule: removeAntigravity,
  hasDenyRule: hasAntigravity,
};

/**
 * All agents, keyed by type. The order is presentation order in prompts.
 */
export const agents: Record<AgentType, AgentConfig> = {
  claude: claudeCode,
  codex,
  opencode,
  cursor,
  "gemini-cli": geminiCli,
  zed,
  antigravity,
};

// Ordered list of agent types (presentation order).
export const agentOrder: AgentType[] = [
  "claude",
  "codex",
  "opencode",
  "cursor",
  "gemini-cli",
  "zed",
  "antigravity",
];

// Returns metadata for a single agent type.
export function getAgent(type: AgentType): AgentConfig {
  const cfg = agents[type];
  if (!cfg) {
    throw new Error(`Unknown agent type: ${type}`);
  }
  return cfg;
}

// Returns all agent types in presentation order.
export function getAgentTypes(): AgentType[] {
  return agentOrder;
}

// Returns true if this agent supports project-scope rules.
export function supportsProjectConfig(type: AgentType): boolean {
  return agents[type]?.projectConfigPath !== undefined;
}

// Returns agents that support project-scope rules.
export function getProjectCapableAgents(): AgentType[] {
  return agentOrder.filter((t) => supportsProjectConfig(t));
}

// Returns true if the agent's project marker is present in `cwd`.
export function detectProjectAgent(cwd: string, type: AgentType): boolean {
  const cfg = agents[type];
  if (!cfg || cfg.projectDetectPaths.length === 0) return false;
  return anyExists(cwd, cfg.projectDetectPaths);
}

// Returns agent types detected as active in `cwd`.
export function detectProjectAgents(cwd: string): AgentType[] {
  return agentOrder.filter((t) => detectProjectAgent(cwd, t));
}

// Returns true if the agent's global marker is present in `$HOME`.
export function detectGlobalAgent(type: AgentType): boolean {
  const cfg = agents[type];
  if (!cfg) return false;
  return existsSync(expandTilde(cfg.globalDetectPath));
}

// Returns agent types detected as installed globally.
export function detectGlobalAgents(): AgentType[] {
  return agentOrder.filter((t) => detectGlobalAgent(t));
}

// Resolve the OS-specific path for an agent's config in a given scope.
export function resolveAgentPath(
  type: AgentType,
  scope: "project" | "global",
  cwd: string,
): string {
  const cfg = agents[type]!;
  if (scope === "project") {
    const rel = cfg.projectConfigPath;
    if (!rel) {
      throw new Error(`${cfg.displayName} does not support project-scope config`);
    }
    return join(cwd, rel);
  }
  return expandTilde(cfg.globalConfigPath);
}

// Build a fresh RuleContext.
export function makeContext(params: {
  projectRoot: string;
  humansMdRelPath: string;
  scope: "project" | "global";
  marker?: string | undefined;
}): RuleContext {
  return {
    projectRoot: params.projectRoot,
    humansMdRelPath: params.humansMdRelPath,
    scope: params.scope,
    marker: params.marker ?? "humansmd",
  };
}

// Check whether a rule is present in a parsed config.
export function hasRule(type: AgentType, config: ParsedConfig, ctx: RuleContext): boolean {
  return agents[type]!.hasDenyRule(config, ctx);
}
