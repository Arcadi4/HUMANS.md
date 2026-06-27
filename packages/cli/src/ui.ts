/**
 * Interactive UI helpers built on @clack/prompts.
 *
 * The flow follows the project spec:
 *
 *   init flow:
 *     1. (if no HUMANS.md) → ask to create one
 *     2. ask scope: this project only | globally
 *     3. ask which agents (multiselect; detected agents pre-selected)
 *     4. execute + report
 *
 *   remove flow:
 *     1. ask scope
 *     2. ask which agents (detected as having the rule)
 *     3. execute + report
 */

import * as p from "@clack/prompts";

import {
  agentOrder,
  agents,
  detectGlobalAgents,
  detectProjectAgents,
  getAgentTypes,
} from "./agents.ts";
import type { AgentType, Scope } from "./types.ts";

const CANCEL = Symbol("cancel");

export function isCancel<T>(value: T | symbol): boolean {
  return p.isCancel(value);
}

export function bail(message = "Cancelled."): never {
  p.cancel(message);
  process.exit(0);
}

void CANCEL;

// Pretty intro banner with logo.
export function introBanner(): void {
  p.intro(`\n${logo()}\n  humansmd — hide HUMANS.md from your agents`);
}

// Render the small HUMANS.md ASCII logo.
export function logo(): string {
  return `
██╗  ██╗██╗   ██╗███╗   ███╗ █████╗ ███╗   ██╗███████╗   ███╗   ███╗██████╗ 
██║  ██║██║   ██║████╗ ████║██╔══██╗████╗  ██║██╔════╝   ████╗ ████║██╔══██╗
███████║██║   ██║██╔████╔██║███████║██╔██╗ ██║███████╗   ██╔████╔██║██║  ██║
██╔══██║██║   ██║██║╚██╔╝██║██╔══██║██║╚██╗██║╚════██║   ██║╚██╔╝██║██║  ██║
██║  ██║╚██████╔╝██║ ╚═╝ ██║██║  ██║██║ ╚████║███████║██╗██║ ╚═╝ ██║██████╔╝
╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝╚═╝     ╚═╝╚═════╝ 
`;
}

// --- init flow --------------------------------------------------------------

/**
 * Ask whether to create an empty HUMANS.md. Returns true if the user said yes.
 * Bails on cancel.
 */
export async function askCreateHumansMd(): Promise<boolean> {
  const answer = await p.confirm({
    message: "No HUMANS.md found. Create one with a default template?",
    initialValue: true,
  });
  if (isCancel(answer)) bail();
  return answer as boolean;
}

/**
 * Ask whether to apply rules at project or global scope. Bails on cancel.
 */
export async function askScope(): Promise<Scope> {
  const scope = await p.select<Scope>({
    message: "Configure permissions for this project only, or globally?",
    initialValue: "project",
    options: [
      { value: "project", label: "This project only", hint: "writes to project-local config" },
      { value: "global", label: "Globally", hint: "writes to your home dir config" },
    ],
  });
  if (isCancel(scope)) bail();
  return scope as Scope;
}

/**
 * Ask which agents to configure. Detected agents are pre-selected; the user
 * can override. Returns the selected agent types. Bails on cancel.
 */
export async function askAgents(opts: { scope: Scope; cwd: string }): Promise<AgentType[]> {
  const detected = opts.scope === "project" ? detectProjectAgents(opts.cwd) : detectGlobalAgents();

  const options = agentOrder.map((type) => {
    const cfg = agents[type]!;
    const isDetected = detected.includes(type);
    const hint = isDetected ? "detected" : "not detected";
    return {
      value: type,
      label: cfg.displayName,
      hint,
    };
  });

  const selected = await p.multiselect<AgentType>({
    message: "Select agents to configure:",
    initialValues: detected,
    options,
    required: false,
  });
  if (isCancel(selected)) bail();
  return [...(selected as AgentType[])];
}

// --- remove flow ------------------------------------------------------------

// Ask which agents to remove. Returns selected types. Bails on cancel.
export async function askAgentsForRemoval(opts: { scope: Scope }): Promise<AgentType[]> {
  const options = getAgentTypes().map((type) => ({
    value: type,
    label: agents[type]!.displayName,
  }));

  const selected = await p.multiselect<AgentType>({
    message: `Select agents to remove humansmd rules from (${opts.scope} scope):`,
    initialValues: [],
    options,
    required: false,
  });
  if (isCancel(selected)) bail();
  return [...(selected as AgentType[])];
}

// --- reporting --------------------------------------------------------------

// Render the per-agent result summary at the end of init/remove.
export function reportResults(
  results: ReadonlyArray<{
    agent: AgentType;
    success: boolean;
    action: "wrote" | "removed" | "skipped" | "noop";
    message: string;
  }>,
): void {
  for (const r of results) {
    const note = `${r.message}`;
    if (!r.success) {
      p.log.error(`✗ ${note}`);
    } else if (r.action === "skipped") {
      p.log.warn(`↷ ${note}`);
    } else if (r.action === "noop") {
      p.log.info(`• ${note}`);
    } else {
      p.log.step(`✓ ${note}`);
    }
  }
}
