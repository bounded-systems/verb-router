// @bounded-systems/verb-router — compose N verbspec registries into one MCP server.
//
// `@bounded-systems/verbspec-mcp` already turns ONE registry into a real MCP server, with
// filter/deps/mapResult/dispatch seams. This package does not re-implement any of that. It adds
// the one thing missing when a machine's verbs are spread across repos: merging several
// registries into a single surface, with collisions caught at build time rather than silently
// shadowing each other.
//
//   import { serve } from "@bounded-systems/verb-router";
//   import { registry as phobos } from "../src/registry.ts";
//   await serve([{ registry: phobos }], { name: "verb", version: "1.0.0" });
//
// The merged registry is also what generates the plugin's commands (see gen.ts), so a verb's
// `summary` is the single source of truth for both its MCP tool description and its
// /verb:<id> slash-command description. Author once.

import { serveStdio, type McpServerOptions } from "@bounded-systems/verbspec-mcp";
import type { AnyVerbSpec, Registry } from "@bounded-systems/verbspec";

/** One registry contributed to the router, optionally under a namespace. */
export interface RegistrySource {
  /**
   * Namespace prefix for every verb in this registry, e.g. `"phobos"` turns `status` into
   * `phobos_status`. Underscore-joined because MCP tool names must match `[a-zA-Z0-9_-]+`.
   * Omit for the common single-registry case, where verb ids pass through unchanged.
   */
  id?: string;
  registry: Registry;
}

/** Thrown when two contributed registries claim the same verb id and neither is namespaced. */
export class VerbCollisionError extends Error {
  constructor(readonly verbId: string) {
    super(
      `verb id "${verbId}" is contributed by more than one registry. ` +
        `Give at least one of them an \`id\` to namespace it (e.g. { id: "phobos", registry }).`,
    );
    this.name = "VerbCollisionError";
  }
}

/**
 * Merge registries into one, rewriting each verb's own `id` to match its merged key so the MCP
 * tool name and the verb id can never drift. Collisions throw — in the nix build that means a
 * failed derivation, not a plugin that silently lost a verb.
 */
export function mergeRegistries(sources: readonly RegistrySource[]): Registry {
  const merged: Record<string, AnyVerbSpec> = {};

  for (const { id: ns, registry } of sources) {
    for (const [key, verb] of Object.entries(registry) as [string, AnyVerbSpec][]) {
      const mergedKey = ns ? `${ns}_${key}` : key;
      if (Object.hasOwn(merged, mergedKey)) throw new VerbCollisionError(mergedKey);
      // Shallow copy so the source registry is untouched; only the identity changes.
      merged[mergedKey] = ns ? { ...verb, id: mergedKey } : verb;
    }
  }

  return merged as Registry;
}

/** Merge the sources and serve them over stdio. Options pass straight through to verbspec-mcp. */
export async function serve(
  sources: readonly RegistrySource[],
  opts: McpServerOptions = {},
): Promise<void> {
  await serveStdio(mergeRegistries(sources), opts);
}
