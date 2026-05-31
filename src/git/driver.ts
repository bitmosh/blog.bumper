import { simpleGit } from "simple-git";
import matter from "gray-matter";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { renderMDX } from "../mdx/writer.js";
import { WriterError } from "../mdx/frontmatter.js";
import type { ParsedReport } from "../parser/index.js";
import type { Config } from "../config.js";

export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: "ff-refused" | "push-failed" | "clone-failed" | "io",
  ) {
    super(message);
    this.name = "GitError";
  }
}

export type BumpResult =
  | { status: "done"; path: string; commitSha: string }
  | { status: "skipped"; reason: "duplicate" };

export interface GitPlan {
  cloneOrPull: string;
  targetPath: string;
  commitMessage: string;
  pushTarget: string;
}

export function resolveClonePath(localClone: string): string {
  return localClone.replace(/^~(?=\/|$)/, homedir());
}

export function buildCommitMessage(config: Config, report: ParsedReport): string {
  return config.git.commit_template
    .replace("{version}", report.version)
    .replace("{date}", report.date)
    .replace("{title}", report.title);
}

function resolveRelPath(config: Config, report: ParsedReport): string {
  return config.target.content_path
    .replace("{YYYY-MM-DD}", report.date)
    .replace("{slug}", report.slug);
}

export function buildGitPlan(config: Config, report: ParsedReport): GitPlan {
  const clonePath = resolveClonePath(config.target.local_clone);
  const relPath = resolveRelPath(config, report);
  return {
    cloneOrPull: existsSync(clonePath)
      ? `git -C ${clonePath} fetch origin ${config.target.branch}`
      : `git clone ${config.target.repo} ${clonePath}`,
    targetPath: join(clonePath, relPath),
    commitMessage: buildCommitMessage(config, report),
    pushTarget: `origin ${config.target.branch} (${config.target.repo})`,
  };
}

export type FFResult =
  | { ok: true }
  | { ok: false; subcase: "behind" | "diverged"; localSha: string; remoteSha: string };

export async function checkFF(clonePath: string, branch: string): Promise<FFResult> {
  const sg = simpleGit(clonePath);
  await sg.fetch("origin", branch);

  const localHead = (await sg.revparse(["HEAD"])).trim();
  const remoteHead = (await sg.revparse([`origin/${branch}`])).trim();

  if (localHead === remoteHead) return { ok: true };

  // git merge-base A B → common ancestor SHA.
  // If ancestor == remoteHead → remote is already an ancestor of local (local ahead, clean FF).
  // If ancestor == localHead  → local is behind remote (refuse: behind).
  // Otherwise                 → neither is ancestor of the other (refuse: diverged).
  const mergeBase = (await sg.raw(["merge-base", remoteHead, localHead])).trim();

  if (mergeBase === remoteHead) return { ok: true };

  const subcase: "behind" | "diverged" = mergeBase === localHead ? "behind" : "diverged";
  return { ok: false, subcase, localSha: localHead, remoteSha: remoteHead };
}

export function buildNonFFDebugMessage(
  config: Config,
  report: ParsedReport,
  subcase: "behind" | "diverged",
  localSha: string,
  remoteSha: string,
): string {
  const clonePath = resolveClonePath(config.target.local_clone);
  const lines = [
    `⚠ bump aborted — blog repo not fast-forwardable`,
    `  version:   ${report.version}`,
    `  local:     ${localSha.slice(0, 7)}`,
    `  remote:    ${remoteSha.slice(0, 7)}`,
  ];
  if (subcase === "behind") {
    lines.push(
      `  reason:    local is behind remote (remote has commits not in local)`,
      `  action:    cd ${clonePath} && git pull --ff-only, then re-run`,
    );
  } else {
    lines.push(
      `  reason:    branches have diverged (neither is an ancestor of the other)`,
      `  action:    inspect and reconcile manually — git pull will not resolve a diverged state`,
    );
  }
  lines.push(`  post NOT written, NOT committed, NOT pushed. exit 1.`);
  return lines.join("\n");
}

export async function bumpRepo(
  report: ParsedReport,
  config: Config,
): Promise<BumpResult> {
  if (!config.guard.require_blog_ff) {
    process.stderr.write(
      "WARNING: require_blog_ff is disabled — non-FF guard will not run. This is unsafe for shared repos.\n",
    );
  }

  const clonePath = resolveClonePath(config.target.local_clone);
  const branch = config.target.branch;
  const relPath = resolveRelPath(config, report);
  const absPath = join(clonePath, relPath);

  // 1. Clone if no local copy exists
  if (!existsSync(clonePath)) {
    try {
      await simpleGit().clone(config.target.repo, clonePath, ["--branch", branch]);
    } catch (e) {
      throw new GitError(
        `clone failed: ${e instanceof Error ? e.message : String(e)}`,
        "clone-failed",
      );
    }
  }

  const sg = simpleGit(clonePath);

  // 2. Write MDX into working tree (before guard, per contract)
  const mdx = renderMDX(report, config); // Zod gate — throws WriterError if invalid

  if (existsSync(absPath)) {
    const existing = matter(readFileSync(absPath, "utf-8"));
    const existingCommit = existing.data.commit as string | undefined;
    if (existingCommit === report.commit) {
      return { status: "skipped", reason: "duplicate" };
    }
    throw new GitError(
      `${absPath} already exists with commit=${existingCommit ?? "unknown"}, refusing to overwrite (incoming commit=${report.commit})`,
      "io",
    );
  }

  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, mdx, "utf-8");

  // 3. Non-FF guard — after working-tree write, before commit
  if (config.guard.require_blog_ff) {
    const ff = await checkFF(clonePath, branch);
    if (!ff.ok) {
      const debugMsg = buildNonFFDebugMessage(
        config,
        report,
        ff.subcase,
        ff.localSha,
        ff.remoteSha,
      );
      throw new GitError(debugMsg, "ff-refused");
    }
  }

  // 4. Stage and commit
  await sg.add(relPath);
  await sg.commit(buildCommitMessage(config, report), { "--author": config.git.author });

  // 5. Push
  if (config.git.push === "auto") {
    try {
      await sg.push("origin", branch);
    } catch (e) {
      throw new GitError(
        `push failed: ${e instanceof Error ? e.message : String(e)}`,
        "push-failed",
      );
    }
  } else if (config.git.push === "manual") {
    process.stdout.write(
      `  push=manual — committed. Run: git -C ${clonePath} push origin ${branch}\n`,
    );
  } else {
    process.stdout.write(`  push=dry-run — committed but not pushed\n`);
  }

  const commitSha = (await sg.revparse(["HEAD"])).trim().slice(0, 7);
  return { status: "done", path: absPath, commitSha };
}
