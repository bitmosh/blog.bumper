import { simpleGit } from "simple-git";
import matter from "gray-matter";
import {
  existsSync,
  readdirSync,
  rmdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveClonePath, checkFF, GitError } from "./driver.js";
import type { Config } from "../config.js";

export interface BumpedPost {
  path: string;    // absolute path to index.mdx
  dir: string;     // absolute path to <slug>/ directory
  relDir: string;  // clone-root-relative path to <slug>/ dir (for git rm)
  title: string;
  version: string;
  date: string;
  commit: string;
  label: string;   // picker label shown to user
}

export type UnbumpResult =
  | { status: "done"; removed: BumpedPost[]; commitSha: string }
  | { status: "dry-run"; removed: BumpedPost[] }
  | { status: "empty" };

// Extract the static base directory from the content_path template.
// "content/blog/dev/{YYYY-MM-DD}/{slug}/index.mdx" → "content/blog/dev"
export function contentBaseDir(contentPath: string): string {
  const parts = contentPath.split("/");
  const firstTemplate = parts.findIndex((p) => p.includes("{"));
  if (firstTemplate <= 0) return ".";
  return parts.slice(0, firstTemplate).join("/");
}

export async function scanBumpedPosts(config: Config): Promise<BumpedPost[]> {
  const clonePath = resolveClonePath(config.target.local_clone);
  const branch = config.target.branch;

  // Ensure current clone — fetch from remote and switch to the target branch.
  // Never resets local commits (respects push=manual workflow).
  if (!existsSync(clonePath)) {
    await simpleGit().clone(config.target.repo, clonePath, ["--branch", branch]);
  } else {
    const sg = simpleGit(clonePath);
    await sg.fetch("origin", branch);
    await sg.checkout(branch);
  }

  const baseDir = contentBaseDir(config.target.content_path);
  const absBase = join(clonePath, baseDir);
  if (!existsSync(absBase)) return [];

  const posts: BumpedPost[] = [];

  const dateDirs = readdirSync(absBase, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest-first

  for (const dateEntry of dateDirs) {
    const absDateDir = join(absBase, dateEntry.name);
    const slugEntries = readdirSync(absDateDir, { withFileTypes: true }).filter(
      (d) => d.isDirectory(),
    );

    for (const slugEntry of slugEntries) {
      const absPostDir = join(absDateDir, slugEntry.name);
      const absPostFile = join(absPostDir, "index.mdx");
      if (!existsSync(absPostFile)) continue;

      try {
        const raw = readFileSync(absPostFile, "utf-8");
        const { data } = matter(raw);
        const title = String(data.title ?? "(untitled)");
        const version = String(data.version ?? "?");
        // gray-matter's YAML parser converts bare date values to JS Date objects
        const rawDate = data.date;
        const date =
          rawDate instanceof Date
            ? rawDate.toISOString().slice(0, 10)
            : String(rawDate ?? dateEntry.name);
        const commit = String(data.commit ?? "???????");
        const relDir = `${baseDir}/${dateEntry.name}/${slugEntry.name}`;

        posts.push({
          path: absPostFile,
          dir: absPostDir,
          relDir,
          title,
          version,
          date,
          commit,
          label: `${version} · ${date} · ${title.length > 55 ? title.slice(0, 55) + "…" : title} (${commit})`,
        });
      } catch {
        // Malformed frontmatter — skip silently
      }
    }
  }

  return posts;
}

export async function unbumpPosts(
  posts: BumpedPost[],
  config: Config,
  opts: { dryRun?: boolean } = {},
): Promise<UnbumpResult> {
  if (posts.length === 0) return { status: "empty" };
  if (opts.dryRun) return { status: "dry-run", removed: posts };

  const clonePath = resolveClonePath(config.target.local_clone);
  const branch = config.target.branch;
  const sg = simpleGit(clonePath);

  // Non-FF guard — same contract as bumpRepo
  if (config.guard.require_blog_ff) {
    const ff = await checkFF(clonePath, branch);
    if (!ff.ok) {
      throw new GitError(
        `unbump aborted — blog repo not fast-forwardable (${ff.subcase}). ` +
          `Run: git -C ${clonePath} pull --ff-only`,
        "ff-refused",
      );
    }
  }

  // Remove each selected post via git rm (stages deletion + removes from working tree).
  // --ignore-unmatch: graceful if a post was already deleted (stale selection).
  const dateDirsToCheck = new Set<string>();
  for (const post of posts) {
    await sg.raw(["rm", "-r", "--ignore-unmatch", post.relDir]);
    dateDirsToCheck.add(dirname(post.dir));
  }

  // Clean up empty date dirs from the working tree.
  // git rm handles this automatically in the normal case, but stale selections
  // (post already deleted before unbump ran) leave the parent empty on disk.
  // rmdirSync is safe here — it only removes empty dirs; throws if non-empty.
  for (const dateDir of dateDirsToCheck) {
    if (existsSync(dateDir) && readdirSync(dateDir).length === 0) {
      rmdirSync(dateDir);
    }
  }

  const message =
    posts.length === 1
      ? `unbump: remove ${posts[0].version} · ${posts[0].title} (${posts[0].commit})`
      : `unbump: remove ${posts.length} posts\n\n${posts.map((p) => `- ${p.version} ${p.commit} ${p.title}`).join("\n")}`;

  await sg.commit(message, { "--author": config.git.author });

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
  return { status: "done", removed: posts, commitSha };
}
