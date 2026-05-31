import { z } from "zod";
import { parse as parseTOML } from "smol-toml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const discordURISchema = z.string().regex(/^discord:\/\/.+\/.+$/, {
  message: "must be a discord URI: discord://<guild-id>/<channel-id>",
});

export const configSchema = z.object({
  source: z.object({
    // free string — validated against the project registry on the bumper side, not the schema (0.2.0)
    module: z.string().min(1),
    changelog_channel: discordURISchema,
    debug_channel: discordURISchema,
    approve_channel: discordURISchema.optional(),
    buffer: z.number().int().min(0).default(1),
    token_env: z.string().default("DISCORD_BOT_TOKEN"),
  }),
  target: z.object({
    repo: z.string().url(),
    branch: z.string().default("main"),
    content_path: z.string(),
    local_clone: z.string().default("~/.bumper/bitmosh-website"),
  }),
  git: z.object({
    author: z.string(),
    commit_template: z.string().default("bump: {version} → {date} ({title})"),
    push: z.enum(["auto", "manual", "dry-run"]).default("auto"),
  }),
  post: z.object({
    status: z.enum(["draft", "published"]).default("published"),
    commentary: z.enum(["empty", "draft-synthesis"]).default("empty"),
    tag_strategy: z.enum(["from-version"]).default("from-version"),
    timezone: z.string().default("America/Chicago"),
  }),
  guard: z.object({
    fail_on_validation_error: z.boolean().default(true),
    fail_on_duplicate: z.boolean().default(false),
    skip_if_no_report: z.boolean().default(true),
    require_blog_ff: z.boolean().default(true),
  }),
});

export type Config = z.infer<typeof configSchema>;

export function parseConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid .bumper.toml:\n${issues}`);
  }
  return result.data;
}

export function loadConfig(configPath: string): Config {
  let raw: unknown;
  try {
    const text = readFileSync(resolve(configPath), "utf-8");
    raw = parseTOML(text);
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`Config file not found: ${configPath}`);
    }
    throw new ConfigError(
      `Failed to parse .bumper.toml: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  return parseConfig(raw);
}

export const EXAMPLE_TOML = `# blog.bumper — source repo root config

[source]
module            = "lumaweave"          # project module; default for posts without Project:
changelog_channel = "discord://<guild-id>/<channel-id>"  # #changelog — bumper reads reports from here
debug_channel     = "discord://<guild-id>/<channel-id>"  # #debug — bumper posts traces here
approve_channel   = "discord://<guild-id>/<channel-id>"  # #approve-this — Bandit gates bumps here (optional)
buffer            = 1                    # 0 = latest message; 1 = second-most-recent (default)
token_env         = "DISCORD_BOT_TOKEN"  # env var holding the bot token (never inline the token)

[target]
repo         = "https://github.com/bitmosh/bitmosh-website"
branch       = "main"
content_path = "content/blog/dev/{YYYY-MM-DD}/{slug}/index.mdx"
local_clone  = "~/.bumper/bitmosh-website"  # bumper-managed working clone

[git]
author          = "blog.bumper <bumper@bitmosh.dev>"
commit_template = "bump: {version} → {date} ({title})"
push            = "auto"              # "auto" | "manual" | "dry-run"

[post]
status       = "published"            # "draft" | "published"
commentary   = "empty"                # "empty" | "draft-synthesis"
tag_strategy = "from-version"         # seeds tags with [version]
timezone     = "America/Chicago"      # day-container rollover + time rendering

[guard]
fail_on_validation_error = true       # invalid frontmatter → exit non-zero, write nothing
fail_on_duplicate        = false      # same commit already posted → skip (exit 0), don't fail
skip_if_no_report        = true       # buffer finds nothing new → quiet no-op
require_blog_ff          = true       # blog repo must be fast-forwardable → else exit 1
`;
