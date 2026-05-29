import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as yamlParse } from "yaml";
import {
  buildFrontmatterObject,
  frontmatterToYaml,
  WriterError,
} from "../src/mdx/frontmatter.js";
import { renderMDX, writeMDX, resolvePath, buildBody } from "../src/mdx/writer.js";
import type { ParsedReport } from "../src/parser/index.js";
import type { Config } from "../src/config.js";

const baseReport: ParsedReport = {
  version: "v1.0",
  date: "2026-01-01",
  time: "00:00:00-06:00",
  title: "Test Report",
  slug: "v1-0-test-report",
  description: "A test description that is long enough to pass validation.",
  module: "general",
  highlights: ["First highlight here", "Second highlight here"],
  learnings: ["First learning about the system"],
  commit: "abc1234",
  tests: "1 passed",
  branch: "clean",
};

const baseConfig: Config = {
  source: {
    module: "general",
    report_channel: "discord://guild/channel",
    debug_channel: "discord://guild/debug",
    buffer: 1,
    token_env: "DISCORD_BOT_TOKEN",
  },
  target: {
    repo: "https://github.com/bitmosh/bitmosh-website",
    branch: "main",
    content_path: "/nonexistent/{YYYY-MM-DD}/{slug}/index.mdx",
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

function extractFrontmatterYaml(mdx: string): Record<string, unknown> {
  const match = mdx.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("no frontmatter block found");
  return yamlParse(match[1]) as Record<string, unknown>;
}

// ── Boundary A — frontmatter YAML injection safety ─────────────────────────

describe("Boundary A — frontmatter YAML injection safety", () => {
  it("title with colon round-trips through yaml", () => {
    const report = { ...baseReport, title: "Key: value format in title" };
    const fm = buildFrontmatterObject(report, baseConfig);
    const yamlStr = frontmatterToYaml(fm);
    const parsed = extractFrontmatterYaml(yamlStr);
    expect(parsed.title).toBe("Key: value format in title");
  });

  it("description with Discord channel mention <#...> round-trips", () => {
    const desc = "Traces every run to <#0000000000000000000> without logging the token.";
    const report = { ...baseReport, description: desc };
    const fm = buildFrontmatterObject(report, baseConfig);
    const yamlStr = frontmatterToYaml(fm);
    const parsed = extractFrontmatterYaml(yamlStr);
    expect(parsed.description).toBe(desc);
  });

  it("description starting with > doesn't become YAML block scalar", () => {
    const desc = "> 90% of render cost is in the fragment shader — confirmed across three GPUs.";
    const report = { ...baseReport, description: desc };
    const fm = buildFrontmatterObject(report, baseConfig);
    const yamlStr = frontmatterToYaml(fm);
    const parsed = extractFrontmatterYaml(yamlStr);
    expect(parsed.description).toBe(desc);
  });

  it("title with embedded double-quotes round-trips", () => {
    const report = { ...baseReport, title: `Uses "picking mode" to skip heavy shaders` };
    const fm = buildFrontmatterObject(report, baseConfig);
    const yamlStr = frontmatterToYaml(fm);
    const parsed = extractFrontmatterYaml(yamlStr);
    expect(parsed.title).toBe(`Uses "picking mode" to skip heavy shaders`);
  });

  it("tags array is seeded with the version string", () => {
    const fm = buildFrontmatterObject(baseReport, baseConfig);
    expect(fm.tags).toEqual([baseReport.version]);
  });

  it("bumpedBy matches blog.bumper@x.y.z format", () => {
    const fm = buildFrontmatterObject(baseReport, baseConfig);
    expect(fm.bumpedBy).toMatch(/^blog\.bumper@\d+\.\d+\.\d+$/);
  });

  it("section is always dev", () => {
    const fm = buildFrontmatterObject(baseReport, baseConfig);
    expect(fm.section).toBe("dev");
  });

  it("status comes from config.post.status", () => {
    const draftConfig = { ...baseConfig, post: { ...baseConfig.post, status: "draft" as const } };
    const fm = buildFrontmatterObject(baseReport, draftConfig);
    expect(fm.status).toBe("draft");
  });
});

// ── Boundary B — MDX body injection safety ─────────────────────────────────

describe("Boundary B — MDX body injection safety", () => {
  it("hostile JSX expression in highlight is a JSON string literal", () => {
    const report = { ...baseReport, highlights: ["{process.env.DISCORD_BOT_TOKEN}"] };
    const mdx = renderMDX(report, baseConfig);
    expect(mdx).toContain('"{process.env.DISCORD_BOT_TOKEN}"');
    expect(mdx).toContain(`items={["{process.env.DISCORD_BOT_TOKEN}"]}`);
  });

  it("script tag in highlight is a JSON string literal, not a JSX element", () => {
    const report = { ...baseReport, highlights: ["<script>alert(document.cookie)</script>"] };
    const mdx = renderMDX(report, baseConfig);
    expect(mdx).toContain('"<script>alert(document.cookie)</script>"');
    expect(mdx).not.toMatch(/<Changelog[^>]*>\s*<script>/);
  });

  it("backtick template literal in highlight is inert in JSON string", () => {
    const report = { ...baseReport, highlights: ["`${process.env.TOKEN}`"] };
    const mdx = renderMDX(report, baseConfig);
    expect(mdx).toContain('"`${process.env.TOKEN}`"');
  });

  it("closing brace in highlight is quoted and doesn't break items expression", () => {
    const report = { ...baseReport, highlights: ["some } tricky text here"] };
    const mdx = renderMDX(report, baseConfig);
    expect(mdx).toContain('"some } tricky text here"');
  });

  it("all highlights appear as a JSON array in the items prop", () => {
    const mdx = renderMDX(baseReport, baseConfig);
    const expected = JSON.stringify(baseReport.highlights);
    expect(mdx).toContain(`items={${expected}}`);
  });

  it("learnings appear in commentary comment when present", () => {
    const mdx = renderMDX(baseReport, baseConfig);
    expect(mdx).toContain("{/* learnings:");
    expect(mdx).toContain("First learning about the system");
  });

  it("empty learnings renders self-closing Commentary tag", () => {
    const report = { ...baseReport, learnings: [] };
    const mdx = renderMDX(report, baseConfig);
    expect(mdx).toContain("<Commentary />");
    expect(mdx).not.toContain("{/* learnings:");
  });

  it("DevLogEntry carries version and date as JSON-expression attributes", () => {
    const mdx = renderMDX(baseReport, baseConfig);
    expect(mdx).toContain(
      `<DevLogEntry version={${JSON.stringify(baseReport.version)}} date={${JSON.stringify(baseReport.date)}}>`,
    );
  });

  it("hostile version/date in DevLogEntry attributes are inert JSON string literals", () => {
    // Bypass Zod gate (which would catch these in production) to verify the writer
    // body is safe by its own logic, independent of the parser regex.
    const hostile = {
      ...baseReport,
      version: 'v1.0"><script>alert(1)</script>',
      date: '2026-01-01" onError="evil()',
    };
    const body = buildBody(hostile);
    // Values must appear as JSON-quoted string literals (inside JSX expression braces)
    expect(body).toContain(JSON.stringify(hostile.version));
    expect(body).toContain(JSON.stringify(hostile.date));
    // Attributes must use JSX expression form {JSON.stringify(...)}, not raw double-quote interpolation
    expect(body).toContain(`version={`);
    expect(body).toContain(`date={`);
    expect(body).not.toContain(`version="${hostile.version}"`);
    expect(body).not.toContain(`date="${hostile.date}"`);
  });

  it("rendered MDX starts with frontmatter block", () => {
    const mdx = renderMDX(baseReport, baseConfig);
    expect(mdx.startsWith("---\n")).toBe(true);
  });
});

// ── Zod gate ────────────────────────────────────────────────────────────────

describe("Zod gate — hard refusal on invalid frontmatter", () => {
  it("description shorter than 20 chars throws WriterError(validation)", () => {
    const report = { ...baseReport, description: "too short" };
    expect(() => buildFrontmatterObject(report, baseConfig)).toThrow(WriterError);
    try {
      buildFrontmatterObject(report, baseConfig);
    } catch (e) {
      expect((e as WriterError).code).toBe("validation");
    }
  });

  it("invalid module enum value throws WriterError(validation)", () => {
    const report = { ...baseReport, module: "malware" };
    expect(() => buildFrontmatterObject(report, baseConfig)).toThrow(WriterError);
    try {
      buildFrontmatterObject(report, baseConfig);
    } catch (e) {
      expect((e as WriterError).code).toBe("validation");
    }
  });

  it("commit not matching sha7 pattern throws WriterError(validation)", () => {
    const report = { ...baseReport, commit: "NOTSHA7!" };
    expect(() => buildFrontmatterObject(report, baseConfig)).toThrow(WriterError);
  });

  it("renderMDX propagates WriterError from Zod gate", () => {
    const report = { ...baseReport, description: "too short" };
    expect(() => renderMDX(report, baseConfig)).toThrow(WriterError);
  });
});

// ── Path resolution ─────────────────────────────────────────────────────────

describe("resolvePath", () => {
  it("substitutes {YYYY-MM-DD} and {slug}", () => {
    const path = resolvePath(baseConfig, baseReport);
    expect(path).toContain(baseReport.date);
    expect(path).toContain(baseReport.slug);
    expect(path).not.toContain("{YYYY-MM-DD}");
    expect(path).not.toContain("{slug}");
  });

  it("expands leading ~ to home directory", () => {
    const config = { ...baseConfig, target: { ...baseConfig.target, content_path: "~/.bumper/blog/{YYYY-MM-DD}/{slug}/index.mdx" } };
    const path = resolvePath(config, baseReport);
    expect(path.startsWith(homedir())).toBe(true);
    expect(path).not.toContain("~");
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe("idempotency", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bumper-writer-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function tempConfig(): Config {
    return {
      ...baseConfig,
      target: {
        ...baseConfig.target,
        content_path: join(tempDir, "{YYYY-MM-DD}/{slug}/index.mdx"),
      },
    };
  }

  it("first write returns status=written", () => {
    const result = writeMDX(baseReport, tempConfig(), false);
    expect(result.status).toBe("written");
    expect((result as { path: string }).path).toContain(baseReport.slug);
  });

  it("same commit → status=skipped with reason=duplicate", () => {
    const config = tempConfig();
    writeMDX(baseReport, config, false);
    const result = writeMDX(baseReport, config, false);
    expect(result.status).toBe("skipped");
    expect((result as { reason: string }).reason).toBe("duplicate");
  });

  it("different commit at same path → WriterError(conflict)", () => {
    const config = tempConfig();
    writeMDX(baseReport, config, false);
    const conflictReport = { ...baseReport, commit: "deadbee" };
    expect(() => writeMDX(conflictReport, config, false)).toThrow(WriterError);
    try {
      writeMDX(conflictReport, config, false);
    } catch (e) {
      expect((e as WriterError).code).toBe("conflict");
    }
  });

  it("dry run returns status=dry with mdx content, writes no file", () => {
    const config = tempConfig();
    const result = writeMDX(baseReport, config, true);
    expect(result.status).toBe("dry");
    expect((result as { mdx: string }).mdx).toContain("---");
    // No file written
    const expectedPath = resolvePath(config, baseReport);
    expect(existsSync(expectedPath)).toBe(false);
  });

  it("pre-seeded file with same commit is treated as duplicate", () => {
    const config = tempConfig();
    const expectedPath = resolvePath(config, baseReport);
    mkdirSync(dirname(expectedPath), { recursive: true });
    // Write a file that has the same commit in its frontmatter
    writeFileSync(
      expectedPath,
      `---\ncommit: ${baseReport.commit}\ntitle: old title\n---\n\nbody\n`,
      "utf-8",
    );
    const result = writeMDX(baseReport, config, false);
    expect(result.status).toBe("skipped");
  });
});
