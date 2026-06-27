/**
 * Format-agnostic config readers and writers.
 *
 * Writers accept a {@link WriteOptions.configKey} for JSON: the dot-path whose
 * subtree contains the edited value. The writer deep-merges the new value into
 * the existing document, then rewrites only that subtree via `jsonc.modify` so
 * comments outside it survive.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as jsonc from "jsonc-parser";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import type { ParsedConfig } from "../types.ts";

// Read a file as UTF-8 text, returning `null` if missing or empty.
export function readText(path: string): string | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return text.trim() === "" ? null : text;
}

// Ensure the parent directory of `path` exists.
export function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Write text to disk, creating parent dirs as needed.
export function writeText(path: string, text: string): void {
  ensureParentDir(path);
  writeFileSync(path, text, "utf8");
}

// Parse a JSON/JSONC string; returns `{}` on empty, errors, or non-objects.
export function parseJsonOrJsonc(text: string): ParsedConfig {
  const errors: jsonc.ParseError[] = [];
  const parsed = jsonc.parse(text, errors);
  if (errors.length > 0) return {};
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as ParsedConfig)
    : {};
}

// Read the raw text at `path` (null if missing/empty).
export function readRawText(path: string): string | null {
  return readText(path);
}

export interface WriteOptions {
  /**
   * Dot-path of the JSON subtree that was modified (e.g. `"permissions.deny"`).
   * When provided and the existing file is JSON, the writer rewrites only that
   * subtree via `jsonc.modify`, preserving comments and formatting elsewhere.
   */
  configKey?: string;
}

// Format-neutral parse + serialize surface.
export interface FormatAdapter {
  read(path: string): ParsedConfig;
  write(path: string, config: ParsedConfig, opts?: WriteOptions): void;
}

export const jsonFormat: FormatAdapter = {
  read(path: string): ParsedConfig {
    const text = readText(path);
    return text === null ? {} : parseJsonOrJsonc(text);
  },
  write(path: string, config: ParsedConfig, opts?: WriteOptions): void {
    const existing = readText(path);

    if (existing !== null && opts?.configKey) {
      try {
        const updated = applyJsoncKeyEdit(existing, config, opts.configKey);
        writeText(path, updated);
        return;
      } catch {
        // fall through to full stringify
      }
    }

    writeText(path, `${JSON.stringify(config, null, 2)}\n`);
  },
};

/**
 * Rewrite the `configKey` subtree of the original JSONC text to the value
 * found at the same path in `incoming`. Comments and formatting outside that
 * subtree are preserved. The caller has already merged the new value into the
 * parsed config, so we trust `incoming` as the desired post-write state.
 */
function applyJsoncKeyEdit(
  existingText: string,
  incoming: ParsedConfig,
  configKey: string,
): string {
  const keyPath = configKey.split(".");
  const newValue = getNestedValue(incoming, keyPath);
  const edits = jsonc.modify(existingText, keyPath, newValue, {
    formattingOptions: detectIndent(existingText),
  });
  const updated = jsonc.applyEdits(existingText, edits);
  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

function detectIndent(text: string): jsonc.FormattingOptions {
  let result: { tabSize: number; insertSpaces: boolean } | null = null;
  jsonc.visit(text, {
    onObjectProperty: (_prop, offset, _len, startLine, startCharacter) => {
      if (result === null && startLine > 0 && startCharacter > 0) {
        const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
        const whitespace = text.slice(lineStart, offset);
        result = {
          tabSize: startCharacter,
          insertSpaces: !whitespace.includes("\t"),
        };
      }
    },
  });
  return result ?? { tabSize: 2, insertSpaces: true };
}

function getNestedValue(obj: ParsedConfig, path: string[]): unknown {
  let cursor: unknown = obj;
  for (const seg of path) {
    if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
      cursor = (cursor as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cursor;
}

export const yamlFormat: FormatAdapter = {
  read(path: string): ParsedConfig {
    const text = readText(path);
    if (text === null) return {};
    const parsed = loadYaml(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ParsedConfig)
      : {};
  },
  write(path: string, config: ParsedConfig, _opts?: WriteOptions): void {
    writeText(path, dumpYaml(config, { indent: 2, lineWidth: -1, noRefs: true }));
  },
};

export const tomlFormat: FormatAdapter = {
  read(path: string): ParsedConfig {
    const text = readText(path);
    if (text === null) return {};
    const parsed = parseToml(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ParsedConfig)
      : {};
  },
  write(path: string, config: ParsedConfig, _opts?: WriteOptions): void {
    writeText(path, stringifyToml(config));
  },
};

export function getFormat(name: "json" | "yaml" | "toml"): FormatAdapter {
  switch (name) {
    case "json":
      return jsonFormat;
    case "yaml":
      return yamlFormat;
    case "toml":
      return tomlFormat;
  }
}
