import { input } from "@inquirer/prompts";
import { configSchema } from "../config.js";
import type { PromptDef } from "./runner.js";
import type { Config } from "../config.js";

// ── Zod field validators — reuse schema, never duplicate logic ────────────

function zodValidator(
  schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } } },
): (value: unknown) => true | string {
  return (value: unknown) => {
    const result = schema.safeParse(value);
    if (result.success) return true;
    return result.error?.issues[0]?.message ?? "Invalid value";
  };
}

function discordIdValidator(v: unknown): true | string {
  if (typeof v === "string" && /^\d{17,20}$/.test(v)) return true;
  return "Must be a 17–20 digit Discord snowflake ID";
}

const KNOWN_GIT_HOSTS = /github\.com|gitlab\.com|bitbucket\.org|codeberg\.org/;

function repoHeuristicValidator(value: unknown): true | string {
  const v = String(value ?? "");
  // Must pass the Zod URL check first
  const urlResult = zodValidator(configSchema.shape.target.shape.repo)(v);
  if (urlResult !== true) return urlResult;
  // Known git hosting providers → allow
  let parsed: URL;
  try { parsed = new URL(v); } catch { return "Invalid URL"; }
  if (KNOWN_GIT_HOSTS.test(parsed.hostname)) return true;
  // Explicit .git suffix → allow
  if (v.endsWith(".git")) return true;
  // Self-hosted git: owner/repo path structure (≥2 segments) → allow
  if (parsed.pathname.split("/").filter(Boolean).length >= 2) return true;
  // Looks like a site page URL — prompt for a git remote instead
  return "That looks like a site URL — bumper needs the git repo it commits posts to, e.g. https://github.com/you/your-blog or a git remote URL.";
}

// ── Prompt manifest ────────────────────────────────────────────────────────
//
// Two-tier structure:
//   ESSENTIAL — always shown (_guildId, channel URIs, module, repo, content_path,
//               git.author, buffer, push, status, timezone)
//   ADVANCED  — only shown when the _advanced gate is accepted

export const manifest: PromptDef[] = [
  // ── Discord: shared guild ID ──────────────────────────────────────────
  {
    key: "_guildId",
    type: "text",
    message: "Discord server (guild) ID — shared for both channel URIs:",
    validate: discordIdValidator,
  },

  // ── source.report_channel — assembled from guild + channelId ─────────
  {
    key: "source.report_channel",
    type: "custom",
    message: "",
    custom: async (answers) => {
      const guild = answers["_guildId"] as string;
      const channelId = await input({
        message: "Report channel ID (your #changelog channel):",
        validate: discordIdValidator,
      });
      return `discord://${guild}/${channelId}`;
    },
  },

  // ── source.debug_channel — reuses guild ──────────────────────────────
  {
    key: "source.debug_channel",
    type: "custom",
    message: "",
    custom: async (answers) => {
      const guild = answers["_guildId"] as string;
      const channelId = await input({
        message: "Debug channel ID (your #debug channel):",
        validate: discordIdValidator,
      });
      return `discord://${guild}/${channelId}`;
    },
  },

  // ── source.module ─────────────────────────────────────────────────────
  {
    key: "source.module",
    type: "select",
    message: "Default module for posts without a Project: field:",
    choices: [
      { name: "general", value: "general" },
      { name: "lumaweave", value: "lumaweave" },
      { name: "cerebra", value: "cerebra" },
      { name: "bonsai", value: "bonsai" },
      { name: "gwells", value: "gwells" },
    ],
    default: "general",
  },

  // ── target.repo ───────────────────────────────────────────────────────
  {
    key: "target.repo",
    type: "text",
    message: "Your blog's GIT repository URL (not your site URL) — e.g. https://github.com/you/your-blog:",
    validate: repoHeuristicValidator,
  },

  // ── target.content_path ──────────────────────────────────────────────
  {
    key: "target.content_path",
    type: "text",
    message: "Content path template:",
    default: "content/blog/dev/{YYYY-MM-DD}/{slug}/index.mdx",
    validate: (v) => (typeof v === "string" && v.length > 0 ? true : "Required"),
  },

  // ── git.author ────────────────────────────────────────────────────────
  {
    key: "git.author",
    type: "text",
    message: "Git author for the commits bumper makes in your blog repo, as Name <email> (who the auto-posted commits show as):",
    default: "blog.bumper <bumper@example.dev>",
    validate: (v) => {
      if (typeof v !== "string" || v.length === 0) return "Required";
      if (!/^.+<.+@.+>$/.test(v)) return "Format: Name <email>, e.g. blog.bumper <bumper@you.dev>";
      return true;
    },
  },

  // ── ESSENTIAL: source.buffer ─────────────────────────────────────────
  {
    key: "source.buffer",
    type: "text",
    message: "Which report to grab: 0 = most recent message, 1 = second-most-recent (default — lets you post a report while already starting the next task):",
    default: "1",
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) return "Must be a non-negative integer (0, 1, 2…)";
      return true;
    },
  },

  // ── ESSENTIAL: git.push ───────────────────────────────────────────────
  {
    key: "git.push",
    type: "select",
    message: "Push behavior after bumper commits:",
    choices: [
      { name: "auto — commit + push automatically", value: "auto" },
      { name: "manual — commit but you push yourself", value: "manual" },
      { name: "dry-run — build the post but never write", value: "dry-run" },
    ],
    default: "auto",
  },

  // ── ESSENTIAL: post.status ────────────────────────────────────────────
  {
    key: "post.status",
    type: "select",
    message: "Default post status:",
    choices: [
      { name: "published — live immediately", value: "published" },
      { name: "draft — staged for you to publish on your site", value: "draft" },
    ],
    default: "published",
  },

  // ── ESSENTIAL: post.timezone ──────────────────────────────────────────
  {
    key: "post.timezone",
    type: "text",
    message: "IANA timezone for date rollover + timestamps, e.g. America/New_York, Europe/London:",
    default: "America/Chicago",
  },

  // ── ADVANCED GATE ─────────────────────────────────────────────────────
  {
    key: "_advanced",
    type: "confirm",
    message: "Customize advanced settings (token env, branch, clone path, commit format, comments, tags, guard rules)? Sane defaults are used otherwise.",
    default: false,
  },

  // ── ADVANCED: source.token_env ────────────────────────────────────────
  {
    key: "source.token_env",
    type: "text",
    message: "Env var name holding your Discord bot token (default: \"DISCORD_BOT_TOKEN\"):",
    default: "DISCORD_BOT_TOKEN",
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: target.branch ───────────────────────────────────────────
  {
    key: "target.branch",
    type: "text",
    message: "Branch in your blog repo to commit to (default: \"main\"):",
    default: "main",
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: target.local_clone ─────────────────────────────────────
  {
    key: "target.local_clone",
    type: "text",
    message: "Local path for bumper's working clone of your blog repo (default: \"~/.bumper/blog-clone\"):",
    default: "~/.bumper/blog-clone",
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: git.commit_template ────────────────────────────────────
  {
    key: "git.commit_template",
    type: "text",
    message: "Commit message format — {version}, {date}, {title}, {slug}, {commit} are substituted (default: \"bump: {version} → {date} ({title})\"):",
    default: "bump: {version} → {date} ({title})",
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: post.commentary ─────────────────────────────────────────
  {
    key: "post.commentary",
    type: "select",
    message: "Commentary block in generated posts (default: \"empty\"):",
    choices: [
      { name: "empty — no commentary block", value: "empty" },
      { name: "draft-synthesis — seed a commentary draft from learnings", value: "draft-synthesis" },
    ],
    default: "empty",
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: post.tag_strategy ───────────────────────────────────────
  {
    key: "post.tag_strategy",
    type: "select",
    message: "How post tags are seeded (default: \"from-version\"):",
    choices: [
      { name: "from-version — tags: [version], e.g. [v98.4]", value: "from-version" },
    ],
    default: "from-version",
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: guard.fail_on_validation_error ──────────────────────────
  {
    key: "guard.fail_on_validation_error",
    type: "confirm",
    message: "Abort the run on invalid frontmatter? (recommended — prevents a malformed post from being committed):",
    default: true,
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: guard.fail_on_duplicate ────────────────────────────────
  {
    key: "guard.fail_on_duplicate",
    type: "confirm",
    message: "Treat an already-posted commit as an error? (false = quiet skip, recommended for idempotent reruns):",
    default: false,
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: guard.skip_if_no_report ────────────────────────────────
  {
    key: "guard.skip_if_no_report",
    type: "confirm",
    message: "Exit quietly when the buffer finds nothing new, instead of erroring?",
    default: true,
    when: (a) => a["_advanced"] === true,
  },

  // ── ADVANCED: guard.require_blog_ff ──────────────────────────────────
  {
    key: "guard.require_blog_ff",
    type: "confirm",
    message: "Require the blog repo to be fast-forwardable before pushing? (recommended — prevents unsafe force-pushes):",
    default: true,
    when: (a) => a["_advanced"] === true,
  },
];

// ── Config assembly ────────────────────────────────────────────────────────

/**
 * Maps flat wizard answers onto the nested config shape.
 * Essential-tier answers are always present.
 * Advanced-tier answers may be absent when the gate was declined — fall back to documented defaults.
 */
export function assembleConfig(answers: Record<string, unknown>): Record<string, unknown> {
  return {
    source: {
      module: answers["source.module"] ?? "general",
      report_channel: answers["source.report_channel"],
      debug_channel: answers["source.debug_channel"],
      buffer: Number(answers["source.buffer"] ?? 1),
      token_env: answers["source.token_env"] ?? "DISCORD_BOT_TOKEN",
    },
    target: {
      repo: answers["target.repo"],
      branch: answers["target.branch"] ?? "main",
      content_path: answers["target.content_path"],
      local_clone: answers["target.local_clone"] ?? "~/.bumper/blog-clone",
    },
    git: {
      author: answers["git.author"],
      commit_template: answers["git.commit_template"] ?? "bump: {version} → {date} ({title})",
      push: answers["git.push"] ?? "auto",
    },
    post: {
      status: answers["post.status"] ?? "published",
      commentary: answers["post.commentary"] ?? "empty",
      tag_strategy: answers["post.tag_strategy"] ?? "from-version",
      timezone: answers["post.timezone"] ?? "America/Chicago",
    },
    guard: {
      fail_on_validation_error: answers["guard.fail_on_validation_error"] ?? true,
      fail_on_duplicate: answers["guard.fail_on_duplicate"] ?? false,
      skip_if_no_report: answers["guard.skip_if_no_report"] ?? true,
      require_blog_ff: answers["guard.require_blog_ff"] ?? true,
    },
  };
}

/** Strip internal keys (prefixed with "_") before logging or writing. */
export function stripInternal(answers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(answers).filter(([k]) => !k.startsWith("_")),
  );
}

// Re-export Config so callers can use it without touching config.ts directly.
export type { Config };
