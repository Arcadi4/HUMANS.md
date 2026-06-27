/**
 * The installer: applies or removes the HUMANS.md deny rule for one agent
 * at a given scope.
 *
 * Pipeline:
 *   1. Resolve the agent's config path for the requested scope.
 *   2. Special-case cursor (writes a `.cursorignore` line, not config).
 *   3. Otherwise: read existing config, apply transform, write back.
 *   4. Report an {@link AgentResult} describing what happened.
 *
 * Antigravity and gemini-cli have no project-tier config; the installer
 * returns a `skipped` result for them at project scope.
 *
 * All operations are idempotent: running `apply` twice produces the same
 * on-disk state as running it once; `remove` undoes exactly what `apply` did.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAgent, makeContext, resolveAgentPath } from "./agents.ts";
import { cursorIgnoreLine } from "./rules.ts";
import { getFormat, type WriteOptions } from "./formats/index.ts";
import type {
  AgentConfig,
  AgentResult,
  AgentType,
  ParsedConfig,
  RuleContext,
  Scope,
} from "./types.ts";

export interface InstallOptions {
  scope: Scope;
  // Absolute path to the project root.
  cwd: string;
  // HUMANS.md path relative to cwd. Default: `HUMANS.md`.
  humansMdRelPath?: string;
  // Marker tag for finding our own rule later. Default: `humansmd`.
  marker?: string;
}

// Build the rule context from install options.
function buildContext(opts: InstallOptions): RuleContext {
  return makeContext({
    projectRoot: opts.cwd,
    humansMdRelPath: opts.humansMdRelPath ?? "HUMANS.md",
    scope: opts.scope,
    marker: opts.marker,
  });
}

function writeOptsFor(agent: AgentConfig): WriteOptions | undefined {
  return agent.ruleKeyHint ? { configKey: agent.ruleKeyHint } : undefined;
}

/**
 * Apply the HUMANS.md deny rule for one agent. Returns a description of the
 * outcome; never throws (errors are surfaced via {@link AgentResult.error}).
 */
export function applyRuleForAgent(type: AgentType, opts: InstallOptions): AgentResult {
  const agent = getAgent(type);
  const ctx = buildContext(opts);
  const base: Omit<AgentResult, "action" | "message" | "error"> = {
    agent: type,
    success: true,
    scope: opts.scope,
    path: "",
  };

  if (type === "cursor") {
    return applyCursorIgnore(opts, ctx, base);
  }

  if (opts.scope === "project" && agent.projectConfigPath === undefined) {
    return {
      ...base,
      path: "",
      action: "skipped",
      success: true,
      message: `${agent.displayName} does not support project-scope config. Use --global. Skipped.`,
    };
  }

  let configPath: string;
  try {
    configPath = resolveAgentPath(type, opts.scope, opts.cwd);
  } catch (err) {
    return {
      ...base,
      path: "",
      action: "skipped",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      message: `${agent.displayName}: could not resolve config path.`,
    };
  }

  const adapter = getFormat(agent.format);

  try {
    const existing = adapter.read(configPath);

    if (agent.hasDenyRule(existing, ctx)) {
      return {
        ...base,
        path: configPath,
        action: "noop",
        message: `${agent.displayName}: rule already present in ${configPath}.`,
      };
    }

    const next = agent.applyDenyRule(existing, ctx);
    adapter.write(configPath, next, writeOptsFor(agent));

    return {
      ...base,
      path: configPath,
      action: "wrote",
      message: codexSuccessMessage(type, agent.displayName, configPath, opts.scope),
    };
  } catch (err) {
    return {
      ...base,
      path: configPath,
      action: "skipped",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      message: `${agent.displayName}: failed to write ${configPath}.`,
    };
  }
}

/**
 * Remove the HUMANS.md deny rule for one agent. Symmetric with
 * {@link applyRuleForAgent}.
 */
export function removeRuleForAgent(type: AgentType, opts: InstallOptions): AgentResult {
  const agent = getAgent(type);
  const ctx = buildContext(opts);
  const base: Omit<AgentResult, "action" | "message" | "error"> = {
    agent: type,
    success: true,
    scope: opts.scope,
    path: "",
  };

  if (type === "cursor") {
    return removeCursorIgnore(opts, base);
  }

  if (opts.scope === "project" && agent.projectConfigPath === undefined) {
    return {
      ...base,
      path: "",
      action: "skipped",
      success: true,
      message: `${agent.displayName} does not support project-scope config.`,
    };
  }

  let configPath: string;
  try {
    configPath = resolveAgentPath(type, opts.scope, opts.cwd);
  } catch (err) {
    return {
      ...base,
      path: "",
      action: "skipped",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      message: `${agent.displayName}: could not resolve config path.`,
    };
  }

  const adapter = getFormat(agent.format);

  if (!existsSync(configPath)) {
    return {
      ...base,
      path: configPath,
      action: "noop",
      message: `${agent.displayName}: config not found at ${configPath}. Nothing to remove.`,
    };
  }

  try {
    const existing = adapter.read(configPath);
    if (!agent.hasDenyRule(existing, ctx)) {
      return {
        ...base,
        path: configPath,
        action: "noop",
        message: `${agent.displayName}: no humansmd rule present in ${configPath}.`,
      };
    }
    const next = agent.removeDenyRule(existing, ctx);
    adapter.write(configPath, next, writeOptsFor(agent));
    return {
      ...base,
      path: configPath,
      action: "removed",
      message: `${agent.displayName}: removed rule from ${configPath}.`,
    };
  } catch (err) {
    return {
      ...base,
      path: configPath,
      action: "skipped",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      message: `${agent.displayName}: failed to remove from ${configPath}.`,
    };
  }
}

// --- Cursor special-case ----------------------------------------------------

// Path to `.cursorignore` relative to cwd.
const CURSOR_IGNORE_REL = ".cursorignore";

// Append HUMANS.md line to `.cursorignore`, creating the file if needed.
function applyCursorIgnore(
  opts: InstallOptions,
  ctx: RuleContext,
  base: Omit<AgentResult, "action" | "message" | "error">,
): AgentResult {
  const path = join(opts.cwd, CURSOR_IGNORE_REL);
  try {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    const line = cursorIgnoreLine(ctx);
    const lines = existing.split("\n").map((l) => l.trim());
    if (lines.includes(line)) {
      return {
        ...base,
        path,
        action: "noop",
        message: `Cursor: ${CURSOR_IGNORE_REL} already lists ${line}.`,
      };
    }
    const next = existing.endsWith("\n") || existing === "" ? existing : `${existing}\n`;
    writeFileSync(path, `${next}${line}\n`, "utf8");
    return {
      ...base,
      path,
      action: "wrote",
      message: `Cursor: added ${line} to ${CURSOR_IGNORE_REL}.`,
    };
  } catch (err) {
    return {
      ...base,
      path,
      action: "skipped",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      message: `Cursor: failed to write ${CURSOR_IGNORE_REL}.`,
    };
  }
}

// Remove HUMANS.md line from `.cursorignore` if present.
function removeCursorIgnore(
  opts: InstallOptions,
  base: Omit<AgentResult, "action" | "message" | "error">,
): AgentResult {
  const path = join(opts.cwd, CURSOR_IGNORE_REL);
  if (!existsSync(path)) {
    return {
      ...base,
      path,
      action: "noop",
      message: `Cursor: ${CURSOR_IGNORE_REL} not found. Nothing to remove.`,
    };
  }
  try {
    const existing = readFileSync(path, "utf8");
    const before = existing.split("\n");
    // Match by exact line OR by marker tag.
    const after = before.filter((l) => l.trim() !== "HUMANS.md");
    if (after.length === before.length) {
      return {
        ...base,
        path,
        action: "noop",
        message: `Cursor: no humansmd entry in ${CURSOR_IGNORE_REL}.`,
      };
    }
    writeFileSync(path, after.join("\n"), "utf8");
    return {
      ...base,
      path,
      action: "removed",
      message: `Cursor: removed entry from ${CURSOR_IGNORE_REL}.`,
    };
  } catch (err) {
    return {
      ...base,
      path,
      action: "skipped",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      message: `Cursor: failed to update ${CURSOR_IGNORE_REL}.`,
    };
  }
}

// --- Helpers ----------------------------------------------------------------

/**
 * Codex needs an extra hint: the profile we wrote is opt-in. Tell the user
 * to set `default_permissions = "humansmd"` themselves.
 */
function codexSuccessMessage(
  type: AgentType,
  displayName: string,
  path: string,
  scope: Scope,
): string {
  if (type !== "codex") {
    return `${displayName}: wrote rule to ${path}.`;
  }
  const where = scope === "project" ? "project" : "global";
  return [
    `${displayName}: wrote permissions profile "humansmd" to ${path}.`,
    `  To activate: set [default_permissions = "humansmd"] in your ${where} config.toml.`,
    `  Note: this replaces \`sandbox_mode\`. Remove the profile with \`humansmd remove\`.`,
  ].join("\n");
}

// Re-export for tests / external callers.
export function buildResultSummary(results: readonly AgentResult[]): {
  applied: number;
  removed: number;
  skipped: number;
  noop: number;
  failed: number;
} {
  let applied = 0;
  let removed = 0;
  let skipped = 0;
  let noop = 0;
  let failed = 0;
  for (const r of results) {
    if (!r.success) {
      failed += 1;
      continue;
    }
    if (r.action === "wrote") applied += 1;
    else if (r.action === "removed") removed += 1;
    else if (r.action === "skipped") skipped += 1;
    else if (r.action === "noop") noop += 1;
  }
  return { applied, removed, skipped, noop, failed };
}

// Read an existing config without modifying it. Returns null if missing.
export function peekConfig(type: AgentType, scope: Scope, cwd: string): ParsedConfig | null {
  const agent = getAgent(type);
  const path = resolveAgentPath(type, scope, cwd);
  if (!existsSync(path)) return null;
  return getFormat(agent.format).read(path);
}
