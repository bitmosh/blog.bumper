import { describe, it, expect } from "vitest";
import { parseConfig, ConfigError } from "../src/config.js";

const base = {
  source: {
    module: "lumaweave",
    report_channel: "discord://123456789012345678/987654321098765432",
    debug_channel: "discord://123456789012345678/123456789012345678",
    buffer: 1,
    token_env: "DISCORD_BOT_TOKEN",
  },
  target: {
    repo: "https://github.com/bitmosh/bitmosh-website",
    branch: "main",
    content_path: "content/blog/dev/{YYYY-MM-DD}/{slug}/index.mdx",
    local_clone: "~/.bumper/bitmosh-website",
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
};

describe("parseConfig", () => {
  it("accepts a valid config", () => {
    expect(() => parseConfig(base)).not.toThrow();
  });

  it("returns correctly typed fields", () => {
    const config = parseConfig(base);
    expect(config.source.module).toBe("lumaweave");
    expect(config.source.buffer).toBe(1);
    expect(config.guard.require_blog_ff).toBe(true);
    expect(config.git.push).toBe("auto");
  });

  it("throws ConfigError for an invalid module slug", () => {
    const raw = { ...base, source: { ...base.source, module: "phantom" } };
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it("throws ConfigError when [source] is missing", () => {
    const { source: _, ...noSource } = base;
    expect(() => parseConfig(noSource)).toThrow(ConfigError);
  });

  it("throws ConfigError for an invalid push value", () => {
    const raw = { ...base, git: { ...base.git, push: "force-push" } };
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it("throws ConfigError for a malformed discord URI", () => {
    const raw = {
      ...base,
      source: { ...base.source, report_channel: "https://discord.com/channels/123/456" },
    };
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it("applies default buffer=1 when omitted", () => {
    const { buffer: _, ...sourceWithout } = base.source;
    const raw = { ...base, source: sourceWithout };
    const config = parseConfig(raw);
    expect(config.source.buffer).toBe(1);
  });

  it("applies default token_env when omitted", () => {
    const { token_env: _, ...sourceWithout } = base.source;
    const raw = { ...base, source: sourceWithout };
    const config = parseConfig(raw);
    expect(config.source.token_env).toBe("DISCORD_BOT_TOKEN");
  });

  it("ConfigError has name='ConfigError'", () => {
    const { source: _, ...noSource } = base;
    try {
      parseConfig(noSource);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).name).toBe("ConfigError");
    }
  });

  it("error message names the invalid field", () => {
    const raw = { ...base, source: { ...base.source, module: "phantom" } };
    try {
      parseConfig(raw);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as ConfigError).message).toContain("source.module");
    }
  });
});
