import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

export type ScannedRepo = {
  name: string;   // folder basename — candidate project name
  path: string;   // absolute path to the repo
  remote: string | null; // origin URL if present, else null
};

export function scanForRepos(dir: string): ScannedRepo[] {
  const absDir = resolve(dir.replace(/^~(?=\/|$)/, homedir()));

  if (!existsSync(absDir)) {
    throw new Error(`scan directory not found: ${absDir}`);
  }

  const entries = readdirSync(absDir);
  const results: ScannedRepo[] = [];

  for (const entry of entries) {
    const fullPath = join(absDir, entry);

    // Skip plain files — only directories are candidates
    try {
      if (!statSync(fullPath).isDirectory()) continue;
    } catch {
      // Permission error or broken symlink — skip silently
      continue;
    }

    // .git can be a directory (normal repo) or a file (worktree / submodule)
    if (!existsSync(join(fullPath, ".git"))) continue;

    results.push({
      name: basename(fullPath),
      path: fullPath,
      remote: getOriginRemote(fullPath),
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** True if path has a .git entry (file OR directory — handles worktrees and submodules). */
export function isGitRepo(path: string): boolean {
  return existsSync(join(resolve(path), ".git"));
}

/** Returns the origin remote URL for a repo, or null if not set. */
export function resolveOriginRemote(repoPath: string): string | null {
  return getOriginRemote(repoPath);
}

function getOriginRemote(repoPath: string): string | null {
  const result = spawnSync("git", ["-C", repoPath, "remote", "get-url", "origin"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return null;
}
