import { z } from "zod";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

// ── Target ─────────────────────────────────────────────────────────────────
// Mirrors config.ts's target block; lives under [targets.<name>] in TOML.

const targetSchema = z.object({
  repo: z.string().url(),
  branch: z.string().default("main"),
  content_path: z.string().min(1),
  local_clone: z.string().min(1),
});

export type Target = z.infer<typeof targetSchema>;

// ── Project ────────────────────────────────────────────────────────────────
// One entry in the [[project]] array-of-tables.

const projectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  remote: z.string().default(""),
  target: z.string().min(1).default("default"),
});

export type Project = z.infer<typeof projectSchema>;

// ── Registry ───────────────────────────────────────────────────────────────
// Top-level shape of ~/.bumper/projects.toml.
// smol-toml maps [targets.<name>] → targets: Record<string, Target>
//              and [[project]] → project: Project[]

export const registrySchema = z.object({
  targets: z.record(z.string(), targetSchema).default({}),
  project: z.array(projectSchema).default([]),
});

export type Registry = z.infer<typeof registrySchema>;

// ── Parse ──────────────────────────────────────────────────────────────────
// Mirrors parseConfig: safeParse, collect all issues, throw RegistryError.

export function parseRegistry(raw: unknown): Registry {
  const result = registrySchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new RegistryError(`Invalid projects.toml:\n${issues}`);
  }
  return result.data;
}
