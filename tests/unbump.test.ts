import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanBumpedPosts, unbumpPosts, contentBaseDir } from "../src/git/unbump.js";
import type { Config } from "../src/config.js";

// ── helpers ────────────────────────────────────────────────────────────────

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function gitConfig(dir: string): void {
  exec(`git -C ${dir} config user.email "unbump-test@test.dev"`);
  exec(`git -C ${dir} config user.name "Unbump Test"`);
}

function setupBlogRepo(remoteDir: string, cloneDir: string): void {
  const sourceDir = remoteDir + "_src";
  exec(`git init -b main ${sourceDir}`);
  gitConfig(sourceDir);
  writeFileSync(join(sourceDir, "README.md"), "# blog\n");
  exec(`git -C ${sourceDir} add README.md`);
  exec(`git -C ${sourceDir} commit -m "init"`);
  exec(`git clone --bare ${sourceDir} ${remoteDir}`);
  rmSync(sourceDir, { recursive: true, force: true });
  exec(`git clone ${remoteDir} ${cloneDir}`);
  gitConfig(cloneDir);
}

const CONTENT_BASE = "content/blog/dev";
const CONTENT_PATH = `${CONTENT_BASE}/{YYYY-MM-DD}/{slug}/index.mdx`;

function addPost(
  cloneDir: string,
  dateSlug: string,
  slug: string,
  frontmatter: Record<string, string>,
): string {
  const postDir = join(cloneDir, CONTENT_BASE, dateSlug, slug);
  mkdirSync(postDir, { recursive: true });
  const mdx = [
    "---",
    ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    "---",
    "",
    "Content here.",
  ].join("\n");
  const postPath = join(postDir, "index.mdx");
  writeFileSync(postPath, mdx);
  exec(`git -C ${cloneDir} add ${CONTENT_BASE}/${dateSlug}/${slug}`);
  exec(`git -C ${cloneDir} commit -m "bump: ${frontmatter.version ?? "v1"} ${slug}"`);
  exec(`git -C ${cloneDir} push`);
  return postPath;
}

function makeConfig(cloneDir: string, remoteDir: string): Config {
  return {
    source: {
      module: "general",
      changelog_channel: "discord://guild/channel",
      debug_channel: "discord://guild/debug",
      buffer: 1,
      token_env: "DISCORD_BOT_TOKEN",
    },
    target: {
      repo: remoteDir,
      branch: "main",
      content_path: CONTENT_PATH,
      local_clone: cloneDir,
    },
    git: {
      author: "blog.bumper <bumper@test.dev>",
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
  };
}

// ── contentBaseDir ──────────────────────────────────────────────────────────

describe("contentBaseDir", () => {
  it("extracts the static prefix before the first template token", () => {
    expect(contentBaseDir("content/blog/dev/{YYYY-MM-DD}/{slug}/index.mdx")).toBe(
      "content/blog/dev",
    );
  });

  it("handles a single-level prefix", () => {
    expect(contentBaseDir("posts/{YYYY-MM-DD}/{slug}/index.mdx")).toBe("posts");
  });

  it("returns '.' when the first segment is a template token", () => {
    expect(contentBaseDir("{YYYY-MM-DD}/{slug}/index.mdx")).toBe(".");
  });
});

// ── scan ───────────────────────────────────────────────────────────────────

describe("scanBumpedPosts", () => {
  let tempDir: string;
  let remoteDir: string;
  let cloneDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "unbump-scan-"));
    remoteDir = join(tempDir, "remote");
    cloneDir = join(tempDir, "clone");
    setupBlogRepo(remoteDir, cloneDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when content dir does not exist", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    const posts = await scanBumpedPosts(config);
    expect(posts).toEqual([]);
  });

  it("returns empty array when content dir exists but has no posts", async () => {
    mkdirSync(join(cloneDir, CONTENT_BASE), { recursive: true });
    const config = makeConfig(cloneDir, remoteDir);
    const posts = await scanBumpedPosts(config);
    expect(posts).toEqual([]);
  });

  it("finds N posts and parses their frontmatter", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-first-post", {
      title: "First Post",
      version: "v0.2.0",
      date: "2026-05-30",
      commit: "abc1234",
    });
    addPost(cloneDir, "2026-05-31", "v0-2-1-second-post", {
      title: "Second Post",
      version: "v0.2.1",
      date: "2026-05-31",
      commit: "def5678",
    });

    const posts = await scanBumpedPosts(config);
    expect(posts).toHaveLength(2);
    expect(posts[0].title).toBe("Second Post"); // newest-first
    expect(posts[0].version).toBe("v0.2.1");
    expect(posts[0].commit).toBe("def5678");
    expect(posts[1].title).toBe("First Post");
  });

  it("sets relDir correctly for git operations", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-first-post", {
      title: "First Post",
      version: "v0.2.0",
      date: "2026-05-30",
      commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    expect(posts[0].relDir).toBe("content/blog/dev/2026-05-30/v0-2-0-first-post");
  });

  it("date field is formatted as YYYY-MM-DD even when YAML parses it as a Date object", async () => {
    // gray-matter's YAML parser converts bare date values (2026-05-30) to JS Date objects.
    // scanBumpedPosts must convert them back to the YYYY-MM-DD string form.
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-date-test", {
      title: "Date Format Test",
      version: "v0.2.0",
      date: "2026-05-30",
      commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    expect(posts[0].date).toBe("2026-05-30");
    expect(posts[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("label includes version, date, truncated title, and commit", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-first", {
      title: "First Post",
      version: "v0.2.0",
      date: "2026-05-30",
      commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    expect(posts[0].label).toContain("v0.2.0");
    expect(posts[0].label).toContain("2026-05-30");
    expect(posts[0].label).toContain("First Post");
    expect(posts[0].label).toContain("abc1234");
  });

  it("skips entries without an index.mdx", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    // Create a date/slug dir with no index.mdx — should be skipped
    const orphanDir = join(cloneDir, CONTENT_BASE, "2026-05-29", "orphan-dir");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "other.txt"), "not an mdx file");
    exec(`git -C ${cloneDir} add .`);
    exec(`git -C ${cloneDir} commit -m "add orphan"`);
    exec(`git -C ${cloneDir} push`);

    const posts = await scanBumpedPosts(config);
    expect(posts).toHaveLength(0);
  });

  it("returns posts newest-first across multiple dates", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-28", "v0-1-0-oldest", {
      title: "Oldest", version: "v0.1.0", date: "2026-05-28", commit: "aaa0001",
    });
    addPost(cloneDir, "2026-05-31", "v0-3-0-newest", {
      title: "Newest", version: "v0.3.0", date: "2026-05-31", commit: "ccc0003",
    });
    addPost(cloneDir, "2026-05-30", "v0-2-0-middle", {
      title: "Middle", version: "v0.2.0", date: "2026-05-30", commit: "bbb0002",
    });

    const posts = await scanBumpedPosts(config);
    expect(posts.map((p) => p.date)).toEqual(["2026-05-31", "2026-05-30", "2026-05-28"]);
  });
});

// ── unbump: dry-run ─────────────────────────────────────────────────────────

describe("unbumpPosts dry-run", () => {
  let tempDir: string;
  let remoteDir: string;
  let cloneDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "unbump-dry-"));
    remoteDir = join(tempDir, "remote");
    cloneDir = join(tempDir, "clone");
    setupBlogRepo(remoteDir, cloneDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("dryRun=true returns status='dry-run' and leaves all files intact", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-test", {
      title: "Test Post", version: "v0.2.0", date: "2026-05-30", commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    expect(posts).toHaveLength(1);

    const result = await unbumpPosts(posts, config, { dryRun: true });
    expect(result.status).toBe("dry-run");
    if (result.status === "dry-run") {
      expect(result.removed).toHaveLength(1);
    }

    // Files must still exist
    expect(existsSync(join(cloneDir, "content/blog/dev/2026-05-30/v0-2-0-test/index.mdx"))).toBe(true);
    // No new commit
    const logCount = exec(`git -C ${cloneDir} rev-list HEAD --count`);
    expect(parseInt(logCount)).toBe(2); // init + one post commit
  });
});

// ── unbump: live removal ────────────────────────────────────────────────────

describe("unbumpPosts live removal", () => {
  let tempDir: string;
  let remoteDir: string;
  let cloneDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "unbump-live-"));
    remoteDir = join(tempDir, "remote");
    cloneDir = join(tempDir, "clone");
    setupBlogRepo(remoteDir, cloneDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("removes only selected posts, leaves others intact", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-keep", {
      title: "Keep Me", version: "v0.2.0", date: "2026-05-30", commit: "aaa0001",
    });
    addPost(cloneDir, "2026-05-31", "v0-2-1-remove", {
      title: "Remove Me", version: "v0.2.1", date: "2026-05-31", commit: "bbb0002",
    });

    const posts = await scanBumpedPosts(config);
    const toRemove = posts.filter((p) => p.commit === "bbb0002");
    expect(toRemove).toHaveLength(1);

    const result = await unbumpPosts(toRemove, config);
    expect(result.status).toBe("done");

    // Removed post directory is gone
    expect(existsSync(join(cloneDir, "content/blog/dev/2026-05-31/v0-2-1-remove"))).toBe(false);
    // Kept post is still there
    expect(existsSync(join(cloneDir, "content/blog/dev/2026-05-30/v0-2-0-keep/index.mdx"))).toBe(true);
  });

  it("commits the deletion and pushes to remote", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-remove", {
      title: "Remove Me", version: "v0.2.0", date: "2026-05-30", commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    const result = await unbumpPosts(posts, config);

    expect(result.status).toBe("done");
    if (result.status === "done") {
      expect(result.commitSha).toMatch(/^[0-9a-f]{7}$/);
    }

    // Remote has the deletion commit
    const remoteLog = exec(`git -C ${remoteDir} log --oneline`);
    expect(remoteLog).toContain("unbump:");

    // Remote no longer has the post file
    const remoteFiles = exec(`git -C ${remoteDir} ls-files`);
    expect(remoteFiles).not.toContain("v0-2-0-remove");
  });

  it("cleans up empty date directory after last post in that date is removed", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-only", {
      title: "Only Post", version: "v0.2.0", date: "2026-05-30", commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    await unbumpPosts(posts, config);

    // Empty date dir should be cleaned up
    expect(existsSync(join(cloneDir, "content/blog/dev/2026-05-30"))).toBe(false);
  });

  it("does not clean up date dir when other posts remain in it", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-keep", {
      title: "Keep", version: "v0.2.0", date: "2026-05-30", commit: "aaa0001",
    });
    addPost(cloneDir, "2026-05-30", "v0-2-1-remove", {
      title: "Remove", version: "v0.2.1", date: "2026-05-30", commit: "bbb0002",
    });

    const posts = await scanBumpedPosts(config);
    const toRemove = posts.filter((p) => p.commit === "bbb0002");
    await unbumpPosts(toRemove, config);

    // Date dir still exists (has the kept post)
    expect(existsSync(join(cloneDir, "content/blog/dev/2026-05-30"))).toBe(true);
    expect(existsSync(join(cloneDir, "content/blog/dev/2026-05-30/v0-2-0-keep/index.mdx"))).toBe(true);
  });

  it("handles a stale selection gracefully (post already deleted)", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-stale", {
      title: "Stale Post", version: "v0.2.0", date: "2026-05-30", commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);

    // Manually delete the post dir before unbump runs (simulates stale selection)
    rmSync(join(cloneDir, "content/blog/dev/2026-05-30/v0-2-0-stale"), {
      recursive: true,
      force: true,
    });
    exec(`git -C ${cloneDir} add -A`);
    exec(`git -C ${cloneDir} commit -m "external delete"`);
    exec(`git -C ${cloneDir} push`);

    // Should not throw — handles already-deleted post
    await expect(unbumpPosts(posts, config)).resolves.not.toThrow();
  });

  it("push=manual commits but does not push", async () => {
    const config: Config = {
      ...makeConfig(cloneDir, remoteDir),
      git: {
        author: "blog.bumper <bumper@test.dev>",
        commit_template: "bump: {version} → {date} ({title})",
        push: "manual",
      },
    };
    addPost(cloneDir, "2026-05-30", "v0-2-0-remove", {
      title: "Remove Me", version: "v0.2.0", date: "2026-05-30", commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    await unbumpPosts(posts, config);

    // Clone has the deletion commit
    const cloneLog = exec(`git -C ${cloneDir} log --oneline`);
    expect(cloneLog).toContain("unbump:");

    // Remote does NOT have the deletion commit
    const remoteLog = exec(`git -C ${remoteDir} log --oneline`);
    expect(remoteLog).not.toContain("unbump:");
  });

  it("only modifies files inside the blog clone path — no other dirs touched", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-remove", {
      title: "Remove Me", version: "v0.2.0", date: "2026-05-30", commit: "abc1234",
    });

    // Create a sibling directory with a sentinel file to verify it's untouched
    const siblingDir = join(tempDir, "source-project");
    mkdirSync(siblingDir);
    const sentinel = join(siblingDir, "sentinel.txt");
    writeFileSync(sentinel, "should not be touched");

    const posts = await scanBumpedPosts(config);
    await unbumpPosts(posts, config);

    // Sentinel file in sibling dir is untouched — unbump stayed inside cloneDir
    expect(existsSync(sentinel)).toBe(true);
  });

  it("returns commitSha as 7 hex chars", async () => {
    const config = makeConfig(cloneDir, remoteDir);
    addPost(cloneDir, "2026-05-30", "v0-2-0-remove", {
      title: "Remove Me", version: "v0.2.0", date: "2026-05-30", commit: "abc1234",
    });

    const posts = await scanBumpedPosts(config);
    const result = await unbumpPosts(posts, config);
    expect(result.status).toBe("done");
    if (result.status === "done") {
      expect(result.commitSha).toMatch(/^[0-9a-f]{7}$/);
    }
  });
});

// ── unbumpPosts: empty input ────────────────────────────────────────────────

describe("unbumpPosts edge cases", () => {
  it("returns status='empty' when given an empty posts array", async () => {
    // No git setup needed — the function returns early
    const config = makeConfig("/tmp/fake-clone", "/tmp/fake-remote");
    const result = await unbumpPosts([], config);
    expect(result.status).toBe("empty");
  });
});
