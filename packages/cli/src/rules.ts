/**
 * Per-agent rule transforms.
 *
 * Each function is a pure transformation on a parsed config object. They are
 * grouped here rather than inlined in `agents.ts` to keep the registry
 * declarative and make the rule syntax for each agent easy to audit.
 *
 * Conventions:
 *   - Each `apply*` is idempotent: applying twice == applying once.
 *   - Each `remove*` is the exact inverse of its `apply*`.
 *   - Each `has*` reports presence of the rule written by `apply*`.
 *
 * Identification is by the rule's own schema-valid content. We never inject
 * marker fields or sentinel keys, because many agents (opencode, zed, ...)
 * validate their config against a strict schema and would reject the file.
 */

import { deepClone, getArray, getPath, removeFromArray, setPath } from "./formats/index.ts";
import type { ParsedConfig, RuleContext } from "./types.ts";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ----------------------------------------------------------------------------
// claude
// ----------------------------------------------------------------------------

function claudeRuleEntry(ctx: RuleContext): string {
  return `Read(${ctx.humansMdRelPath})`;
}

export function applyClaudeCode(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const deny = getArray<string>(next, "permissions.deny");
  const entry = claudeRuleEntry(ctx);
  if (!deny.some((item) => item.trim() === entry)) {
    setPath(next, "permissions.deny", [...deny, entry]);
  }
  return next;
}

export function removeClaudeCode(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const deny = getArray<string>(next, "permissions.deny");
  const entry = claudeRuleEntry(ctx);
  setPath(
    next,
    "permissions.deny",
    deny.filter((item) => item.trim() !== entry),
  );
  return next;
}

export function hasClaudeCode(config: ParsedConfig, ctx: RuleContext): boolean {
  const deny = getArray<string>(config, "permissions.deny");
  const entry = claudeRuleEntry(ctx);
  return deny.some((item) => item.trim() === entry);
}

// ----------------------------------------------------------------------------
// opencode
// ----------------------------------------------------------------------------

/**
 * OpenCode permission.read shape:
 *   { permission: { read: { "./HUMANS.md": "deny" } } }
 *
 * Identified by the key's value being "deny" for the HUMANS.md path. We do
 * NOT inject a sibling marker key — opencode validates permission.read
 * values as "allow" | "deny", and any other key/value would be rejected.
 */
export function applyOpencode(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const readMap = (getPath(next, "permission.read") as Record<string, unknown> | undefined) ?? {};
  setPath(next, "permission.read", {
    ...readMap,
    [ctx.humansMdRelPath]: "deny",
  });
  return next;
}

export function removeOpencode(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const readMap = (getPath(next, "permission.read") as Record<string, unknown> | undefined) ?? {};
  const filtered = { ...readMap };
  delete filtered[ctx.humansMdRelPath];
  setPath(next, "permission.read", filtered);
  return next;
}

export function hasOpencode(config: ParsedConfig, ctx: RuleContext): boolean {
  const readMap = (getPath(config, "permission.read") as Record<string, unknown> | undefined) ?? {};
  return readMap[ctx.humansMdRelPath] === "deny";
}

// ----------------------------------------------------------------------------
// zed
// ----------------------------------------------------------------------------

/**
 * Zed agent.tool_permissions.tools.<tool>.always_deny[] entries. Zed's entry
 * schema is strictly { pattern: string, case_sensitive?: boolean }, so we do
 * NOT inject a `source` marker field.
 *
 * Note: as of Zed v0.224+, the documented tool names are edit_file,
 * write_file, delete_path, move_path, copy_path, create_directory, fetch,
 * search_web, skill — there is no `read_file` tool to deny. The rules below
 * cover the file-mutation tools that could leak HUMANS.md content via edits.
 *
 * Identification: any entry whose `pattern` matches the targeted HUMANS.md regex.
 */
function zedPatternFor(ctx: RuleContext): string {
  return `${escapeRegex(ctx.humansMdRelPath)}$`;
}

function zedMatchesHumansMd(pattern: unknown, ctx: RuleContext): boolean {
  return typeof pattern === "string" && pattern === zedPatternFor(ctx);
}

function zedToolNames(): string[] {
  return ["edit_file", "write_file", "delete_path", "move_path", "copy_path"];
}

export function applyZed(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  for (const tool of zedToolNames()) {
    const path = `agent.tool_permissions.tools.${tool}.always_deny`;
    const current = getArray<Record<string, unknown>>(next, path);
    if (!current.some((item) => zedMatchesHumansMd(item.pattern, ctx))) {
      setPath(next, path, [...current, { pattern: zedPatternFor(ctx) }]);
    }
  }
  return next;
}

export function removeZed(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  let next = config;
  for (const tool of zedToolNames()) {
    const path = `agent.tool_permissions.tools.${tool}.always_deny`;
    next = removeFromArray(next, path, (item: Record<string, unknown>) =>
      zedMatchesHumansMd(item.pattern, ctx),
    );
  }
  return next;
}

export function hasZed(config: ParsedConfig, ctx: RuleContext): boolean {
  for (const tool of zedToolNames()) {
    const path = `agent.tool_permissions.tools.${tool}.always_deny`;
    const current = getArray<Record<string, unknown>>(config, path);
    if (current.some((item) => zedMatchesHumansMd(item.pattern, ctx))) {
      return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------------------
// codex — TOML, custom permissions profile extending ":workspace"
// ----------------------------------------------------------------------------

/**
 * Codex beta permissions profile:
 *
 *   [permissions.humansmd]
 *   extends = ":workspace"
 *
 *   [permissions.humansmd.filesystem.":workspace_roots"]
 *   "HUMANS.md" = "deny"
 *
 * The user must opt into this profile by setting `default_permissions = "humansmd"`
 * themselves; we do NOT override their `sandbox_mode` automatically.
 *
 * Identification: the presence of the `permissions.humansmd` profile. Profile
 * names are user-defined so this is schema-valid.
 */
function codexProfileName(ctx: RuleContext): string {
  return ctx.marker;
}

export function applyCodex(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const profileName = codexProfileName(ctx);
  const perms = (getPath(next, "permissions") as Record<string, unknown> | undefined) ?? {};
  const profile = (perms[profileName] as Record<string, unknown> | undefined) ?? {};

  const nextProfile: Record<string, unknown> = {
    ...profile,
    extends: ":workspace",
  };

  const filesystem = (profile.filesystem as Record<string, unknown> | undefined) ?? {};
  const workspaceRoots =
    (filesystem[":workspace_roots"] as Record<string, unknown> | undefined) ?? {};

  nextProfile.filesystem = {
    ...filesystem,
    ":workspace_roots": {
      ...workspaceRoots,
      [ctx.humansMdRelPath]: "deny",
    },
  };

  setPath(next, `permissions.${profileName}`, nextProfile);
  return next;
}

export function removeCodex(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const perms = (getPath(next, "permissions") as Record<string, unknown> | undefined) ?? {};
  const filtered = { ...perms };
  delete filtered[codexProfileName(ctx)];
  if (Object.keys(filtered).length === 0) {
    const root = { ...next };
    delete root.permissions;
    return root;
  }
  setPath(next, "permissions", filtered);
  return next;
}

export function hasCodex(config: ParsedConfig, ctx: RuleContext): boolean {
  const perms = (getPath(config, "permissions") as Record<string, unknown> | undefined) ?? {};
  return codexProfileName(ctx) in perms;
}

// ----------------------------------------------------------------------------
// gemini-cli — TOML, user-tier only; one rule per read tool
// ----------------------------------------------------------------------------

/**
 * Gemini-cli policy rule (user-tier only):
 *
 *   [[rule]]
 *   toolName = "read_file"
 *   argsPattern = '"file_path":\s*"[^"]*HUMANS\.md"'
 *   decision = "deny"
 *   priority = 100
 *
 * The `[[rule]]` table accepts these four fields. We do NOT inject a `source`
 * marker field — gemini-cli's rule schema may reject unknown keys.
 *
 * Identification: an entry whose toolName is one of our read tools AND whose
 * argsPattern contains the escaped HUMANS.md path.
 */
function geminiArgsPatternFor(ctx: RuleContext): string {
  const escaped = escapeRegex(ctx.humansMdRelPath);
  return `"file_path":\\s*"[^"]*${escaped}"`;
}

function geminiReadTools(): string[] {
  return ["read_file", "read_many_files"];
}

function geminiIsOurRule(item: Record<string, unknown>, ctx: RuleContext): boolean {
  const toolName = String(item.toolName ?? "");
  if (!geminiReadTools().includes(toolName)) return false;
  const argsPattern = String(item.argsPattern ?? "");
  return argsPattern === geminiArgsPatternFor(ctx);
}

function geminiRuleEntries(ctx: RuleContext): Array<Record<string, unknown>> {
  const pattern = geminiArgsPatternFor(ctx);
  return geminiReadTools().map((toolName) => ({
		toolName,
		argsPattern: pattern,
		decision: "deny",
		priority: 100,
	}));
}

export function applyGeminiCli(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const rules = getArray<Record<string, unknown>>(next, "rule");
  const oursPresent = new Set(
    rules.filter((r) => geminiIsOurRule(r, ctx)).map((r) => String(r.toolName)),
  );
  const additions = geminiRuleEntries(ctx).filter(
    (entry) => !oursPresent.has(String(entry.toolName)),
  );
  if (additions.length > 0) {
    setPath(next, "rule", [...rules, ...additions]);
  }
  return next;
}

export function removeGeminiCli(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  return removeFromArray(
    config,
    "rule",
    (item: Record<string, unknown>) => geminiIsOurRule(item, ctx),
  );
}

export function hasGeminiCli(config: ParsedConfig, ctx: RuleContext): boolean {
  const rules = getArray<Record<string, unknown>>(config, "rule");
  return rules.some((item) => geminiIsOurRule(item, ctx));
}

// ----------------------------------------------------------------------------
// antigravity — JSON, global-only; permissions.deny tokens
// ----------------------------------------------------------------------------

function antigravityRuleEntry(ctx: RuleContext): string {
  return `read_file(${ctx.humansMdRelPath})`;
}

export function applyAntigravity(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const deny = getArray<string>(next, "permissions.deny");
  const entry = antigravityRuleEntry(ctx);
  if (!deny.some((item) => item.trim() === entry)) {
    setPath(next, "permissions.deny", [...deny, entry]);
  }
  return next;
}

export function removeAntigravity(config: ParsedConfig, ctx: RuleContext): ParsedConfig {
  const next = deepClone(config);
  const deny = getArray<string>(next, "permissions.deny");
  const entry = antigravityRuleEntry(ctx);
  setPath(
    next,
    "permissions.deny",
    deny.filter((item) => item.trim() !== entry),
  );
  return next;
}

export function hasAntigravity(config: ParsedConfig, ctx: RuleContext): boolean {
  const deny = getArray<string>(config, "permissions.deny");
  const entry = antigravityRuleEntry(ctx);
  return deny.some((item) => item.trim() === entry);
}

// ----------------------------------------------------------------------------
// cursor — standalone `.cursorignore` file (not parsed config)
// ----------------------------------------------------------------------------

/**
 * For cursor, the rule is a single line in `.cursorignore`. The installer
 * handles cursor via a dedicated file writer rather than the adapter pipeline.
 *
 * The transforms here are no-ops so the generic registry shape is uniform;
 * the real cursor logic lives in `installer.ts::applyCursorIgnore`.
 */
export const applyCursor = (config: ParsedConfig): ParsedConfig => deepClone(config);
export const removeCursor = (config: ParsedConfig): ParsedConfig => deepClone(config);
export const hasCursor = (_config: ParsedConfig): boolean => false;

// Line written to `.cursorignore`.
export function cursorIgnoreLine(ctx: RuleContext): string {
  return `${ctx.humansMdRelPath}`;
}
