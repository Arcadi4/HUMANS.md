/**
 * Utilities for working with parsed config objects in a format-neutral way.
 */

import type { ParsedConfig } from "../types.ts";

/**
 * Read the value at a dot-separated path (`"a.b.c"`) within a nested object.
 * Returns `undefined` if any segment is missing.
 */
export function getPath(obj: ParsedConfig, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/**
 * Set a value at a dot-separated path, creating intermediate objects as
 * needed. Mutates `obj` in place and returns it.
 */
export function setPath(obj: ParsedConfig, dotPath: string, value: unknown): ParsedConfig {
  const parts = dotPath.split(".");
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = cursor[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[part] = fresh;
      cursor = fresh;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[parts[parts.length - 1]!] = value;
  return obj;
}

/**
 * Returns the array at `dotPath`, or an empty array if missing/not an array.
 * Does not mutate the object.
 */
export function getArray<T = string>(obj: ParsedConfig, dotPath: string): T[] {
  const value = getPath(obj, dotPath);
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Append `items` to the array at `dotPath`, creating the array if missing.
 * Returns a new object; the input is not mutated.
 */
export function appendToArray<T>(
  obj: ParsedConfig,
  dotPath: string,
  items: readonly T[],
): ParsedConfig {
  const next = structuredClone(obj) as ParsedConfig;
  const current = getArray<T>(next, dotPath);
  setPath(next, dotPath, [...current, ...items]);
  return next;
}

/**
 * Remove every element of the array at `dotPath` for which `predicate`
 * returns true. Returns a new object; the input is not mutated.
 */
export function removeFromArray<T>(
  obj: ParsedConfig,
  dotPath: string,
  predicate: (item: T) => boolean,
): ParsedConfig {
  const next = structuredClone(obj) as ParsedConfig;
  const current = getArray<T>(next, dotPath);
  setPath(
    next,
    dotPath,
    current.filter((item) => !predicate(item)),
  );
  return next;
}

/**
 * Deep structural clone. Uses `structuredClone` when available (Node ≥17),
 * otherwise falls back to `JSON.parse(JSON.stringify(x))`.
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deep merge `source` into `target`, returning a new object. Arrays are
 * replaced (not concatenated). Plain objects are recursively merged.
 */
export function deepMerge<T extends ParsedConfig>(target: T, source: Partial<T>): T {
  const out: ParsedConfig = deepClone(target);
  for (const [key, srcVal] of Object.entries(source)) {
    if (srcVal && typeof srcVal === "object" && !Array.isArray(srcVal)) {
      const tgtVal = out[key];
      out[key] =
        tgtVal && typeof tgtVal === "object" && !Array.isArray(tgtVal)
          ? deepMerge(tgtVal as ParsedConfig, srcVal as ParsedConfig)
          : deepClone(srcVal as ParsedConfig);
    } else {
      out[key] = deepClone(srcVal as unknown);
    }
  }
  return out as T;
}
