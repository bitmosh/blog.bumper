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

// ── Prompt manifest ────────────────────────────────────────────────────────
//
// Wired (working end-to-end this pass):
//   _guildId, source.report_channel (custom), source.debug_channel (custom),
//   source.module, target.repo, target.content_path, git.author
//
// Stubbed (TODOs — filled with schema defaults in assembleConfig):
//   source.buffer, source.token_env, target.branch, target.local_clone,
//   git.commit_template, git.push, all [post] fields, all [guard] fields

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
    message: "Blog repo URL (e.g. https://github.com/you/your-blog):",
    validate: zodValidator(configSchema.shape.target.shape.repo),
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
    message: "Git author for bumped commits (Name <email>) — this is who the auto-posted commits show as in your blog repo:",
    default: "blog.bumper <bumper@example.dev>",
    validate: (v) => {
      if (typeof v !== "string" || v.length === 0) return "Required"
      // loose check: must look like "Something <something>"
      if (!/^.+<.+>$/.test(v)) return "Format: Name <email>, e.g. blog.bumper <bumper@you.dev>"
      return true
    },
  },

  // ── TODO: source.buffer (default 1) ──────────────────────────────────
  // ── TODO: source.token_env (default "DISCORD_BOT_TOKEN") ─────────────
  // ── TODO: target.branch (default "main") ─────────────────────────────
  // ── TODO: target.local_clone (default "~/.bumper/bitmosh-website") ───
  // ── TODO: git.commit_template (default "bump: {version} → ...") ──────
  // ── TODO: git.push select (auto/manual/dry-run) ──────────────────────
  // ── TODO: post.status, post.commentary, post.tag_strategy, post.timezone
  // ── TODO: guard.fail_on_validation_error, fail_on_duplicate, etc. ────
];

// ── Config assembly ────────────────────────────────────────────────────────

/**
 * Maps flat wizard answers onto the nested config shape.
 * Wired fields come from answers; stubbed fields use the schema defaults.
 */
export function assembleConfig(answers: Record<string, unknown>): Record<string, unknown> {
  return {
    source: {
      module: answers["source.module"] ?? "general",
      report_channel: answers["source.report_channel"],
      debug_channel: answers["source.debug_channel"],
      buffer: 1,                          // TODO: answers["source.buffer"]
      token_env: "DISCORD_BOT_TOKEN",     // TODO: answers["source.token_env"]
    },
    target: {
      repo: answers["target.repo"],
      branch: "main",                     // TODO: answers["target.branch"]
      content_path: answers["target.content_path"],
      local_clone: "~/.bumper/bitmosh-website", // TODO: answers["target.local_clone"]
    },
    git: {
      author: answers["git.author"],
      commit_template: "bump: {version} → {date} ({title})", // TODO
      push: "auto",                       // TODO: answers["git.push"]
    },
    post: {
      status: "published",                // TODO
      commentary: "empty",                // TODO
      tag_strategy: "from-version",       // TODO
      timezone: "America/Chicago",        // TODO
    },
    guard: {
      fail_on_validation_error: true,     // TODO
      fail_on_duplicate: false,           // TODO
      skip_if_no_report: true,            // TODO
      require_blog_ff: true,              // TODO
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
