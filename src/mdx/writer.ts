import matter from "gray-matter";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { buildFrontmatterObject, frontmatterToYaml, WriterError } from "./frontmatter.js";
import type { ParsedReport } from "../parser/index.js";
import type { Config } from "../config.js";

export { WriterError } from "./frontmatter.js";

export type WriteResult =
  | { status: "written"; path: string }
  | { status: "skipped"; path: string; reason: "duplicate" }
  | { status: "dry"; path: string; mdx: string };

export function resolvePath(config: Config, report: ParsedReport): string {
  return config.target.content_path
    .replace(/^~(?=\/|$)/, homedir())
    .replace("{YYYY-MM-DD}", report.date)
    .replace("{slug}", report.slug);
}

export function buildBody(report: ParsedReport): string {
  const itemsJson = JSON.stringify(report.highlights);
  const versionJson = JSON.stringify(report.version);
  const dateJson = JSON.stringify(report.date);
  const commentary =
    report.learnings.length > 0
      ? `<Commentary>{/* learnings: ${report.learnings.join(" | ")} */}</Commentary>`
      : `<Commentary />`;
  return [
    `<DevLogEntry version={${versionJson}} date={${dateJson}}>`,
    `  <Changelog items={${itemsJson}} />`,
    `  ${commentary}`,
    `</DevLogEntry>`,
  ].join("\n");
}

export function renderMDX(report: ParsedReport, config: Config): string {
  const fm = buildFrontmatterObject(report, config);
  const yaml = frontmatterToYaml(fm);
  return yaml + "\n" + buildBody(report) + "\n";
}

export function writeMDX(
  report: ParsedReport,
  config: Config,
  dry: boolean,
): WriteResult {
  const path = resolvePath(config, report);
  const mdx = renderMDX(report, config);

  if (dry) return { status: "dry", path, mdx };

  if (existsSync(path)) {
    const existing = matter(readFileSync(path, "utf-8"));
    const existingCommit = existing.data.commit as string | undefined;
    if (existingCommit === report.commit) {
      return { status: "skipped", path, reason: "duplicate" };
    }
    throw new WriterError(
      `${path} already exists with commit=${existingCommit ?? "unknown"}, refusing to overwrite (incoming commit=${report.commit})`,
      "conflict",
    );
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, mdx, "utf-8");
  } catch (e) {
    throw new WriterError(
      `failed to write ${path}: ${e instanceof Error ? e.message : String(e)}`,
      "io",
    );
  }

  return { status: "written", path };
}
