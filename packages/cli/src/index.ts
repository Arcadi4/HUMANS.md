#!/usr/bin/env node
/**
 * humansmd CLI entrypoint.
 *
 *   humansmd            # shows help
 *   humansmd init       # interactive setup
 *   humansmd remove     # remove previously written rules (alias: rm)
 *
 * Flags:
 *   -g, --global        # use global scope (skip scope prompt)
 *   -p, --project       # use project scope (skip scope prompt)
 *   -a, --agent <type>  # restrict to a single agent (repeatable, comma-separated)
 *   -y, --yes           # skip all optional prompts (use detected agents)
 *   --path <path>       # override HUMANS.md relative path (default: HUMANS.md)
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Command } from "commander";
import * as p from "@clack/prompts";

import { getAgentTypes } from "./agents.ts";
import { applyRuleForAgent, buildResultSummary, removeRuleForAgent } from "./installer.ts";
import { getLastScope, getLastSelectedAgents, saveSelection } from "./config.ts";
import { defaultHumansMdTemplate } from "./template.ts";
import type { AgentType, Scope } from "./types.ts";
import {
  askAgents,
  askAgentsForRemoval,
  askCreateHumansMd,
  askScope,
  introBanner,
  reportResults,
} from "./ui.ts";

const VERSION = "0.1.1";

// --- parsed options ---------------------------------------------------------

interface ParsedOpts {
  scope: Scope | undefined;
  agents: AgentType[];
  yes: boolean;
  humansMdRelPath: string;
  cwd: string;
}

// Collect repeatable commander option values into an array.
function collectRepeatable(value: string, previous: string[]): string[] {
  return [
    ...previous,
    ...value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
}

// Convert a `--global`/`--project` pair into a scope.
function pickScope(global: boolean, project: boolean): Scope | undefined {
  if (global && project) {
    p.log.warn("Both --global and --project given. Defaulting to --project.");
    return "project";
  }
  if (global) return "global";
  if (project) return "project";
  return undefined;
}

function parseAgentFlags(flags: string[]): AgentType[] {
  const known = new Set<AgentType>(getAgentTypes());
  const out: AgentType[] = [];
  const invalid: string[] = [];
  for (const candidate of flags) {
    if (known.has(candidate as AgentType)) {
      out.push(candidate as AgentType);
    } else {
      invalid.push(candidate);
    }
  }
  if (invalid.length > 0) {
    const knownList = [...known].sort().join(", ");
    p.log.error(`Unknown agent(s): ${invalid.join(", ")}.`);
    p.log.info(`Known agents: ${knownList}`);
    if (out.length === 0) {
      process.exit(1);
    }
    p.log.warn(`Proceeding with ${out.length} valid agent(s).`);
  }
  return out;
}

function parseOpts(raw: {
  global?: boolean;
  project?: boolean;
  agent?: string[];
  yes?: boolean;
  path?: string;
}): ParsedOpts {
  return {
    scope: pickScope(raw.global === true, raw.project === true),
    agents: parseAgentFlags(raw.agent ?? []),
    yes: raw.yes === true,
    humansMdRelPath: raw.path ?? "HUMANS.md",
    cwd: process.cwd(),
  };
}

// --- init flow --------------------------------------------------------------

async function runInit(raw: {
  global?: boolean;
  project?: boolean;
  agent?: string[];
  yes?: boolean;
  path?: string;
}): Promise<void> {
  introBanner();
  const opts = parseOpts(raw);
  p.log.info(`Project: ${opts.cwd}`);

  await ensureHumansMd(opts);

  const scope = await resolveScope(opts);

  const selected = await resolveAgents(opts, scope);

  if (selected.length === 0) {
    p.outro("No agents configured.");
    return;
  }

  p.log.step(`Applying rules (${scope} scope)...`);
  const results = selected.map((type) =>
    applyRuleForAgent(type, {
      scope,
      cwd: opts.cwd,
      humansMdRelPath: opts.humansMdRelPath,
    }),
  );
  reportResults(results);

  const summary = buildResultSummary(results);
  p.note(
    [
      `Applied:         ${summary.applied}`,
      `Already present: ${summary.noop}`,
      `Skipped:         ${summary.skipped}`,
      `Failed:          ${summary.failed}`,
    ].join("\n"),
    "Summary",
  );

  saveSelection(selected, scope);
  p.outro("Done.");
}

async function ensureHumansMd(opts: ParsedOpts): Promise<void> {
  const abs = resolve(opts.cwd, opts.humansMdRelPath);
  if (existsSync(abs)) return;
  if (opts.yes) {
    writeHumansMd(abs);
    p.log.step(`Created ${opts.humansMdRelPath} (default template).`);
    return;
  }
  const create = await askCreateHumansMd();
  if (create) {
    writeHumansMd(abs);
    p.log.step(`Created ${opts.humansMdRelPath}.`);
  }
}

function writeHumansMd(abs: string): void {
  writeFileSync(abs, defaultHumansMdTemplate("project"), "utf8");
}

async function resolveScope(opts: ParsedOpts): Promise<Scope> {
  if (opts.scope) return opts.scope;
  if (opts.yes) return getLastScope() ?? "project";
  return askScope();
}

async function resolveAgents(opts: ParsedOpts, scope: Scope): Promise<AgentType[]> {
  if (opts.agents.length > 0) return opts.agents;
  const selected = await askAgents({ scope, cwd: opts.cwd });
  if (selected.length === 0) {
    p.log.warn("No agents selected.");
  }
  return selected;
}

// --- remove flow ------------------------------------------------------------

async function runRemove(raw: {
  global?: boolean;
  project?: boolean;
  agent?: string[];
  yes?: boolean;
  path?: string;
}): Promise<void> {
  introBanner();
  const opts = parseOpts(raw);

  const scope = await resolveScope(opts);

  let selected: AgentType[];
  if (opts.agents.length > 0) {
    selected = opts.agents;
  } else if (opts.yes) {
    selected = getLastSelectedAgents() ?? [];
    if (selected.length === 0) {
      p.log.warn("No previously selected agents on file. Pass --agent or run interactively.");
    }
  } else {
    selected = await askAgentsForRemoval({ scope });
  }

  if (selected.length === 0) {
    p.outro("Nothing to remove.");
    return;
  }

  p.log.step(`Removing rules (${scope} scope)...`);
  const results = selected.map((type) =>
    removeRuleForAgent(type, {
      scope,
      cwd: opts.cwd,
      humansMdRelPath: opts.humansMdRelPath,
    }),
  );
  reportResults(results);

  const summary = buildResultSummary(results);
  p.note(
    [
      `Removed:         ${summary.removed}`,
      `Not present:     ${summary.noop}`,
      `Skipped:         ${summary.skipped}`,
      `Failed:          ${summary.failed}`,
    ].join("\n"),
    "Summary",
  );

  p.outro("Done.");
}

// --- commander wiring -------------------------------------------------------

function withSharedOptions(cmd: Command): Command {
  return cmd
    .option("-g, --global", "configure globally (skip scope prompt)")
    .option("-p, --project", "configure for this project only (skip scope prompt)")
    .option(
      "-a, --agent <type>",
      "restrict to one agent (repeatable, comma-separated)",
      collectRepeatable,
      [] as string[],
    )
    .option("-y, --yes", "skip optional prompts; use detected agents")
    .option("--path <path>", "override HUMANS.md relative path", "HUMANS.md");
}

const program = new Command();

program
  .name("humans.md")
  .description("Enforce HUMANS.md against your coding agents.")
  .version(VERSION)
  .action(() => {
    // No subcommand → show help.
    program.help();
  });

withSharedOptions(
  program.command("init").description("Configure your agents to deny read access to HUMANS.md."),
).action(async (raw: Record<string, unknown>) => {
  await runInit(raw as Parameters<typeof runInit>[0]);
});

withSharedOptions(
  program
    .command("remove")
    .alias("rm")
    .description("Remove humansmd deny rules from agent configs."),
).action(async (raw: Record<string, unknown>) => {
  await runRemove(raw as Parameters<typeof runRemove>[0]);
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  p.log.error(`Fatal: ${message}`);
  process.exit(1);
});
