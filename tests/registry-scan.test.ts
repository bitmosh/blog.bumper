import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { scanForRepos } from "../src/registry/scan.js";

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
}

function gitRemoteAdd(dir: string, url: string): void {
  execSync(`git remote add origin ${url}`, { cwd: dir, stdio: "ignore" });
}

describe("scanForRepos", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bumper-scan-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns exactly the git repos, skipping non-git subdirs, sorted by name", () => {
    mkdirSync(join(tempDir, "alpha-repo"));
    gitInit(join(tempDir, "alpha-repo"));
    mkdirSync(join(tempDir, "beta-repo"));
    gitInit(join(tempDir, "beta-repo"));
    mkdirSync(join(tempDir, "gamma-folder")); // no git init

    const results = scanForRepos(tempDir);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("alpha-repo");
    expect(results[1].name).toBe("beta-repo");
  });

  it("returns the origin URL when a remote is configured", () => {
    const repoDir = join(tempDir, "with-remote");
    mkdirSync(repoDir);
    gitInit(repoDir);
    gitRemoteAdd(repoDir, "https://github.com/user/with-remote.git");

    const results = scanForRepos(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].remote).toBe("https://github.com/user/with-remote.git");
  });

  it("returns null remote when no origin is configured (not an error)", () => {
    const repoDir = join(tempDir, "no-remote");
    mkdirSync(repoDir);
    gitInit(repoDir);

    const results = scanForRepos(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].remote).toBeNull();
  });

  it("detects .git FILE (worktree style) as a valid repo", () => {
    const repoDir = join(tempDir, "worktree-repo");
    mkdirSync(repoDir);
    // git writes a .git FILE (not directory) for worktrees and submodules
    writeFileSync(join(repoDir, ".git"), "gitdir: /some/nonexistent/.git\n");

    const results = scanForRepos(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("worktree-repo");
    expect(results[0].remote).toBeNull(); // fake gitdir → remote lookup fails → null
  });

  it("skips plain files in the scan directory", () => {
    const repoDir = join(tempDir, "real-repo");
    mkdirSync(repoDir);
    gitInit(repoDir);
    writeFileSync(join(tempDir, "somefile.txt"), "not a directory");
    writeFileSync(join(tempDir, "another.toml"), "[section]\nkey = 'value'");

    const results = scanForRepos(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("real-repo");
  });

  it("throws a clear error for a nonexistent scan directory", () => {
    expect(() => scanForRepos("/nonexistent/path/bumper-scan-99999")).toThrow(
      "scan directory not found",
    );
  });

  it("returns empty array for an existing but empty directory", () => {
    const results = scanForRepos(tempDir);
    expect(results).toEqual([]);
  });

  it("results are sorted by name, name equals basename, path is absolute", () => {
    for (const d of ["zebra", "apple", "mango"]) {
      const p = join(tempDir, d);
      mkdirSync(p);
      gitInit(p);
    }

    const results = scanForRepos(tempDir);
    expect(results.map((r) => r.name)).toEqual(["apple", "mango", "zebra"]);
    for (const r of results) {
      expect(r.path).toBe(join(tempDir, r.name));
      expect(r.path).toMatch(/^\//); // absolute
    }
  });

  it("non-git subdirs are excluded and do not affect git repo detection", () => {
    mkdirSync(join(tempDir, "not-a-repo"));
    mkdirSync(join(tempDir, "also-not-a-repo"));
    const repoDir = join(tempDir, "is-a-repo");
    mkdirSync(repoDir);
    gitInit(repoDir);

    const results = scanForRepos(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("is-a-repo");
  });
});
