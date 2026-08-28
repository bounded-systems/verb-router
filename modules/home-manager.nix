# Home Manager wiring for mkVerbPlugin outputs.
#
# The generated plugin is an immutable store path, but Claude Code records a marketplace by the
# path it was added under — so adding a store path directly would need re-adding on every rebuild.
# This module gives each plugin a STABLE path that nix repoints:
#
#   ~/.config/claude/plugins/nix/<name>  ->  /nix/store/...-<name>-plugin-<version>
#
# Register that stable path once and every subsequent switch updates the plugin underneath it:
#
#   claude plugin marketplace add ~/.config/claude/plugins/nix/<name>
#   claude plugin install <name>@<marketplaceName>
#
# Registration is deliberately left as a one-time manual step rather than an activation script:
# Claude Code owns known_marketplaces.json / installed_plugins.json and rewrites them from the
# CLI, so having nix also write them would put two writers on the same files.

{ config, lib, ... }:

let
  cfg = config.programs.verbRouter;
  inherit (lib) mkOption mkEnableOption mkIf types;

  linkFor = drv:
    let name = drv.passthru.name or (throw "verb-router: plugin derivation has no passthru.name — was it built by mkVerbPlugin?");
    in {
      name = ".config/claude/plugins/nix/${name}";
      value = { source = drv; };
    };
in
{
  options.programs.verbRouter = {
    enable = mkEnableOption "verb-router generated Claude Code plugins";

    plugins = mkOption {
      type = types.listOf types.package;
      default = [ ];
      description = ''
        Plugin derivations produced by `mkVerbPlugin`. Each is linked to a stable path under
        `~/.config/claude/plugins/nix/<name>` for one-time marketplace registration.
      '';
    };
  };

  config = mkIf cfg.enable {
    home.file = builtins.listToAttrs (map linkFor cfg.plugins);
  };
}
