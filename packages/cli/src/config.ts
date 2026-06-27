/**
 * Persistence for humansmd's own small state file.
 *
 * Layout (XDG-aware): `~/.config/humansmd/config.json`
 *
 *   {
 *     "version": 1,
 *     "lastSelectedAgents": ["claude", "opencode", ...],
 *     "lastScope": "project" | "global"
 *   }
 *
 * All fields are optional. Missing file ⇒ defaults. Never throws on read.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { xdgConfigHome } from "./paths.ts";
import type { AgentType, Scope } from "./types.ts";

interface HumansmdConfig {
  version: 1;
  lastSelectedAgents?: AgentType[];
  lastScope?: Scope;
}

const CONFIG_DIR = join(xdgConfigHome(), "humansmd");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// Returns the full path to the humansmd config file.
export function getConfigPath(): string {
  return CONFIG_PATH;
}

// Reads the config file, returning a default if missing or malformed.
export function readConfig(): HumansmdConfig {
  if (!existsSync(CONFIG_PATH)) return { version: 1 };
  try {
    const text = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(text) as Partial<HumansmdConfig>;
    return { version: 1, ...parsed };
  } catch {
    return { version: 1 };
  }
}

// Writes the config file, creating parent dirs.
function writeConfig(config: HumansmdConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// Returns the last selected agent list, or undefined if never saved.
export function getLastSelectedAgents(): AgentType[] | undefined {
  return readConfig().lastSelectedAgents;
}

// Returns the last selected scope, or undefined if never saved.
export function getLastScope(): Scope | undefined {
  return readConfig().lastScope;
}

// Persists the selected agents + scope for next run's "same as last time".
export function saveSelection(agents: AgentType[], scope: Scope): void {
  const config = readConfig();
  config.lastSelectedAgents = agents;
  config.lastScope = scope;
  writeConfig(config);
}
