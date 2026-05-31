import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkFF,
  buildCommitMessage,
  buildGitPlan,
  buildNonFFDebugMessage,
  GitError,
  bumpRepo,
  resolveClonePath,
} from "../src/git/driver.js";
import type { ParsedReport } from "../src/parser/index.js";
import type { Config } from "../src/config.js";

// ── helpers ────────────────────────────────────────────────────────────────

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function gitConfig(dir: string): void {
  exec(`git -C ${dir} config user.email "bumper-test@test.dev"`);
  exec(`git -C ${dir} config user.name "Bumper Test"`);
}

/**
 * Creates a bare remote with one commit, then clones it to cloneDir.
 * Bare remotes accept pushes to any branch, unlike non-bare repos.
 */
function setupRepoAndClone(remoteDir: string, cloneDir: string): void {
  // Create a non-bare source, commit, then clone --bare for the "remote"
  const sourceDir = remoteDir + "_src";
  exec(`git init -b main ${sourceDir}`);
  gitConfig(sourceDir);
  writeFileSync(join(sourceDir, "README.md"), "# test\n");
  exec(`git -C ${sourceDir} add README.md`);
  exec(`git -C ${sourceDir} commit -m "init"`);
  exec(`git clone --bare ${sourceDir} ${remoteDir}`);
  rmSync(sourceDir, { recursive: true, force: true });
  exec(`git clone ${remoteDir} ${cloneDir}`);
  gitConfig(cloneDir);
}

/** Adds a commit to the bare remote (simulates another user pushing). */
function addCommitToRemote(remoteDir: string, filename: string): void {
  const tempClone = mkdtempSync(join(tmpdir(), "bumper-remote-push-"));
  try {
    exec(`git clone ${remoteDir} ${tempClone}`);
    gitConfig(tempClone);
    writeFileSync(join(tempClone, filename), `# ${filename}\n`);
    exec(`git -C ${tempClone} add ${filename}`);
    exec(`git -C ${tempClone} commit -m "add ${filename}"`);
    exec(`git -C ${tempClone} push`);
  } finally {
    rmSync(tempClone, { recursive: true, force: true });
  }
}

/** Adds a commit to the clone without pushing. */
function addCommitToClone(cloneDir: string, filename: string): void {
  writeFileSync(join(cloneDir, filename), `# ${filename}\n`);
  exec(`git -C ${cloneDir} add ${filename}`);
  exec(`git -C ${cloneDir} commit -m "add ${filename}"`);
}

const BASE_REPORT: ParsedReport = {
  version: "v1.0",
  date: "2026-01-01",
  time: "00:00:00-06:00",
  title: "Test Report",
  slug: "v1-0-test-report",
  description: "A test description that is long enough to pass validation checks.",
  module: "general",
  highlights: ["First highlight item", "Second highlight item"],
  learnings: [],
  commit: "abc1234",
  tests: "1 passed",
  branch: "clean",
};

function makeConfig(cloneDir: string, remoteDir: string, overrides: Partial<Config> = {}): Config {
  return {
    source: {
      module: "general",
      report_channel: "discord://guild/channel",
      debug_channel: "discord://guild/debug",
      buffer: 1,
      token_env: "DISCORD_BOT_TOKEN",
    },
    target: {
      repo: remoteDir,
      branch: "main",
      content_path: "content/{YYYY-MM-DD}/{slug}/index.mdx",
      local_clone: cloneDir,
    },
    git: {
      author: "blog.bumper <bumper@bitmosh.dev>",
      commit_template: "bump: {version} → {date} ({title})",
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
    ...overrides,
  };
}

// ── Non-FF guard ────────────────────────────────────────────────────────────

describe("Non-FF guard", () => {
  let tempDir: string;
  let remoteDir: string;
  let cloneDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bumper-git-test-"));
    remoteDir = join(tempDir, "remote");
    cloneDir = join(tempDir, "clone");
    setupRepoAndClone(remoteDir, cloneDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("remote == local → ok (trivially FF-able)", async () => {
    const result = await checkFF(cloneDir, "main");
    expect(result.ok).toBe(true);
  });

  it("local ahead of remote → ok (clean FF)", async () => {
    addCommitToClone(cloneDir, "local-extra.md");
    const result = await checkFF(cloneDir, "main");
    expect(result.ok).toBe(true);
  });

  it("remote ahead of local → refused with subcase=behind", async () => {
    addCommitToRemote(remoteDir, "remote-extra.md");
    const result = await checkFF(cloneDir, "main");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.subcase).toBe("behind");
      expect(result.localSha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.remoteSha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.localSha).not.toBe(result.remoteSha);
    }
  });

  it("diverged (both have commits not in each other) → refused with subcase=diverged", async () => {
    addCommitToClone(cloneDir, "local-extra.md");
    addCommitToRemote(remoteDir, "remote-extra.md");
    // clone HEAD and origin/main now share an init commit as their only common ancestor
    // but neither is an ancestor of the other
    const result = await checkFF(cloneDir, "main");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.subcase).toBe("diverged");
    }
  });

  it("refused guard leaves working-tree file intact (no commit, no push)", async () => {
    addCommitToRemote(remoteDir, "remote-extra.md");
    const config = makeConfig(cloneDir, remoteDir);

    const relPath = "content/2026-01-01/v1-0-test-report/index.mdx";
    const absPath = join(cloneDir, relPath);

    await expect(bumpRepo(BASE_REPORT, config)).rejects.toThrow(GitError);

    // Working-tree file should exist (written before guard)
    expect(existsSync(absPath)).toBe(true);

    // No new commit in the clone (still at init commit + remote clone)
    const logCount = exec(`git -C ${cloneDir} rev-list HEAD --count`);
    expect(parseInt(logCount)).toBe(1); // only "init" commit
  });

  it("refused guard throws GitError with code=ff-refused", async () => {
    addCommitToRemote(remoteDir, "remote-extra.md");
    const config = makeConfig(cloneDir, remoteDir);

    try {
      await bumpRepo(BASE_REPORT, config);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GitError);
      expect((e as GitError).code).toBe("ff-refused");
    }
  });

  it("refused guard 'behind' message contains SHAs and git pull --ff-only recovery", async () => {
    addCommitToRemote(remoteDir, "remote-extra.md");
    const config = makeConfig(cloneDir, remoteDir);

    try {
      await bumpRepo(BASE_REPORT, config);
      expect.fail("should have thrown");
    } catch (e) {
      const msg = (e as GitError).message;
      expect(msg).toContain("not fast-forwardable");
      expect(msg).toContain("local:");
      expect(msg).toContain("remote:");
      expect(msg).toContain("git pull --ff-only");
      expect(msg).toContain("exit 1");
      expect(msg).not.toContain("diverged");
    }
  });

  it("refused guard 'diverged' message says diverged and does NOT suggest --ff-only", async () => {
    addCommitToClone(cloneDir, "local-extra.md");
    addCommitToRemote(remoteDir, "remote-extra.md");
    const config = makeConfig(cloneDir, remoteDir);

    try {
      await bumpRepo(BASE_REPORT, config);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GitError);
      expect((e as GitError).code).toBe("ff-refused");
      const msg = (e as GitError).message;
      expect(msg).toContain("diverged");
      expect(msg).not.toContain("--ff-only");
      expect(msg).toContain("exit 1");
    }
  });

  it("require_blog_ff=false logs warning and skips guard", async () => {
    addCommitToRemote(remoteDir, "remote-extra.md");
    const config = makeConfig(cloneDir, remoteDir, {
      guard: {
        fail_on_validation_error: true,
        fail_on_duplicate: false,
        skip_if_no_report: true,
        require_blog_ff: false,
      },
      git: { author: "blog.bumper <bumper@bitmosh.dev>", commit_template: "bump: {version} → {date} ({title})", push: "manual" },
    });
    // Should not throw even with remote ahead (guard disabled)
    const result = await bumpRepo(BASE_REPORT, config);
    expect(result.status).toBe("done");
  });
});

// ── Commit message templating ───────────────────────────────────────────────

describe("buildCommitMessage", () => {
  it("substitutes {version}, {date}, {title}", () => {
    const config = makeConfig("/clone", "/remote");
    const msg = buildCommitMessage(config, BASE_REPORT);
    expect(msg).toBe("bump: v1.0 → 2026-01-01 (Test Report)");
  });

  it("handles version with dots", () => {
    const config = makeConfig("/clone", "/remote");
    const msg = buildCommitMessage(config, { ...BASE_REPORT, version: "v98.7" });
    expect(msg).toContain("v98.7");
  });
});

// ── Path resolution ─────────────────────────────────────────────────────────

describe("buildGitPlan", () => {
  it("targetPath joins clone + content_path with substitutions", () => {
    const config = makeConfig("/tmp/clone", "/tmp/remote");
    const plan = buildGitPlan(config, BASE_REPORT);
    expect(plan.targetPath).toBe("/tmp/clone/content/2026-01-01/v1-0-test-report/index.mdx");
  });

  it("cloneOrPull is 'git clone' when clone doesn't exist", () => {
    const config = makeConfig("/tmp/definitely-does-not-exist-clone-xyz", "/tmp/remote");
    const plan = buildGitPlan(config, BASE_REPORT);
    expect(plan.cloneOrPull).toContain("git clone");
  });

  it("pushTarget includes repo URL and branch", () => {
    const config = makeConfig("/tmp/clone", "https://github.com/bitmosh/bumper-test");
    const plan = buildGitPlan(config, BASE_REPORT);
    expect(plan.pushTarget).toContain("https://github.com/bitmosh/bumper-test");
    expect(plan.pushTarget).toContain("main");
  });
});

// ── Safety guard ────────────────────────────────────────────────────────────


// ── Idempotency through git path ────────────────────────────────────────────

describe("idempotency through git path", () => {
  let tempDir: string;
  let remoteDir: string;
  let cloneDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bumper-git-idem-"));
    remoteDir = join(tempDir, "remote");
    cloneDir = join(tempDir, "clone");
    setupRepoAndClone(remoteDir, cloneDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("same commit already in clone → skipped", async () => {
    const config = makeConfig(cloneDir, remoteDir);

    // First bump succeeds
    const r1 = await bumpRepo(BASE_REPORT, config);
    expect(r1.status).toBe("done");

    // Second bump with same commit → skipped (duplicate)
    const r2 = await bumpRepo(BASE_REPORT, config);
    expect(r2.status).toBe("skipped");
    if (r2.status === "skipped") expect(r2.reason).toBe("duplicate");
  });

  it("push=dry-run commits but does not push to remote", async () => {
    const config = makeConfig(cloneDir, remoteDir, {
      git: {
        author: "blog.bumper <bumper@bitmosh.dev>",
        commit_template: "bump: {version} → {date} ({title})",
        push: "dry-run",
      },
    });

    await bumpRepo(BASE_REPORT, config);

    // Clone has the commit
    const cloneLog = exec(`git -C ${cloneDir} log --oneline`);
    expect(cloneLog).toContain("bump:");

    // Remote does not have the commit (push didn't happen)
    const remoteLog = exec(`git -C ${remoteDir} log --oneline`);
    expect(remoteLog).not.toContain("bump:");
  });
});

// ── Non-FF debug message format ─────────────────────────────────────────────

describe("buildNonFFDebugMessage", () => {
  it("'behind' message contains SHAs, --ff-only recovery, and exit 1", () => {
    const config = makeConfig("~/.bumper/bitmosh-website", "/tmp/remote");
    const msg = buildNonFFDebugMessage(
      config,
      BASE_REPORT,
      "behind",
      "abcdef1234567890abcdef1234567890abcdef12",
      "1234567890abcdef1234567890abcdef12345678",
    );
    expect(msg).toContain("not fast-forwardable");
    expect(msg).toContain(`version:   ${BASE_REPORT.version}`);
    expect(msg).toContain("local:     abcdef1");
    expect(msg).toContain("remote:    1234567");
    expect(msg).toContain("git pull --ff-only");
    expect(msg).toContain("exit 1");
    expect(msg).not.toContain("diverged");
  });

  it("'diverged' message says diverged, does NOT suggest --ff-only, contains exit 1", () => {
    const config = makeConfig("~/.bumper/bitmosh-website", "/tmp/remote");
    const msg = buildNonFFDebugMessage(
      config,
      BASE_REPORT,
      "diverged",
      "abcdef1234567890abcdef1234567890abcdef12",
      "1234567890abcdef1234567890abcdef12345678",
    );
    expect(msg).toContain("not fast-forwardable");
    expect(msg).toContain("diverged");
    expect(msg).not.toContain("--ff-only");
    expect(msg).toContain("exit 1");
  });

  it("expands ~ in the recovery command", () => {
    const config = makeConfig("~/.bumper/bitmosh-website", "/tmp/remote");
    const msg = buildNonFFDebugMessage(config, BASE_REPORT, "behind", "a".repeat(40), "b".repeat(40));
    // The clone path in the action line should be expanded (homedir), not raw ~
    expect(msg).toContain("cd /home/");
    expect(msg).not.toContain("cd ~");
  });
});
