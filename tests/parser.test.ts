import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseReport, ParseError } from "../src/parser/index.js";
import type { ParsedReport } from "../src/parser/index.js";

function fixture(name: string): string {
  return readFileSync(`tests/fixtures/reports/${name}`, "utf-8");
}

function expected(name: string): ParsedReport {
  return JSON.parse(readFileSync(`tests/fixtures/expected/${name}`, "utf-8")) as ParsedReport;
}

const V98_7_INPUT = {
  content: fixture("v98.7.txt"),
  timestamp: "2026-05-29T05:23:13.824000+00:00",
  messageId: "1509789191683444757",
  configModule: "lumaweave",
};

const V030_INPUT = {
  content: fixture("v0.3.0.txt"),
  timestamp: "2026-05-29T05:24:08.297000+00:00",
  messageId: "1509789420159766528",
  configModule: "lumaweave",
};

// ── fixture round-trips ────────────────────────────────────────────────────

describe("v98.7 fixture (Project: present, Learnings: present)", () => {
  const result = parseReport(V98_7_INPUT);

  it("matches expected JSON exactly", () => {
    expect(result).toEqual(expected("v98.7.json"));
  });

  it("date comes from report header, not Discord timestamp", () => {
    expect(result.date).toBe("2026-05-27"); // header says 2026-05-27; Discord ts is 2026-05-29
  });

  it("time is derived from Discord message timestamp in CST", () => {
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(result.time).toBe("00:23:13-05:00");
  });

  it("module resolved from Project: line", () => {
    expect(result.module).toBe("lumaweave");
  });

  it("slug is version-kebab + title-kebab", () => {
    expect(result.slug).toBe("v98-7-picking-mode-bailout-cuts-hover-cost");
  });

  it("description is the Summary: line", () => {
    expect(result.description).toContain("plasma fragment shader");
    expect(result.description.length).toBeGreaterThanOrEqual(20);
  });

  it("highlights extracted verbatim", () => {
    expect(result.highlights).toHaveLength(3);
    expect(result.highlights[0]).toBe("Picking pass early-returns from the plasma shader when PICKING_MODE is set");
  });

  it("learnings extracted", () => {
    expect(result.learnings).toHaveLength(2);
    expect(result.learnings[0]).toContain("readPixels");
  });

  it("commit is 7 hex chars", () => {
    expect(result.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(result.commit).toBe("c1f0a9d");
  });

  it("tests and branch are observability fields only", () => {
    expect(result.tests).toBe("41 passed · 0 failed · 0 skipped");
    expect(result.branch).toBe("clean");
  });
});

// ── v0.3.0: no Project, no Learnings ──────────────────────────────────────

describe("v0.3.0 fixture (Project: absent, Learnings: absent)", () => {
  const result = parseReport(V030_INPUT);

  it("matches expected JSON exactly", () => {
    expect(result).toEqual(expected("v0.3.0.json"));
  });

  it("module falls back to configModule when Project: is absent", () => {
    expect(result.module).toBe("lumaweave"); // from configModule, not report
  });

  it("learnings is empty array when section is absent", () => {
    expect(result.learnings).toEqual([]);
  });

  it("version-kebab handles three-part semver", () => {
    expect(result.slug).toMatch(/^v0-3-0-/);
  });

  it("slug strips comma from title", () => {
    expect(result.slug).toBe("v0-3-0-discord-rest-client-lands-zero-deps");
  });

  it("description preserves Discord channel mention verbatim", () => {
    expect(result.description).toContain("<#0000000000000000000>");
  });

  it("highlights preserve Discord channel mention verbatim", () => {
    expect(result.highlights[2]).toContain("<#0000000000000000000>");
  });
});

// ── derivation rules ───────────────────────────────────────────────────────

describe("derivation rules", () => {
  it("description falls back to first highlight when Summary: is absent", () => {
    const content = `── PASS COMPLETE · v1.0 · 2026-01-01 ──────────────────────

Title: Fallback test for description
Project: general

Highlights:
· First highlight is the fallback description
· Second highlight

Commit: abc1234
Tests: 1 passed
Branch: clean`;
    const result = parseReport({ content, timestamp: "2026-01-01T12:00:00.000Z", messageId: "0", configModule: "general" });
    expect(result.description).toBe("First highlight is the fallback description");
  });

  it("config default module used when Project: absent", () => {
    const content = `── PASS COMPLETE · v1.0 · 2026-01-01 ──────────────────────

Title: No project line here
Summary: This report has no project line at all, tests config default.

Highlights:
· Some highlight here to meet requirements

Commit: abc1234`;
    const result = parseReport({ content, timestamp: "2026-01-01T12:00:00.000Z", messageId: "0", configModule: "cerebra" });
    expect(result.module).toBe("cerebra");
  });

  it("date from header takes precedence over Discord timestamp date", () => {
    // Discord timestamp is Jan 2 but report header says Jan 1
    const content = `── PASS COMPLETE · v1.0 · 2026-01-01 ──────────────────────

Title: Date derivation check
Summary: Verifies date is sourced from the report header not the Discord message timestamp.

Highlights:
· Date in header is 2026-01-01
· Discord timestamp is a day later

Commit: abc1234`;
    const result = parseReport({ content, timestamp: "2026-01-02T00:00:00.000Z", messageId: "0", configModule: "general" });
    expect(result.date).toBe("2026-01-01");
  });
});

// ── failure path ───────────────────────────────────────────────────────────

describe("failure path", () => {
  it("throws ParseError for malformed fixture (missing Commit:)", () => {
    const content = fixture("malformed.txt");
    expect(() =>
      parseReport({ content, timestamp: "2026-06-01T00:00:00.000Z", messageId: "0", configModule: "general" })
    ).toThrow(ParseError);
  });

  it("ParseError names the failing field", () => {
    const content = fixture("malformed.txt");
    try {
      parseReport({ content, timestamp: "2026-06-01T00:00:00.000Z", messageId: "0", configModule: "general" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).field).toBe("commit");
    }
  });

  it("throws ParseError for unknown header format", () => {
    const content = "This is not a changelog report at all";
    expect(() =>
      parseReport({ content, timestamp: "2026-01-01T00:00:00.000Z", messageId: "0", configModule: "general" })
    ).toThrow(ParseError);
  });

  it("ParseError for unknown header names 'header' as field", () => {
    try {
      parseReport({ content: "not a report", timestamp: "2026-01-01T00:00:00.000Z", messageId: "0", configModule: "general" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as ParseError).field).toBe("header");
    }
  });
});
