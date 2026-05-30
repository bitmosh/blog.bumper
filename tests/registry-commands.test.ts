import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

vi.mock("@inquirer/prompts", () => ({
  input:    vi.fn(),
  confirm:  vi.fn(),
  select:   vi.fn(),
  checkbox: vi.fn(),
}));

import * as inquirer from "@inquirer/prompts";
import {
  addProjectCmd,
  listProjectsCmd,
  infoProjectCmd,
  removeProjectCmd,
} from "../src/registry/commands.js";
import { loadRegistry, saveRegistry } from "../src/registry/store.js";

const mockConfirm = vi.mocked(inquirer.confirm);
const mockInput   = vi.mocked(inquirer.input);

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
}
function gitRemoteAdd(dir: string, url: string): void {
  execSync(`git remote add origin ${url}`, { cwd: dir, stdio: "ignore" });
}

describe("project-add", () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "bumper-cmd-test-"));
    registryPath = join(tempDir, "projects.toml");
  });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("enrolls a valid git repo via --path flag", async () => {
    const repoDir = join(tempDir, "myrepo");
    mkdirSync(repoDir);
    gitInit(repoDir);
    gitRemoteAdd(repoDir, "https://github.com/user/myrepo.git");

    await addProjectCmd("myrepo", { path: repoDir }, registryPath);

    const registry = loadRegistry(registryPath);
    expect(registry.project).toHaveLength(1);
    expect(registry.project[0].name).toBe("myrepo");
    expect(registry.project[0].path).toBe(repoDir);
    expect(registry.project[0].remote).toBe("https://github.com/user/myrepo.git");
    expect(registry.project[0].target).toBe("default");
  });

  it("enrolls a local-only repo (no remote) with remote ''", async () => {
    const repoDir = join(tempDir, "local-only");
    mkdirSync(repoDir);
    gitInit(repoDir);

    await addProjectCmd("local-only", { path: repoDir }, registryPath);

    const registry = loadRegistry(registryPath);
    expect(registry.project[0].remote).toBe("");
  });

  it("prompts for path when --path flag is absent", async () => {
    const repoDir = join(tempDir, "prompted");
    mkdirSync(repoDir);
    gitInit(repoDir);
    mockInput.mockResolvedValueOnce(repoDir as never);

    await addProjectCmd("prompted", {}, registryPath);

    expect(mockInput).toHaveBeenCalledOnce();
    const registry = loadRegistry(registryPath);
    expect(registry.project[0].name).toBe("prompted");
  });

  it("throws on nonexistent path", async () => {
    await expect(
      addProjectCmd("ghost", { path: "/nonexistent/path/bumper-99999" }, registryPath),
    ).rejects.toThrow("path not found");
  });

  it("throws on a path that is not a git repo", async () => {
    const notRepo = join(tempDir, "not-a-repo");
    mkdirSync(notRepo);

    await expect(
      addProjectCmd("notrepo", { path: notRepo }, registryPath),
    ).rejects.toThrow("not a git repository");
  });

  it("throws on duplicate project name (does not crash the registry)", async () => {
    const repoDir = join(tempDir, "dup");
    mkdirSync(repoDir);
    gitInit(repoDir);

    await addProjectCmd("dup", { path: repoDir }, registryPath);
    await expect(
      addProjectCmd("dup", { path: repoDir }, registryPath),
    ).rejects.toThrow("already enrolled");

    // Registry is not corrupted — still has exactly one entry
    const registry = loadRegistry(registryPath);
    expect(registry.project).toHaveLength(1);
  });
});

describe("project-list", () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "bumper-cmd-test-"));
    registryPath = join(tempDir, "projects.toml");
  });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("prints friendly message for empty registry (does not throw)", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => listProjectsCmd(registryPath)).not.toThrow();
    expect(logs.some((l) => l.toLowerCase().includes("no projects"))).toBe(true);

    vi.restoreAllMocks();
  });

  it("lists enrolled projects", async () => {
    const repoDir = join(tempDir, "listed");
    mkdirSync(repoDir);
    gitInit(repoDir);
    await addProjectCmd("listed", { path: repoDir }, registryPath);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    listProjectsCmd(registryPath);
    expect(logs.some((l) => l.includes("listed"))).toBe(true);

    vi.restoreAllMocks();
  });
});

describe("project-info", () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "bumper-cmd-test-"));
    registryPath = join(tempDir, "projects.toml");
  });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("throws for an unknown project name", () => {
    expect(() => infoProjectCmd("ghost", registryPath)).toThrow("not found");
  });

  it("prints project details and surfaces missing target without crashing", async () => {
    const repoDir = join(tempDir, "info-test");
    mkdirSync(repoDir);
    gitInit(repoDir);
    await addProjectCmd("info-test", { path: repoDir }, registryPath);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    // No target defined in registry → should surface the gap, not crash
    expect(() => infoProjectCmd("info-test", registryPath)).not.toThrow();
    expect(logs.some((l) => l.includes("info-test"))).toBe(true);
    expect(logs.some((l) => l.includes("default") && l.includes("not defined"))).toBe(true);

    vi.restoreAllMocks();
  });

  it("shows resolved target when defined in registry", async () => {
    const repoDir = join(tempDir, "with-target");
    mkdirSync(repoDir);
    gitInit(repoDir);
    await addProjectCmd("with-target", { path: repoDir }, registryPath);

    // Add a target to the registry manually
    const registry = loadRegistry(registryPath);
    saveRegistry(
      {
        ...registry,
        targets: {
          default: {
            repo: "https://github.com/user/blog",
            branch: "main",
            content_path: "content/{slug}/index.mdx",
            local_clone: "~/.bumper/blog",
          },
        },
      },
      registryPath,
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => infoProjectCmd("with-target", registryPath)).not.toThrow();
    expect(logs.some((l) => l.includes("https://github.com/user/blog"))).toBe(true);

    vi.restoreAllMocks();
  });
});

describe("project-remove", () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "bumper-cmd-test-"));
    registryPath = join(tempDir, "projects.toml");
  });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("removes a project with --yes flag (no prompt)", async () => {
    const repoDir = join(tempDir, "to-remove");
    mkdirSync(repoDir);
    gitInit(repoDir);
    await addProjectCmd("to-remove", { path: repoDir }, registryPath);

    await removeProjectCmd("to-remove", { yes: true }, registryPath);

    const registry = loadRegistry(registryPath);
    expect(registry.project).toHaveLength(0);
  });

  it("removes a project after confirm prompt", async () => {
    const repoDir = join(tempDir, "to-remove-confirm");
    mkdirSync(repoDir);
    gitInit(repoDir);
    await addProjectCmd("to-remove-confirm", { path: repoDir }, registryPath);

    mockConfirm.mockResolvedValueOnce(true as never);
    await removeProjectCmd("to-remove-confirm", {}, registryPath);

    const registry = loadRegistry(registryPath);
    expect(registry.project).toHaveLength(0);
  });

  it("does nothing when user declines confirmation", async () => {
    const repoDir = join(tempDir, "keeper");
    mkdirSync(repoDir);
    gitInit(repoDir);
    await addProjectCmd("keeper", { path: repoDir }, registryPath);

    mockConfirm.mockResolvedValueOnce(false as never);
    await removeProjectCmd("keeper", {}, registryPath);

    const registry = loadRegistry(registryPath);
    expect(registry.project).toHaveLength(1);
  });

  it("throws for an unknown project name", async () => {
    await expect(
      removeProjectCmd("ghost", { yes: true }, registryPath),
    ).rejects.toThrow("not found");
  });

  it("project directory on disk is untouched after remove", async () => {
    const repoDir = join(tempDir, "disk-check");
    mkdirSync(repoDir);
    gitInit(repoDir);
    await addProjectCmd("disk-check", { path: repoDir }, registryPath);

    await removeProjectCmd("disk-check", { yes: true }, registryPath);

    // Registry entry gone, but directory still exists
    const registry = loadRegistry(registryPath);
    expect(registry.project).toHaveLength(0);
    expect(existsSync(repoDir)).toBe(true);
  });
});
