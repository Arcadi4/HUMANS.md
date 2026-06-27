/**
 * Re-export the format adapters and utilities under a single entrypoint.
 */

export {
  jsonFormat,
  yamlFormat,
  tomlFormat,
  getFormat,
  type FormatAdapter,
  type WriteOptions,
  readRawText,
} from "./adapters.ts";
export { readText, writeText, ensureParentDir } from "./adapters.ts";
export {
  getPath,
  setPath,
  getArray,
  appendToArray,
  removeFromArray,
  deepClone,
  deepMerge,
} from "./utils.ts";
