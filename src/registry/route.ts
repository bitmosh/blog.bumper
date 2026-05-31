import type { Registry, Target } from "./schema.js";
import type { Config } from "../config.js";

export class RouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteError";
  }
}

export type ResolvedRoute = {
  module: string;
  target: Target;
  source: "registry" | "legacy";
};

/**
 * Determines the module name and target destination for a parsed report.
 *
 * Registry lookup: match projectName against enrolled projects → resolve their target.
 * Fallback: no registry, empty registry, or no matching project → identical to 0.1.0 behavior.
 *
 * Throws RouteError only when the project IS enrolled but its target is missing — that is a
 * configuration error the user must fix, not a silent fallback.
 */
export function resolveRoute(
  projectName: string,
  registry: Registry,
  legacyConfig: Config,
): ResolvedRoute {
  if (registry.project.length === 0) {
    return legacy(legacyConfig);
  }

  const project = registry.project.find((p) => p.name === projectName);
  if (!project) {
    return legacy(legacyConfig);
  }

  const target = registry.targets[project.target];
  if (!target) {
    // "default" with no explicit [targets.default] in registry → bridge to legacy config target.
    // Single-target setups never need to define [targets.default] explicitly.
    if (project.target === "default") {
      return {
        module: project.name,
        target: legacyConfig.target,
        source: "registry",
      };
    }
    throw new RouteError(
      `Project "${projectName}" references target "${project.target}" which is not defined in the registry — ` +
        `run \`bumper init\` to configure targets.`,
    );
  }

  return {
    module: project.name,
    target,
    source: "registry",
  };
}

function legacy(config: Config): ResolvedRoute {
  return {
    module: config.source.module,
    target: config.target,
    source: "legacy",
  };
}
