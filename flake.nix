{
  description = "verb-router: compose verbspec registries into one nix-generated Claude Code plugin — a router MCP server plus generated /<name>:* commands and a marketplace";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # The builder. A consumer repo adds verb-router as an input and calls this with its own
      # registries; see README.md. `routerSrc` is pinned to this flake, so the router the plugin
      # runs is always the one the consumer locked.
      lib = forAllSystems (pkgs: {
        mkVerbPlugin = import ./nix/mkVerbPlugin.nix {
          inherit pkgs;
          routerSrc = "${self}/src";
        };
      });

      # Consumers wire the generated plugin in with this: it registers the store path as a
      # directory marketplace and installs the plugin from it, both declaratively.
      homeManagerModules.default = import ./modules/home-manager.nix;

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell { packages = [ pkgs.bun pkgs.nixpkgs-fmt ]; };
      });

      formatter = forAllSystems (pkgs: pkgs.nixpkgs-fmt);
    };
}
