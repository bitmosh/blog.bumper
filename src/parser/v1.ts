import { ParseError } from "./types.js";
import type { ParseInput, ParsedReport } from "./types.js";

// Matches: ── PASS COMPLETE · vXX.Y[.Z] · YYYY-MM-DD ──
const HEADER_RE =
  /── PASS COMPLETE · (v\d+(?:\.\d+){1,2}) · (\d{4}-\d{2}-\d{2}) ──/;

export function isV1Format(content: string): boolean {
  return HEADER_RE.test(content);
}

export function parseV1(input: ParseInput): ParsedReport {
  const { content, timestamp, configModule } = input;

  const header = content.match(HEADER_RE);
  if (!header) throw new ParseError("v1 header not found", "header");

  const version = header[1];
  const date = header[2];
  const { time } = toChicagoTime(timestamp);

  const title = required(content, /^Title:\s*(.+)$/m, "title");
  const summary = optional(content, /^Summary:\s*(.+)$/m);
  const project = optional(content, /^Project:\s*(.+)$/m);
  const commit = required(content, /^Commit:\s*([0-9a-f]{7})\b/im, "commit");

  const highlights = bullets(content, "Highlights:");
  const learnings = bullets(content, "Learnings:");

  const description = summary?.trim() ?? highlights[0] ?? "";
  if (description.length < 20) {
    process.stderr.write(
      `warning: description is ${description.length} chars (below 20-char floor); Zod will refuse at write time\n`,
    );
  }

  // Warn if Discord channel-mention tokens survived in prose. Discord rewrites bare #channel
  // references into <#snowflake> links before bumper reads the message; the rendered MDX will
  // show the raw token as literal text, which is inert but ugly.
  const channelMentionRe = /<#\d{17,20}>/;
  const allText = [description, ...highlights, ...learnings].join("\n");
  if (channelMentionRe.test(allText)) {
    process.stderr.write(
      `warning: unresolved Discord channel mention (<#...>) found in description or highlights — ` +
        `avoid bare #channel-name references in reports (see CHANGELOG_CONTRACT.md)\n`,
    );
  }

  const slug = buildSlug(version, title.trim());

  return {
    version,
    date,
    time,
    title: title.trim(),
    slug,
    description: description,
    module: (project?.trim() ?? configModule),
    highlights,
    learnings,
    commit: commit.trim().toLowerCase(),
    tests: optional(content, /^Tests:\s*(.+)$/m)?.trim(),
    branch: optional(content, /^Branch:\s*(.+)$/m)?.trim(),
  };
}

function required(content: string, re: RegExp, field: string): string {
  const m = content.match(re);
  if (!m) throw new ParseError(`Missing required field: ${field}`, field);
  return m[1];
}

function optional(content: string, re: RegExp): string | undefined {
  return content.match(re)?.[1];
}

function bullets(content: string, sectionName: string): string[] {
  const idx = content.indexOf(`\n${sectionName}\n`);
  if (idx === -1) return [];

  const after = content.slice(idx + 1 + sectionName.length + 1);
  const result: string[] = [];

  for (const line of after.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("·")) {
      result.push(trimmed.slice(1).trim());
    } else if (trimmed !== "") {
      break; // end of section
    }
    // blank lines skipped — allows spacing between section header and first bullet
  }

  return result;
}

function buildSlug(version: string, title: string): string {
  const versionKebab = version.replace(/\./g, "-");
  const titleKebab = title
    .toLowerCase()
    .replace(/_/g, " ")           // underscores → spaces before stripping
    .replace(/[^a-z0-9\s]/g, "") // strip remaining punctuation
    .trim()
    .replace(/\s+/g, "-");
  return `${versionKebab}-${titleKebab}`;
}

function toChicagoTime(isoTimestamp: string): { date: string; time: string } {
  const dt = new Date(isoTimestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(dt);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

  // Intl returns "24" for midnight with hour12:false in some engines — normalize to "00"
  const hour = get("hour") === "24" ? "00" : get("hour");

  const tzRaw = get("timeZoneName"); // "GMT-5" or "GMT-6"
  const tzMatch = tzRaw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const sign = tzMatch?.[1] ?? "-";
  const tzH = (tzMatch?.[2] ?? "6").padStart(2, "0");
  const tzM = (tzMatch?.[3] ?? "00").padStart(2, "0");
  const offset = `${sign}${tzH}:${tzM}`;

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}:${get("second")}${offset}`,
  };
}
