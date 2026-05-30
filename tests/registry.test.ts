import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { parseRegistry, RegistryError, type Registry, type Project, type Target } from "../src/registry/schema.js";
import {
  resolveRegistryPath,
  loadRegistry,
  saveRegistry,
  findProject,
  findTarget,
  addProject,
  removeProject,
  listProjects,
  upsertTarget,
} from "../src/registry/store.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

const baseTarget: Target = {
  repo: "https://github.com/user/blog",
  branch: "main",
  content_path: "content/blog/{YYYY-MM-DD}/{slug}/index.mdx",
  local_clone: "~/.bumper/blog",
};

const baseProject: Project = {
  name: "lumaweave",
  path: "/home/user/lumaweave",
  remote: "https://github.com/user/lumaweave",
  target: "default",
};

const baseRegistry: Registry = {
  targets: { default: baseTarget },
  project: [baseProject],
};

// ── parseRegistry ──────────────────────────────────────────────────────────

describe("parseRegistry", () => {
  it("accepts a valid registry and returns typed data", () => {
    const result = parseRegistry({
      targets: { default: baseTarget },
      project: [baseProject],
    });
    expect(result.project[0].name).toBe("lumaweave");
    expect(result.targets["default"].branch).toBe("main");
  });

  it("accepts an empty registry (no targets, no projects)", () => {
    const result = parseRegistry({});
    expect(result.project).toEqual([]);
    expect(result.targets).toEqual({});
  });

  it("applies default branch 'main' when omitted", () => {
    const result = parseRegistry({
      targets: {
        default: {
          repo: "https://github.com/user/blog",
          content_path: "content/{slug}/index.mdx",
          local_clone: "~/.bumper/blog",
        },
      },
      project: [],
    });
    expect(result.targets["default"].branch).toBe("main");
  });

  it("applies default remote '' when omitted", () => {
    const result = parseRegistry({
      targets: { default: baseTarget },
      project: [{ name: "myproject", path: "/home/user/myproject", target: "default" }],
    });
    expect(result.project[0].remote).toBe("");
  });

  it("applies default target 'default' when omitted", () => {
    const result = parseRegistry({
      targets: { default: baseTarget },
      project: [{ name: "myproject", path: "/home/user/myproject" }],
    });
    expect(result.project[0].target).toBe("default");
  });

  it("throws RegistryError for a bad repo URL", () => {
    expect(() =>
      parseRegistry({
        targets: { default: { ...baseTarget, repo: "not-a-url" } },
        project: [],
      }),
    ).toThrow(RegistryError);
  });

  it("throws RegistryError for an empty project name", () => {
    expect(() =>
      parseRegistry({
        targets: { default: baseTarget },
        project: [{ name: "", path: "/home/user/p", target: "default" }],
      }),
    ).toThrow(RegistryError);
  });

  it("throws RegistryError for a missing project path", () => {
    expect(() =>
      parseRegistry({
        targets: { default: baseTarget },
        project: [{ name: "myproject", target: "default" }],
      }),
    ).toThrow(RegistryError);
  });

  it("RegistryError has name='RegistryError'", () => {
    try {
      parseRegistry({ targets: { default: { ...baseTarget, repo: "bad" } }, project: [] });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryError);
      expect((e as RegistryError).name).toBe("RegistryError");
    }
  });

  it("error message names the invalid field path", () => {
    try {
      parseRegistry({
        targets: { default: { ...baseTarget, repo: "bad-url" } },
        project: [],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as RegistryError).message).toContain("targets.default.repo");
    }
  });
});

// ── resolveRegistryPath ────────────────────────────────────────────────────

describe("resolveRegistryPath", () => {
  it("returns the override path when given", () => {
    const p = resolveRegistryPath("/custom/path/projects.toml");
    expect(p).toBe("/custom/path/projects.toml");
  });

  it("defaults to ~/.bumper/projects.toml", () => {
    const p = resolveRegistryPath();
    expect(p).toMatch(/\.bumper[/\\]projects\.toml$/);
    expect(p).not.toContain("~");
  });
});

// ── loadRegistry / saveRegistry ────────────────────────────────────────────

describe("loadRegistry", () => {
  it("returns an empty valid registry for a nonexistent path (does not throw)", () => {
    const result = loadRegistry("/nonexistent/path/projects.toml");
    expect(result.project).toEqual([]);
    expect(result.targets).toEqual({});
  });
});

describe("saveRegistry → loadRegistry round-trip", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bumper-registry-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("round-trips a registry with projects and targets faithfully", () => {
    const path = join(tempDir, "projects.toml");
    const registry: Registry = {
      targets: {
        default: baseTarget,
        secondary: {
          repo: "https://github.com/user/other",
          branch: "dev",
          content_path: "posts/{slug}/index.mdx",
          local_clone: "~/.bumper/other",
        },
      },
      project: [
        baseProject,
        {
          name: "cerebra",
          path: "/home/user/cerebra",
          remote: "",
          target: "secondary",
        },
      ],
    };

    saveRegistry(registry, path);
    const loaded = loadRegistry(path);

    expect(loaded.project).toHaveLength(2);
    expect(loaded.project[0].name).toBe("lumaweave");
    expect(loaded.project[1].name).toBe("cerebra");
    expect(loaded.targets["default"].repo).toBe(baseTarget.repo);
    expect(loaded.targets["secondary"].branch).toBe("dev");
  });

  it("round-trips an empty registry without throwing", () => {
    const path = join(tempDir, "projects.toml");
    saveRegistry({ targets: {}, project: [] }, path);
    const loaded = loadRegistry(path);
    expect(loaded.project).toEqual([]);
    expect(loaded.targets).toEqual({});
  });

  it("saveRegistry creates the parent directory if it does not exist", () => {
    const nested = join(tempDir, "deep", "nested", "projects.toml");
    saveRegistry({ targets: {}, project: [] }, nested);
    const loaded = loadRegistry(nested);
    expect(loaded.project).toEqual([]);
  });

  it("saveRegistry validates before writing — rejects invalid registry", () => {
    const path = join(tempDir, "projects.toml");
    expect(() =>
      saveRegistry(
        {
          targets: { default: { ...baseTarget, repo: "not-a-url" } },
          project: [],
        },
        path,
      ),
    ).toThrow(RegistryError);
  });
});

// ── TOML shape round-trip (smol-toml [[project]] / [targets.x] mapping) ───

describe("TOML shape", () => {
  it("stringifies to [[project]] array-of-tables and [targets.x] sub-tables", () => {
    const registry: Registry = {
      targets: {
        default: baseTarget,
        other: { ...baseTarget, branch: "dev", local_clone: "~/.bumper/other" },
      },
      project: [
        baseProject,
        { name: "cerebra", path: "/home/user/cerebra", remote: "", target: "other" },
      ],
    };

    const toml = stringifyTOML(registry as Record<string, unknown>);
    expect(toml).toContain("[[project]]");
    expect(toml).toContain("[targets.default]");
    expect(toml).toContain("[targets.other]");

    const reparsed = parseRegistry(parseTOML(toml));
    expect(reparsed.project).toHaveLength(2);
    expect(reparsed.project[0].name).toBe("lumaweave");
    expect(reparsed.project[1].name).toBe("cerebra");
    expect(reparsed.targets["default"].repo).toBe(baseTarget.repo);
    expect(reparsed.targets["other"].branch).toBe("dev");
  });
});

// ── Query helpers ──────────────────────────────────────────────────────────

describe("findProject", () => {
  it("returns the project when found", () => {
    const p = findProject(baseRegistry, "lumaweave");
    expect(p?.name).toBe("lumaweave");
  });

  it("returns undefined when not found", () => {
    expect(findProject(baseRegistry, "nonexistent")).toBeUndefined();
  });
});

describe("findTarget", () => {
  it("returns the target when found", () => {
    const t = findTarget(baseRegistry, "default");
    expect(t?.repo).toBe(baseTarget.repo);
  });

  it("returns undefined when not found", () => {
    expect(findTarget(baseRegistry, "missing")).toBeUndefined();
  });
});

describe("listProjects", () => {
  it("returns all enrolled projects", () => {
    const list = listProjects(baseRegistry);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("lumaweave");
  });

  it("returns empty array for an empty registry", () => {
    expect(listProjects({ targets: {}, project: [] })).toEqual([]);
  });
});

// ── Mutation helpers ───────────────────────────────────────────────────────

describe("addProject", () => {
  it("appends a new project and returns a new registry", () => {
    const newProject: Project = {
      name: "cerebra",
      path: "/home/user/cerebra",
      remote: "",
      target: "default",
    };
    const updated = addProject(baseRegistry, newProject);
    expect(updated.project).toHaveLength(2);
    expect(updated.project[1].name).toBe("cerebra");
  });

  it("does not mutate the input registry", () => {
    const newProject: Project = { name: "cerebra", path: "/p", remote: "", target: "default" };
    addProject(baseRegistry, newProject);
    expect(baseRegistry.project).toHaveLength(1);
  });

  it("throws RegistryError for a duplicate project name", () => {
    expect(() => addProject(baseRegistry, baseProject)).toThrow(RegistryError);
  });

  it("duplicate error message names the project", () => {
    try {
      addProject(baseRegistry, baseProject);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as RegistryError).message).toContain("lumaweave");
    }
  });
});

describe("removeProject", () => {
  it("removes a project and returns a new registry", () => {
    const updated = removeProject(baseRegistry, "lumaweave");
    expect(updated.project).toHaveLength(0);
  });

  it("does not mutate the input registry", () => {
    removeProject(baseRegistry, "lumaweave");
    expect(baseRegistry.project).toHaveLength(1);
  });

  it("throws RegistryError for a project that is not enrolled", () => {
    expect(() => removeProject(baseRegistry, "nonexistent")).toThrow(RegistryError);
  });

  it("missing name error message names the project", () => {
    try {
      removeProject(baseRegistry, "ghost");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as RegistryError).message).toContain("ghost");
    }
  });
});

describe("upsertTarget", () => {
  it("adds a new target by name", () => {
    const newTarget: Target = {
      repo: "https://github.com/user/other",
      branch: "dev",
      content_path: "posts/{slug}/index.mdx",
      local_clone: "~/.bumper/other",
    };
    const updated = upsertTarget(baseRegistry, "secondary", newTarget);
    expect(Object.keys(updated.targets)).toHaveLength(2);
    expect(updated.targets["secondary"].branch).toBe("dev");
  });

  it("replaces an existing target by name", () => {
    const replacement: Target = { ...baseTarget, branch: "staging" };
    const updated = upsertTarget(baseRegistry, "default", replacement);
    expect(Object.keys(updated.targets)).toHaveLength(1);
    expect(updated.targets["default"].branch).toBe("staging");
  });

  it("does not mutate the input registry", () => {
    upsertTarget(baseRegistry, "default", { ...baseTarget, branch: "staging" });
    expect(baseRegistry.targets["default"].branch).toBe("main");
  });
});
