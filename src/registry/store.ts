import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import {
  parseRegistry,
  RegistryError,
  type Registry,
  type Project,
  type Target,
} from "./schema.js";

// ── Path resolution ────────────────────────────────────────────────────────

export function resolveRegistryPath(override?: string): string {
  if (override) return resolve(override);
  return resolve(homedir(), ".bumper", "projects.toml");
}

// ── Load ───────────────────────────────────────────────────────────────────
// A missing registry file is not an error — it means nothing is enrolled yet.
// Mirrors config.ts's ENOENT handling but returns an empty registry instead of throwing.

export function loadRegistry(path?: string): Registry {
  const absPath = resolveRegistryPath(path);
  let raw: unknown;
  try {
    const text = readFileSync(absPath, "utf-8");
    raw = parseTOML(text);
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      return parseRegistry({});
    }
    throw new RegistryError(
      `Failed to parse projects.toml: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return parseRegistry(raw);
}

// ── Save ───────────────────────────────────────────────────────────────────
// Validates before writing so the file is never left in a corrupt state.

export function saveRegistry(registry: Registry, path?: string): void {
  const validated = parseRegistry(registry);
  const absPath = resolveRegistryPath(path);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, stringifyTOML(validated as Record<string, unknown>), "utf-8");
}

// ── Query helpers ──────────────────────────────────────────────────────────

export function findProject(registry: Registry, name: string): Project | undefined {
  return registry.project.find((p) => p.name === name);
}

export function listProjects(registry: Registry): Project[] {
  return registry.project;
}

export function findTarget(registry: Registry, name: string): Target | undefined {
  return registry.targets[name];
}

// ── Mutation helpers (pure — return new registry, caller saves) ────────────

export function addProject(registry: Registry, project: Project): Registry {
  if (findProject(registry, project.name)) {
    throw new RegistryError(
      `Project "${project.name}" is already enrolled. Use removeProject first or edit projects.toml directly.`,
    );
  }
  return { ...registry, project: [...registry.project, project] };
}

export function removeProject(registry: Registry, name: string): Registry {
  if (!findProject(registry, name)) {
    throw new RegistryError(`Project "${name}" is not enrolled.`);
  }
  return { ...registry, project: registry.project.filter((p) => p.name !== name) };
}

export function upsertTarget(registry: Registry, name: string, target: Target): Registry {
  return {
    ...registry,
    targets: { ...registry.targets, [name]: target },
  };
}
