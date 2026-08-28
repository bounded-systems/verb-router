#!/usr/bin/env bun
// Build-time generator: turn the merged registry into a complete Claude Code plugin tree.
//
// Run inside the nix derivation, never at runtime. Everything it writes is derived from the
// verbs themselves — a verb's `summary` becomes both its MCP tool description and its
// /<plugin>:<verb> slash-command description, so the two cannot drift. Adding a verb to a
// registry is the whole of adding a command; there is no second place to edit.
//
// Layout written under $OUT (see mkVerbPlugin.nix for why the assets sit where they do):
//
//   $OUT/.claude-plugin/marketplace.json      the marketplace, listing ./$PLUGIN_NAME
//   $OUT/$PLUGIN_NAME/.claude-plugin/plugin.json
//   $OUT/$PLUGIN_NAME/.mcp.json               absolute store path — no ${CLAUDE_PLUGIN_ROOT}/../
//   $OUT/$PLUGIN_NAME/commands/<verb>.md      one per verb, generated from its summary

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toInputJsonSchema, type AnyVerbSpec } from "@bounded-systems/verbspec";
import { mergeRegistries } from "./router.ts";
import { sources } from "./sources.ts";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`gen.ts: required environment variable ${k} is unset`);
  return v;
};

const OUT = env("OUT");
const PLUGIN_NAME = env("PLUGIN_NAME");
const PLUGIN_VERSION = env("PLUGIN_VERSION");
const PLUGIN_DESCRIPTION = env("PLUGIN_DESCRIPTION");
const MARKETPLACE_NAME = env("MARKETPLACE_NAME");
const OWNER_NAME = env("OWNER_NAME");
const SERVER_LAUNCHER = env("SERVER_LAUNCHER"); // absolute path to the built launcher

const registry = mergeRegistries(sources);
const verbs = Object.entries(registry) as [string, AnyVerbSpec][];
if (verbs.length === 0) throw new Error("gen.ts: the merged registry is empty — nothing to generate");

const pluginDir = join(OUT, PLUGIN_NAME);
await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
await mkdir(join(pluginDir, "commands"), { recursive: true });
await mkdir(join(OUT, ".claude-plugin"), { recursive: true });

/** YAML-safe scalar for a frontmatter value: quote and escape rather than guess. */
const yamlScalar = (s: string): string => JSON.stringify(s.replace(/\s+/g, " ").trim());

/**
 * Named input fields of a verb, in schema order. Empty for the `z.object({})` no-input case.
 *
 * A field carrying a `default` counts as optional even when the schema also lists it under
 * `required`: verbspec renders `z.number().default(60)` both ways depending on the projection,
 * and the one that matters for a slash command is whether the user has to supply it.
 */
function inputFields(verb: AnyVerbSpec): { name: string; required: boolean }[] {
  let schema: { properties?: Record<string, { default?: unknown }>; required?: string[] };
  try {
    schema = toInputJsonSchema(verb) as typeof schema;
  } catch {
    return [];
  }
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, prop]) => ({
    name,
    required: required.has(name) && !Object.hasOwn(prop ?? {}, "default"),
  }));
}

for (const [id, verb] of verbs) {
  const fields = inputFields(verb);
  const summary = verb.summary ?? id;

  const frontmatter = [
    "---",
    `description: ${yamlScalar(summary)}`,
    ...(fields.length
      ? [
          `argument-hint: ${yamlScalar(
            fields.map((f) => (f.required ? `<${f.name}>` : `[${f.name}]`)).join(" "),
          )}`,
        ]
      : []),
    "---",
  ].join("\n");

  const argsLine = fields.length
    ? `Read any arguments the user passed in \`$ARGUMENTS\` and map them onto the tool's ` +
      `parameters (${fields.map((f) => `\`${f.name}\``).join(", ")}); omit any the user did not ` +
      `give and let the tool apply its own defaults.\n\n`
    : "";

  const body =
    `Run the \`${id}\` tool from the \`${PLUGIN_NAME}\` MCP server.\n\n` +
    argsLine +
    `Report what it returns, concisely and faithfully: lead with the answer, surface anything ` +
    `that failed or looks wrong, and keep the tool's own numbers and names. Do not invent ` +
    `fields it did not return, and do not change anything on the machine unless the user asks.\n\n` +
    `If the MCP server is unavailable, say so plainly rather than guessing at the answer.\n`;

  await writeFile(join(pluginDir, "commands", `${id}.md`), `${frontmatter}\n${body}`, "utf8");
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

await writeFile(
  join(pluginDir, ".claude-plugin", "plugin.json"),
  json({
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    description: PLUGIN_DESCRIPTION,
    author: { name: OWNER_NAME },
  }),
  "utf8",
);

// The point of the whole exercise: an absolute, immutable path. The old hand-written
// `${CLAUDE_PLUGIN_ROOT}/../src/mcp.ts` only resolved when the plugin was loaded live from a
// working checkout, which is what made it impossible to distribute.
await writeFile(
  join(pluginDir, ".mcp.json"),
  json({ mcpServers: { [PLUGIN_NAME]: { command: SERVER_LAUNCHER, args: [] } } }),
  "utf8",
);

await writeFile(
  join(OUT, ".claude-plugin", "marketplace.json"),
  json({
    name: MARKETPLACE_NAME,
    owner: { name: OWNER_NAME },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: `./${PLUGIN_NAME}`,
        description: PLUGIN_DESCRIPTION,
        version: PLUGIN_VERSION,
      },
    ],
  }),
  "utf8",
);

console.error(
  `verb-router: generated ${PLUGIN_NAME}@${MARKETPLACE_NAME} v${PLUGIN_VERSION} — ` +
    `${verbs.length} verbs: ${verbs.map(([id]) => id).join(", ")}`,
);
