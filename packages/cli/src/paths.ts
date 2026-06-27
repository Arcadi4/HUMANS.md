import { homedir } from "node:os";
import { join } from "node:path";

// `~` → absolute home path. Pass through if already absolute.
export function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

// XDG-style config home. Falls back to `~/.config`.
export function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

// Application Support dir on macOS, APPDATA on Windows, XDG_CONFIG_HOME elsewhere.
export function appSupportDir(appName: string): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", appName);
    case "win32": {
      const appdata = process.env.APPDATA;
      return appdata ? join(appdata, appName) : join(homedir(), "AppData", "Roaming", appName);
    }
    default:
      return join(xdgConfigHome(), appName);
  }
}

// Resolve a `~`-prefixed path, or pass through if already absolute.
export function resolveHomePrefixed(p: string): string {
  return expandTilde(p);
}

// Join project root with a relative path.
export function resolveProjectPath(projectRoot: string, rel: string): string {
  return join(projectRoot, rel);
}
