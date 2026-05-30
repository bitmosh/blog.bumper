import { describe, it, expect } from "vitest";
import { frontmatterSchema } from "../src/schema/frontmatter.js";

const base = {
  title: "blog bumper launch",
  description: "The first pass-post written by blog.bumper itself, proving the pipeline end-to-end.",
  date: "2026-05-28",
  time: "22:15:00-05:00",
  section: "dev" as const,
  category: "dev-log" as const,
  module: "lumaweave" as const,
  version: "v98.5",
  tags: ["v98.5"],
  status: "published" as const,
  commit: "d3a1c76",
  bumpedBy: "blog.bumper@0.1.0",
};

describe("frontmatterSchema", () => {
  it("accepts a valid frontmatter object", () => {
    expect(frontmatterSchema.safeParse(base).success).toBe(true);
  });

  it("rejects description shorter than 20 chars", () => {
    expect(frontmatterSchema.safeParse({ ...base, description: "too short" }).success).toBe(false);
  });

  it("rejects description longer than 200 chars", () => {
    expect(frontmatterSchema.safeParse({ ...base, description: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects an invalid date format", () => {
    expect(frontmatterSchema.safeParse({ ...base, date: "28-05-2026" }).success).toBe(false);
  });

  it("rejects time without offset", () => {
    expect(frontmatterSchema.safeParse({ ...base, time: "22:15" }).success).toBe(false);
  });

  it("accepts time without seconds", () => {
    expect(frontmatterSchema.safeParse({ ...base, time: "22:15-05:00" }).success).toBe(true);
  });

  it("accepts time with seconds", () => {
    expect(frontmatterSchema.safeParse({ ...base, time: "22:15:30-05:00" }).success).toBe(true);
  });

  it("accepts any non-empty module string", () => {
    expect(frontmatterSchema.safeParse({ ...base, module: "phantom" }).success).toBe(true);
  });

  it("rejects an empty module string", () => {
    expect(frontmatterSchema.safeParse({ ...base, module: "" }).success).toBe(false);
  });

  it("rejects version without v prefix", () => {
    expect(frontmatterSchema.safeParse({ ...base, version: "98.5" }).success).toBe(false);
  });

  it("accepts vXX.Y.Z three-part version", () => {
    expect(frontmatterSchema.safeParse({ ...base, version: "v98.5.1" }).success).toBe(true);
  });

  it("rejects a commit that is not 7 hex chars", () => {
    expect(frontmatterSchema.safeParse({ ...base, commit: "d3a1c7" }).success).toBe(false); // 6
    expect(frontmatterSchema.safeParse({ ...base, commit: "d3a1c76z" }).success).toBe(false); // non-hex
  });

  it("rejects an invalid bumpedBy format", () => {
    expect(frontmatterSchema.safeParse({ ...base, bumpedBy: "bumper@0.1.0" }).success).toBe(false);
  });

  it("defaults category to dev-log when omitted", () => {
    const { category: _c, ...rest } = base;
    const result = frontmatterSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.category).toBe("dev-log");
  });

  it("defaults tags to [] when omitted", () => {
    const { tags: _t, ...rest } = base;
    const result = frontmatterSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tags).toEqual([]);
  });

  it("defaults status to published when omitted", () => {
    const { status: _s, ...rest } = base;
    const result = frontmatterSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("published");
  });
});
