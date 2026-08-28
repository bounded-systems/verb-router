# Adopting mkVerbPlugin

Migrating a hand-written Claude Code plugin to a generated one, without a window
where the commands stop working.

The worked example throughout is `bdelanghe/machine-spec`, whose `verb` plugin
was hand-written and is being replaced in place.

## The ordering rule

**A directory marketplace loads from the working tree, not from a cache.** If the
plugin you are replacing is registered that way — `claude plugin marketplace list`
says `Source: Directory (…)` — then deleting its files takes `/<name>:*` down
*immediately*, in every open session, before anything replaces it.

So the hand-written plugin is deleted **last**, in its own change, after the
generated one is installed and verified. Every step below is ordered around that.

(The same mechanism is why deleting a `commands/*.md` makes that command vanish
from a running session with no rebuild: the marketplace is your checkout.)

## Prerequisites

- **`src` must carry its own `node_modules`.** `bun build` runs in the nix sandbox
  with no network. machine-spec commits its `node_modules` (19,076 files, no
  `.gitignore`), so flake `self` carries the closure. If yours are gitignored, the
  build fails on the first unresolvable import — commit them or vendor differently.
  Note that `src = self` is the **git-tracked** tree, not your working tree; a
  partially-committed `node_modules` builds locally and fails in the flake.
- **Inventory what the old plugin carries besides commands.** Commands are
  generated from the registry; **nothing else is**. Ask the plugin itself:
  ```sh
  claude plugin details <name>@<marketplace>
  ```
  Hooks come across via `hooks` (below). Agents, skills, and LSP servers have no
  equivalent yet — if the inventory lists any, stop and add support before you
  disable the old plugin, not after. Missing this is how a `SessionStart` hook
  disappears silently: the six commands and the MCP server all arrive, the
  migration looks complete, and the thing that ran at session start is gone.
- **Know your assets.** Grep for module-relative reads:
  ```sh
  grep -rn 'import.meta.url' src/
  ```
  Every path reached that way must be listed in `assets`. See the asset layout
  note in the README for why.

## 1. Add the input and expose the package

```nix
inputs.verb-router.url = "github:bounded-systems/verb-router";
inputs.verb-router.inputs.nixpkgs.follows = "nixpkgs";

packages.${system}.plugin = verb-router.lib.${system}.mkVerbPlugin {
  name = "verb";
  version = "0.6.0";
  description = "…";
  owner = { name = "…"; };
  src = self;
  registries = [ { path = "src/registry.ts"; } ];
  assets = [ "context" "shapes" "HANDBOOK.md" ];
  marketplaceName = "verb-router";
};
```

Verify before going further — the built plugin should serve real data from the
store, with no dependency on your checkout:

```sh
nix build .#plugin
cd / && printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | <repo>/result/verb/bin/verb-mcp | tail -1
```

Running from `cwd=/` is the point: it proves the bundle resolves its assets out
of the store rather than out of the directory you happen to be standing in.

## 2. Gate it in CI

Nothing gates `.#plugin` unless you add it. A test suite that runs your own
scripts will stay green while a registry change breaks the bundle, or a
verb-router bump breaks generation — and you find out at the next switch.

Build it, then assert the output is *complete*; a build that succeeds says
nothing about what the generator wrote:

```yaml
- run: nix build .#plugin --print-build-logs
- run: |
    test -f result/.claude-plugin/marketplace.json
    test -f result/verb/.mcp.json
    test -x result/verb/bin/verb-mcp
    test "$(ls result/verb/commands/*.md | wc -l)" -ge 6
    grep -q '"/nix/store/' result/verb/.mcp.json
```

## 3. Ship the module

Follow the house pattern — the input ships the module that installs it — so the
consuming config's diff is a version bump and nothing else:

```nix
homeManagerModules.default = { ... }: {
  imports = [ verb-router.homeManagerModules.default ];
  programs.verbRouter = {
    enable = true;
    plugins = [ self.packages.${system}.plugin ];
  };
};
```

`homeManagerModules.default` is a function of its module arguments, but it closes
over the flake's `outputs` scope, so `verb-router` and `self` are both in reach.

Evaluating the module is not enough to know it works — `nix eval` will happily
return `lambda` for something that fails to build. Build the consuming
configuration.

## 4. Switch

```sh
nix build .#homeConfigurations.<user>.activationPackage   # verify FIRST
home-manager switch --flake .#<user>                      # never filter the output
```

**If the input is pinned with the rev inside the URL** —
`git+https://…?ref=main&rev=<sha>`, the form private repos need — then
`nix flake update <input>` **does nothing**: `flake.lock`'s `original` block
carries the rev, so it re-resolves to the same immutable reference. Hand-edit the
rev in `flake.nix`, then `nix flake lock`, then confirm it actually moved:

```sh
nix flake metadata --json | jq -r '.locks.nodes["<input>"].locked.rev'
```

This is the single most likely place the migration quietly does nothing.

## 5. Register and flip

The generated output is simultaneously a marketplace and the plugin it lists, and
a read-only store path works fine as a directory marketplace. The Home Manager
module links it to a stable path so registration survives rebuilds:

```sh
claude plugin marketplace add ~/.config/claude/plugins/nix/verb
claude plugin install verb@verb-router
claude plugin disable verb@machine-spec
```

**Check first whether your config already manages this declaratively.** On phobos
it did — `home/programs/claude-plugins.nix` owns `extraKnownMarketplaces` and
`enabledPlugins` and merges them into `settings.json` on activation. Doing it
there beats hand-editing, and survives the next switch.

Two things bite if it does:

- **The merge may be additive.** That module uses `jq '. * $add'`, so *removing*
  a plugin from the nix set leaves it in `settings.json` at its old value.
  Disable the predecessor explicitly — `"verb@machine-spec" = false;` — never by
  deleting the key. Leaving both `true` gives you two plugins with the same name
  and duplicate commands.
- **Declared is not registered.** With the marketplace declared in
  `extraKnownMarketplaces`, `claude plugin install` still failed with *"not found
  in marketplace"* until one `claude plugin marketplace add <path>` materialized
  it into `known_marketplaces.json`.

The generated `CLAUDE.md`'s plugin list is derived from `settings.json`, so it
corrects itself at the next regeneration — there is no second file to edit.

Confirm in a **fresh** session — plugin state is read at session start:

```sh
claude plugin list
```

## 6. Delete the hand-written plugin

Only now, and in its own change: remove `plugin/` and its entry from the repo's
`.claude-plugin/marketplace.json`.

Keep the repo registered as a directory marketplace for development if you still
want live-reload while authoring verbs; the generated plugin is the installed
path, the directory one is the working copy.

## Rollback

Before step 6 the hand-written plugin is still on disk, so rollback is:

```sh
claude plugin uninstall verb@verb-router
claude plugin enable verb@machine-spec
```

plus reverting the two config files. After step 6, roll back the commit that
deleted `plugin/`. This is the reason step 6 is last and alone.
