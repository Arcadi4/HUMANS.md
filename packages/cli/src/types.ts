/**
 * Core type definitions for the humansmd CLI.
 *
 * Each agent has:
 *   - {@link AgentConfig.applyDenyRule}: pure transform that injects the
 *     HUMANS.md read-deny rule into a parsed config object.
 *   - {@link AgentConfig.removeDenyRule}: pure transform that strips the
 *     rule written by `applyDenyRule` (symmetric with `init`/`remove`).
 *
 * Every agent in the registry exposes a native read-deny mechanism. Agents
 * without one are intentionally omitted rather than modelled as "soft" or
 * "unsupported".
 */

// Supported config file formats.
export type ConfigFormat = "json" | "yaml" | "toml";

/**
 * Scopes at which a rule can be applied.
 *
 * - `project` — written into the project's local config file (e.g. `.claude/settings.json`).
 * - `global`  — written into the user-wide config file (e.g. `~/.claude/settings.json`).
 */
export type Scope = "project" | "global";

export type AgentType =
  | "antigravity"
  | "claude"
  | "codex"
  | "cursor"
  | "gemini-cli"
  | "opencode"
  | "zed";

/**
 * A parsed configuration object. JSON and YAML yield plain objects; TOML yields
 * a `smol-toml`-shaped object (also a plain object at the top level).
 */
export type ParsedConfig = Record<string, unknown>;

// Result of applying or removing a deny rule for a single agent.
export interface AgentResult {
  agent: AgentType;
  success: boolean;
  scope: Scope;
  path: string;
  // What was written or skipped.
  action: "wrote" | "removed" | "skipped" | "noop";
  // Human-readable status message.
  message: string;
  // Present on failure.
  error?: string;
}

/**
 * Static metadata describing how to find, write to, and remove from one agent.
 *
 * All paths are absolute or `~/`-prefixed and resolved by the caller. The
 * `applyDenyRule`/`removeDenyRule` callbacks are pure functions over a parsed
 * config object; they MUST be idempotent.
 */
export interface AgentConfig {
  // Stable agent id.
  readonly type: AgentType;
  // Human-readable label.
  readonly displayName: string;

  // Global config path (absolute or `~/`-prefixed).
  readonly globalConfigPath: string;
  // Project-local config path, relative to project root, if supported.
  readonly projectConfigPath?: string;
  // Paths whose presence in cwd implies the agent is active in the project.
  readonly projectDetectPaths: string[];
  // Glob/dir whose presence in home implies the agent is installed globally.
  readonly globalDetectPath: string;
  // Config file format.
  readonly format: ConfigFormat;
  /**
   * Dot-path within the config where the rule lives, used as a hint to the
   * format writers (the JSON writer preserves comments outside this key).
   */
  readonly ruleKeyHint?: string;

  /**
   * Returns a new parsed config with the HUMANS.md deny rule present.
   * MUST be idempotent: calling twice produces the same output as calling once.
   *
   * @param config existing parsed config (may be empty object).
   * @param ctx    rule context (rule marker, project root, scope).
   */
  applyDenyRule(config: ParsedConfig, ctx: RuleContext): ParsedConfig;

  /**
   * Returns a new parsed config with only the rule written by
   * {@link applyDenyRule} removed. MUST be the exact inverse.
   */
  removeDenyRule(config: ParsedConfig, ctx: RuleContext): ParsedConfig;

  /**
   * Returns true if the rule written by {@link applyDenyRule} is already
   * present in `config`. Used for idempotency reporting.
   */
  hasDenyRule(config: ParsedConfig, ctx: RuleContext): boolean;
}

// Context passed to rule transforms.
export interface RuleContext {
  // Marker tag used to find/replace our rule across formats.
  readonly marker: string;
  // Project root (cwd). Absolute path.
  readonly projectRoot: string;
  // Path to HUMANS.md relative to projectRoot, as the agent should see it.
  readonly humansMdRelPath: string;
  // Scope being applied.
  readonly scope: Scope;
}

// Default HUMANS.md path relative to project root.
export const DEFAULT_HUMANS_MD = "HUMANS.md";

// Marker tag injected into every rule so we can find and remove our own edits.
export const DEFAULT_MARKER = "humansmd";
