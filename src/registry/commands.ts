import { confirm, input } from "@inquirer/prompts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { isGitRepo, resolveOriginRemote } from "./scan.js";
import {
  loadRegistry,
  saveRegistry,
  addProject,
  removeProject,
  findProject,
  findTarget,
  listProjects,
} from "./store.js";
import { RegistryError } from "./schema.js";

function expandPath(p: string): string {
  return resolve(p.replace(/^~(?=\/|$)/, homedir()));
}

// ── project-add ────────────────────────────────────────────────────────────

export async function addProjectCmd(
  name: string,
  opts: { path?: string },
  registryPath?: string,
): Promise<void> {
  let projectPath: string;
  if (opts.path) {
    projectPath = expandPath(opts.path);
  } else {
    const raw = await input({ message: `Local path to "${name}":` });
    projectPath = expandPath(raw);
  }

  if (!existsSync(projectPath)) {
    throw new Error(`path not found: ${projectPath}`);
  }
  if (!isGitRepo(projectPath)) {
    throw new Error(`${projectPath} is not a git repository (no .git entry found)`);
  }

  const remote = resolveOriginRemote(projectPath);
  const project = { name, path: projectPath, remote: remote ?? "", target: "default" };

  let registry = loadRegistry(registryPath);
  try {
    registry = addProject(registry, project);
  } catch (e) {
    if (e instanceof RegistryError) {
      throw new Error(`Project "${name}" is already enrolled. Use project-remove first to re-enroll.`);
    }
    throw e;
  }
  saveRegistry(registry, registryPath);

  console.log(`enrolled: ${name}`);
  console.log(`  path:   ${projectPath}`);
  console.log(`  remote: ${remote ?? "(local-only)"}`);
  console.log(`  target: default`);
}

// ── project-list ───────────────────────────────────────────────────────────

export function listProjectsCmd(registryPath?: string): void {
  const registry = loadRegistry(registryPath);
  const projects = listProjects(registry);

  if (projects.length === 0) {
    console.log("No projects enrolled yet. Run `bumper project-add <name>` or the init wizard.");
    return;
  }

  const col = (s: string, w: number) => s.padEnd(w);
  const wName   = Math.max(4, ...projects.map((p) => p.name.length));
  const wRemote = Math.max(6, ...projects.map((p) => (p.remote || "(local-only)").length));

  console.log(`${col("NAME", wName)}  ${col("REMOTE", wRemote)}  TARGET  PATH`);
  console.log("─".repeat(wName + wRemote + 30));
  for (const p of projects) {
    const remote = p.remote || "(local-only)";
    console.log(`${col(p.name, wName)}  ${col(remote, wRemote)}  ${p.target.padEnd(6)}  ${p.path}`);
  }
}

// ── project-info ───────────────────────────────────────────────────────────

export function infoProjectCmd(name: string, registryPath?: string): void {
  const registry = loadRegistry(registryPath);
  const project = findProject(registry, name);

  if (!project) {
    throw new Error(
      `Project "${name}" not found. Run \`bumper project-list\` to see enrolled projects.`,
    );
  }

  console.log(`name:   ${project.name}`);
  console.log(`path:   ${project.path}`);
  console.log(`remote: ${project.remote || "(local-only)"}`);
  console.log(`target: ${project.target}`);
  console.log("");

  const target = findTarget(registry, project.target);
  if (!target) {
    console.log(
      `⚠ target '${project.target}' referenced but not defined in registry — run \`bumper init\` to configure targets.`,
    );
    return;
  }

  console.log(`Target '${project.target}':`);
  console.log(`  repo:         ${target.repo}`);
  console.log(`  branch:       ${target.branch}`);
  console.log(`  content_path: ${target.content_path}`);
  console.log(`  local_clone:  ${target.local_clone}`);
}

// ── project-remove ─────────────────────────────────────────────────────────

export async function removeProjectCmd(
  name: string,
  opts: { yes?: boolean },
  registryPath?: string,
): Promise<void> {
  const registry = loadRegistry(registryPath);
  const project = findProject(registry, name);

  if (!project) {
    throw new Error(
      `Project "${name}" not found. Run \`bumper project-list\` to see enrolled projects.`,
    );
  }

  if (!opts.yes) {
    const ok = await confirm({
      message: `Remove "${name}" from the registry? This does not touch the project on disk.`,
      default: false,
    });
    if (!ok) {
      console.log("Cancelled — nothing changed.");
      return;
    }
  }

  saveRegistry(removeProject(registry, name), registryPath);

  console.log(`removed: ${name}`);
  console.log(`  (registry entry only — ${project.path} on disk is untouched)`);
}
