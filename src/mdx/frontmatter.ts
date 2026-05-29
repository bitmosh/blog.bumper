import { stringify as yamlStringify } from "yaml";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { frontmatterSchema } from "../schema/frontmatter.js";
import type { ParsedReport } from "../parser/index.js";
import type { Config } from "../config.js";
import type { Frontmatter } from "../schema/frontmatter.js";

export class WriterError extends Error {
  constructor(
    message: string,
    public readonly code: "validation" | "conflict" | "io",
  ) {
    super(message);
    this.name = "WriterError";
  }
}

function readBumperVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}

export function buildFrontmatterObject(report: ParsedReport, config: Config): Frontmatter {
  const obj = {
    title: report.title,
    description: report.description,
    date: report.date,
    time: report.time,
    section: "dev" as const,
    category: "dev-log" as const,
    module: report.module,
    version: report.version,
    tags: [report.version],
    status: config.post.status,
    commit: report.commit,
    bumpedBy: `blog.bumper@${readBumperVersion()}`,
  };

  const result = frontmatterSchema.safeParse(obj);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new WriterError(`frontmatter validation failed: ${issues}`, "validation");
  }
  return result.data;
}

export function frontmatterToYaml(fm: Frontmatter): string {
  return `---\n${yamlStringify(fm)}---\n`;
}
