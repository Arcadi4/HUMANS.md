# humans.md

CLI to configure coding agents so they **cannot read** your [HUMANS.md](https://github.com/Arcadi4/HUMANS.md) file — notes, credentials, and context you keep for humans only.

## Install

```bash
npx humans.md init
```

After install, the `humansmd` binary is on your PATH when the package is installed globally or via `pnpm`/`npm` in a project.

## Commands

| Command           | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `humansmd init`   | Add read-deny rules for supported agents (interactive) |
| `humansmd remove` | Remove rules added by this tool (`rm` alias)           |

```bash
npx humans.md init
npx humans.md remove
```

## Supported agents

Rules use each tool’s native deny/read permissions where available:

- Claude Code (`claude`)
- OpenAI Codex (`codex`)
- Cursor (`cursor`)
- OpenCode (`opencode`)
- Zed (`zed`)
- Gemini CLI (`gemini-cli`)
- Antigravity (`antigravity`)

Use `-a, --agent <type>` to limit to specific agents (repeatable or comma-separated).

## Options

Shared by `init` and `remove`:

| Flag                 | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `-g, --global`       | Write user-wide config (skip scope prompt)                |
| `-p, --project`      | Write project config only (skip scope prompt)             |
| `-a, --agent <type>` | Only these agents                                         |
| `-y, --yes`          | Skip optional prompts; use detected agents                |
| `--path <path>`      | HUMANS.md path relative to project (default: `HUMANS.md`) |

Examples:

```bash
humansmd init -p -y
humansmd init -g -a claude,codex
humansmd remove -p --path docs/HUMANS.md
```

## Scope

- **Project** — rules in repo-local agent config (e.g. `.claude/settings.json`).
- **Global** — rules in your home config (e.g. `~/.claude/settings.json`).

Some agents only support global rules; the CLI skips or warns at project scope when upstream config has no project tier.
