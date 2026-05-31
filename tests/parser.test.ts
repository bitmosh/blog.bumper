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
  timezone: "America/Chicago",
};

const V030_INPUT = {
  content: fixture("v0.3.0.txt"),
  timestamp: "2026-05-29T05:24:08.297000+00:00",
  messageId: "1509789420159766528",
  configModule: "lumaweave",
  timezone: "America/Chicago",
};

// ── fixture round-trips ────────────────────────────────────────────────────

describe("v98.7 fixture (Project: present, Learnings: present)", () => {
  const result = parseReport(V98_7_INPUT);

  it("matches expected JSON exactly", () => {
    expect(result).toEqual(expected("v98.7.json"));
  });

  it("date comes from Discord timestamp in configured timezone", () => {
    // header says 2026-05-27 (work done then); Discord ts 2026-05-29T05:23:13Z = 2026-05-29 in CDT
    expect(result.date).toBe("2026-05-29");
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
    const result = parseReport({ content, timestamp: "2026-01-01T12:00:00.000Z", messageId: "0", configModule: "general", timezone: "America/Chicago" });
    expect(result.description).toBe("First highlight is the fallback description");
  });

  it("config default module used when Project: absent", () => {
    const content = `── PASS COMPLETE · v1.0 · 2026-01-01 ──────────────────────

Title: No project line here
Summary: This report has no project line at all, tests config default.

Highlights:
· Some highlight here to meet requirements

Commit: abc1234`;
    const result = parseReport({ content, timestamp: "2026-01-01T12:00:00.000Z", messageId: "0", configModule: "cerebra", timezone: "America/Chicago" });
    expect(result.module).toBe("cerebra");
  });

  it("date derived from Discord timestamp, not report header", () => {
    // Header says 2026-01-01 (when work was done); timestamp is 2026-01-02T08:00Z
    // In CST (UTC-6): 2026-01-02T02:00:00-06:00 → date = 2026-01-02 (timestamp wins)
    const content = `── PASS COMPLETE · v1.0 · 2026-01-01 ──────────────────────

Title: Date derivation check
Summary: Verifies date is sourced from the Discord timestamp not the report header.

Highlights:
· Header says 2026-01-01 but bumped Jan 2
· Date must match the timezone-aware timestamp

Commit: abc1234`;
    const result = parseReport({ content, timestamp: "2026-01-02T08:00:00.000Z", messageId: "0", configModule: "general", timezone: "America/Chicago" });
    expect(result.date).toBe("2026-01-02");
  });
});

// ── canonical contract fixture (v0.2.0 registry batch) ───────────────────

describe("canonical v0.2.0 registry-batch fixture (live report format lock)", () => {
  const content = fixture("pass-complete-registry-batch.txt");
  const result = parseReport({
    content,
    timestamp: "2026-05-30T18:00:00.000Z",
    messageId: "test-canonical",
    configModule: "fallback",
    timezone: "America/Chicago",
  });

  it("header recognised as v1 format", () => {
    expect(result.version).toBe("v0.2.0");
    expect(result.date).toBe("2026-05-30");
  });

  it("title extracted correctly", () => {
    expect(result.title).toBe("the project registry becomes populatable and manageable");
  });

  it("summary extracted as single-line description", () => {
    expect(result.description).toContain("scan a directory of git repos");
    expect(result.description.length).toBeGreaterThan(20);
  });

  it("Project: line sets module (overrides configModule)", () => {
    expect(result.module).toBe("blog.bumper");
  });

  it("slug is version-kebab + title-kebab", () => {
    expect(result.slug).toBe(
      "v0-2-0-the-project-registry-becomes-populatable-and-manageable",
    );
  });

  it("all four highlights extracted", () => {
    expect(result.highlights).toHaveLength(4);
    expect(result.highlights[0]).toBe(
      "git scanner discovers repos one level deep and detects .git as a file or directory, so worktrees and submodules are not silently missed",
    );
    expect(result.highlights[3]).toBe(
      "four project-* commands (add, list, info, remove) give full CLI management of enrolled projects, and never modify a project's repo on disk",
    );
  });

  it("all three learnings extracted", () => {
    expect(result.learnings).toHaveLength(3);
    expect(result.learnings[0]).toBe(
      "factoring git-detection into shared exports kept one source of truth for \"what counts as a repo\"",
    );
    expect(result.learnings[2]).toBe(
      "surfacing a dangling target reference in project-info is where the registry's referential-integrity gap gets caught usefully",
    );
  });

  it("commit is d29229c", () => {
    expect(result.commit).toBe("d29229c");
  });

  it("tests field extracted verbatim", () => {
    expect(result.tests).toBe("172 passed · 0 failed · 0 skipped");
  });

  it("branch field extracted", () => {
    expect(result.branch).toBe("clean");
  });
});

// ── timezone-aware date edge cases ────────────────────────────────────────

describe("timezone-aware date derivation edge cases", () => {
  function simpleReport(headerDate: string): string {
    return `── PASS COMPLETE · v1.0 · ${headerDate} ──────────────────────

Title: Timezone edge case
Summary: Testing timezone-aware date derivation with various rollover scenarios.

Highlights:
· First highlight for test

Commit: abc1234`;
  }

  it("22:41 CDT rollover — 03:41 UTC+1 next day maps to same local date (CDT)", () => {
    // e.g. work done 2026-05-27 at 22:41 CDT, Discord ts = 2026-05-28T03:41:00Z
    // CDT = UTC-5, so 2026-05-28T03:41Z = 2026-05-27T22:41-05:00 → date = 2026-05-27
    const result = parseReport({
      content: simpleReport("2026-05-27"),
      timestamp: "2026-05-28T03:41:00.000Z",
      messageId: "0",
      configModule: "general",
      timezone: "America/Chicago",
    });
    expect(result.date).toBe("2026-05-27");
  });

  it("23:59/00:01 CDT rollover — just before midnight stays same day", () => {
    // 2026-05-28T04:59Z = 2026-05-27T23:59-05:00 → date = 2026-05-27
    const result = parseReport({
      content: simpleReport("2026-05-27"),
      timestamp: "2026-05-28T04:59:00.000Z",
      messageId: "0",
      configModule: "general",
      timezone: "America/Chicago",
    });
    expect(result.date).toBe("2026-05-27");
  });

  it("23:59/00:01 CDT rollover — just after midnight advances day", () => {
    // 2026-05-28T05:01Z = 2026-05-28T00:01-05:00 → date = 2026-05-28
    const result = parseReport({
      content: simpleReport("2026-05-27"),
      timestamp: "2026-05-28T05:01:00.000Z",
      messageId: "0",
      configModule: "general",
      timezone: "America/Chicago",
    });
    expect(result.date).toBe("2026-05-28");
  });

  it("January CST (UTC-6) — offset is -06:00 not -05:00", () => {
    // CST in January: 2026-01-15T06:30:00Z = 2026-01-15T00:30:00-06:00
    const result = parseReport({
      content: simpleReport("2026-01-15"),
      timestamp: "2026-01-15T06:30:00.000Z",
      messageId: "0",
      configModule: "general",
      timezone: "America/Chicago",
    });
    expect(result.date).toBe("2026-01-15");
    expect(result.time).toBe("00:30:00-06:00");
  });

  it("Europe/London timezone — BST (UTC+1) in summer", () => {
    // BST = UTC+1, 2026-06-15T23:30:00Z = 2026-06-16T00:30:00+01:00
    const result = parseReport({
      content: simpleReport("2026-06-15"),
      timestamp: "2026-06-15T23:30:00.000Z",
      messageId: "0",
      configModule: "general",
      timezone: "Europe/London",
    });
    // BST rolls over midnight: local time is 2026-06-16T00:30+01:00
    expect(result.date).toBe("2026-06-16");
    expect(result.time).toMatch(/^00:30:00\+01:00$/);
  });
});

// ── failure path ───────────────────────────────────────────────────────────

describe("failure path", () => {
  it("throws ParseError for malformed fixture (missing Commit:)", () => {
    const content = fixture("malformed.txt");
    expect(() =>
      parseReport({ content, timestamp: "2026-06-01T00:00:00.000Z", messageId: "0", configModule: "general", timezone: "America/Chicago" })
    ).toThrow(ParseError);
  });

  it("ParseError names the failing field", () => {
    const content = fixture("malformed.txt");
    try {
      parseReport({ content, timestamp: "2026-06-01T00:00:00.000Z", messageId: "0", configModule: "general", timezone: "America/Chicago" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).field).toBe("commit");
    }
  });

  it("throws ParseError for unknown header format", () => {
    const content = "This is not a changelog report at all";
    expect(() =>
      parseReport({ content, timestamp: "2026-01-01T00:00:00.000Z", messageId: "0", configModule: "general", timezone: "America/Chicago" })
    ).toThrow(ParseError);
  });

  it("ParseError for unknown header names 'header' as field", () => {
    try {
      parseReport({ content: "not a report", timestamp: "2026-01-01T00:00:00.000Z", messageId: "0", configModule: "general", timezone: "America/Chicago" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as ParseError).field).toBe("header");
    }
  });
});
