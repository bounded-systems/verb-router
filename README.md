# verb-router

Compose [verbspec](https://github.com/bounded-systems/verbspec) registries into one MCP server,
and generate a complete Claude Code plugin from the verbs themselves — commands, manifests, and
marketplace — as a single immutable nix store path.

A verb's `summary` becomes both its MCP tool description and its `/<name>:<verb>` slash-command
description. Adding a verb to a registry is the whole of adding a command. There is no second
place to edit, and no way for the two to drift.

## Why

The obvious way to ship verbs as a Claude Code plugin is to hand-write `commands/*.md` next to a
`.mcp.json` that runs the server:

```json
{ "command": "bun", "args": ["run", "${CLAUDE_PLUGIN_ROOT}/../src/mcp.ts"] }
```

That works only while the plugin is loaded live from a working checkout, because `../src` is the
repo it was authored in. Installed from a marketplace into `plugins/cache/…` it resolves to
nothing — the plugin is **structurally non-distributable**, and the command descriptions are
hand-copied prose that quietly diverges from the verbs.

`mkVerbPlugin` fixes both: an absolute store path for the server, and generated commands.

## Use

```nix
{
  inputs.verb-router.url = "github:bounded-systems/verb-router";

  outputs = { self, nixpkgs, verb-router }:
    let system = "aarch64-darwin"; in {
      packages.${system}.plugin =
        verb-router.lib.${system}.mkVerbPlugin {
          name = "verb";                       # -> /verb:status, /verb:drift, …
          version = "0.6.0";
          description = "phobos self-knowledge for Claude sessions";
          owner = { name = "Robert DeLanghe"; };

          src = self;                          # must carry its own node_modules
          registries = [ { path = "src/registry.ts"; } ];
          assets = [ "context" "shapes" "HANDBOOK.md" ];
          hooks = "plugin/hooks";              # optional; copied verbatim
          marketplaceName = "verb-router";
        };
    };
}
```

Several registries, namespaced on collision:

```nix
registries = [
  { path = "src/registry.ts"; }
  { path = "vendor/other/registry.ts"; id = "other"; }   # -> other_status
];
```

Two registries claiming one id with neither namespaced **fails the build** rather than silently
shadowing a verb.

### Install it

The output is simultaneously a marketplace and the plugin it lists, so it can be registered
directly. Claude Code neither writes to nor git-pulls a directory marketplace, so a read-only
store path works:

```sh
claude plugin marketplace add ./result
claude plugin install verb@verb-router
```

For a stable path that survives rebuilds, use the Home Manager module:

```nix
programs.verbRouter = { enable = true; plugins = [ self.packages.${system}.plugin ]; };
```

which links each plugin to `~/.config/claude/plugins/nix/<name>`. Register that path once; every
later switch updates the plugin underneath it.

## Output layout

```
$out/.claude-plugin/marketplace.json
$out/<name>/.claude-plugin/plugin.json
$out/<name>/.mcp.json          -> $out/<name>/bin/<name>-mcp   (absolute)
$out/<name>/commands/*.md      one per verb, from its summary
$out/<name>/bin/<name>-mcp     store-pinned bun launcher
$out/<name>/lib/mcp.js         the bundle
$out/<name>/<assets>           see below
```

**Assets.** Registry code commonly reads data files with
`new URL("../HANDBOOK.md", import.meta.url)`. That is module-relative, so after bundling it
resolves against the *bundle*, not the original source file. Putting the bundle at `<name>/lib/`
and the assets at `<name>/` reproduces the `src/` + repo-root layout the source was written
against, so those reads keep working with **no source changes**. List them in `assets`.

**Hooks.** Commands are generated from the registry; a hook is a script with its own
behaviour, so there is nothing in a verb to derive it from and it is copied verbatim. Point
`hooks` at a directory containing `hooks.json` and its scripts, and it lands at
`<name>/hooks/`. A `CLAUDE_PLUGIN_ROOT` reference inside `hooks.json` resolves to the installed
plugin directory, so a `hooks/<script>.sh` command needs no rewriting — unlike `.mcp.json`,
which had to become an absolute store path because it pointed *outside* the plugin. Exec bits
are preserved and `.sh` files re-marked.

Commands and hooks are the only components generated or carried. **Agents, skills, and LSP
servers are not supported yet** — check `claude plugin details` on the plugin you are replacing
before you disable it.

**Hermeticity.** `bun build` runs with no network, so `src` must carry its own committed
`node_modules`. `--compile` is deliberately not used: bun's single-binary step hangs at 100% CPU
under a nix build user on darwin. A bundle plus a store-pinned launcher is closed over its
runtime just the same, without the bug.

## What this is not

It does not re-implement MCP. [`verbspec-mcp`](https://github.com/bounded-systems/verbspec-mcp)
already turns one registry into a real MCP server, with `filter` / `deps` / `mapResult` /
`dispatch` seams; `serve()` here merges registries and hands the result straight to it. Options
pass through unchanged.

## Adopting it

Migrating an existing hand-written plugin? See [ADOPTING.md](ADOPTING.md) — the
ordering matters, because a directory marketplace loads from your working tree
and deleting the old plugin too early takes its commands down everywhere.

## License

MIT
