import { describe, it, expect } from "vitest";
import { resolveRoute, RouteError } from "../src/registry/route.js";
import type { Registry } from "../src/registry/schema.js";
import type { Config } from "../src/config.js";

// ── fixtures ───────────────────────────────────────────────────────────────

const LEGACY_TARGET = {
  repo: "https://github.com/user/legacy-blog",
  branch: "main",
  content_path: "content/blog/{slug}/index.mdx",
  local_clone: "~/.bumper/legacy-blog",
};

const REGISTRY_TARGET = {
  repo: "https://github.com/user/registry-blog",
  branch: "main",
  content_path: "content/dev/{YYYY-MM-DD}/{slug}/index.mdx",
  local_clone: "~/.bumper/registry-blog",
};

function makeConfig(module = "legacymod"): Config {
  return {
    source: {
      module,
      report_channel: "discord://123/456",
      debug_channel: "discord://123/789",
      buffer: 1,
      token_env: "DISCORD_BOT_TOKEN",
    },
    target: LEGACY_TARGET,
    git: {
      author: "bot <bot@test.dev>",
      commit_template: "bump: {version}",
      push: "auto",
    },
    post: {
      status: "published",
      commentary: "empty",
      tag_strategy: "from-version",
      timezone: "America/Chicago",
    },
    guard: {
      fail_on_validation_error: true,
      fail_on_duplicate: false,
      skip_if_no_report: true,
      require_blog_ff: true,
    },
  };
}

function emptyRegistry(): Registry {
  return { targets: {}, project: [] };
}

function registryWith(projectName: string, targetName = "default"): Registry {
  return {
    targets: {
      [targetName]: REGISTRY_TARGET,
    },
    project: [
      { name: projectName, path: "/some/path", remote: "", target: targetName },
    ],
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("resolveRoute — legacy fallback", () => {
  it("returns legacy when registry has no projects", () => {
    const route = resolveRoute("myproject", emptyRegistry(), makeConfig());
    expect(route.source).toBe("legacy");
    expect(route.module).toBe("legacymod");
    expect(route.target).toEqual(LEGACY_TARGET);
  });

  it("returns legacy when project is not enrolled (registry has other projects)", () => {
    const registry = registryWith("other-project");
    const route = resolveRoute("myproject", registry, makeConfig());
    expect(route.source).toBe("legacy");
    expect(route.module).toBe("legacymod");
    expect(route.target).toEqual(LEGACY_TARGET);
  });

  it("legacy route module comes from config.source.module, not projectName", () => {
    const route = resolveRoute("completely-unknown", emptyRegistry(), makeConfig("configured-mod"));
    expect(route.module).toBe("configured-mod");
    expect(route.source).toBe("legacy");
  });

  it("legacy route target is config.target verbatim", () => {
    const route = resolveRoute("x", emptyRegistry(), makeConfig());
    expect(route.target.repo).toBe(LEGACY_TARGET.repo);
    expect(route.target.content_path).toBe(LEGACY_TARGET.content_path);
    expect(route.target.local_clone).toBe(LEGACY_TARGET.local_clone);
  });
});

describe("resolveRoute — registry hit", () => {
  it("returns registry source when project is enrolled", () => {
    const registry = registryWith("myproject");
    const route = resolveRoute("myproject", registry, makeConfig());
    expect(route.source).toBe("registry");
  });

  it("module is the enrolled project name (not configModule)", () => {
    const registry = registryWith("myproject");
    const route = resolveRoute("myproject", registry, makeConfig("something-else"));
    expect(route.module).toBe("myproject");
  });

  it("target is the registry target, not the legacy config target", () => {
    const registry = registryWith("myproject");
    const route = resolveRoute("myproject", registry, makeConfig());
    expect(route.target).toEqual(REGISTRY_TARGET);
    expect(route.target.repo).not.toBe(LEGACY_TARGET.repo);
  });

  it("resolves the correct named target when project references a non-default name", () => {
    const registry: Registry = {
      targets: {
        staging: {
          repo: "https://github.com/user/staging-blog",
          branch: "staging",
          content_path: "content/staging/{slug}/index.mdx",
          local_clone: "~/.bumper/staging-blog",
        },
      },
      project: [
        { name: "myproject", path: "/some/path", remote: "", target: "staging" },
      ],
    };
    const route = resolveRoute("myproject", registry, makeConfig());
    expect(route.source).toBe("registry");
    expect(route.target.branch).toBe("staging");
  });

  it("match is by exact project name (case-sensitive)", () => {
    const registry = registryWith("MyProject");
    const routeLower = resolveRoute("myproject", registry, makeConfig());
    expect(routeLower.source).toBe("legacy"); // no match — different case

    const routeExact = resolveRoute("MyProject", registry, makeConfig());
    expect(routeExact.source).toBe("registry");
  });
});

describe("resolveRoute — RouteError on dangling target ref", () => {
  it("throws RouteError when project is enrolled but target is missing", () => {
    const registry: Registry = {
      targets: {}, // target "default" is NOT defined
      project: [{ name: "myproject", path: "/some/path", remote: "", target: "default" }],
    };
    expect(() => resolveRoute("myproject", registry, makeConfig())).toThrow(RouteError);
  });

  it("error message names the project and the missing target", () => {
    const registry: Registry = {
      targets: {},
      project: [{ name: "orphan", path: "/p", remote: "", target: "missing-target" }],
    };
    expect(() => resolveRoute("orphan", registry, makeConfig())).toThrow("orphan");
    expect(() => resolveRoute("orphan", registry, makeConfig())).toThrow("missing-target");
  });

  it("does NOT throw RouteError for an unknown project even when registry has dangling entries", () => {
    // Unknown project → legacy fallback. The dangling entry should not affect the lookup.
    const registry: Registry = {
      targets: {},
      project: [{ name: "orphan", path: "/p", remote: "", target: "missing-target" }],
    };
    const route = resolveRoute("different-project", registry, makeConfig());
    expect(route.source).toBe("legacy");
  });
});

describe("resolveRoute — shape invariants", () => {
  it("legacy result always has all four target fields", () => {
    const route = resolveRoute("x", emptyRegistry(), makeConfig());
    expect(route.target).toHaveProperty("repo");
    expect(route.target).toHaveProperty("branch");
    expect(route.target).toHaveProperty("content_path");
    expect(route.target).toHaveProperty("local_clone");
  });

  it("registry result always has all four target fields", () => {
    const route = resolveRoute("myproject", registryWith("myproject"), makeConfig());
    expect(route.target).toHaveProperty("repo");
    expect(route.target).toHaveProperty("branch");
    expect(route.target).toHaveProperty("content_path");
    expect(route.target).toHaveProperty("local_clone");
  });
});
