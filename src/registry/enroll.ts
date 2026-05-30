import { input, confirm, checkbox } from "@inquirer/prompts";
import { scanForRepos, type ScannedRepo } from "./scan.js";
import {
  loadRegistry,
  saveRegistry,
  addProject,
} from "./store.js";
import { RegistryError, type Registry, type Project } from "./schema.js";

export type EnrollResult = {
  enrolled: Project[];
  skipped: string[]; // names already in the registry
};

/**
 * Interactive scan → pick → enroll flow.
 * Prompts the user for a projects directory, scans it, presents a checkbox
 * picker, and writes selected repos into the registry.
 *
 * registryPath: optional override for the registry file location (passed
 * through to loadRegistry/saveRegistry — useful for testing).
 */
export async function runEnrollFlow(registryPath?: string): Promise<EnrollResult> {
  const wantsEnroll = await confirm({
    message: "Do you have a directory of projects (git repos) to enroll?",
    default: false,
  });

  if (!wantsEnroll) {
    return { enrolled: [], skipped: [] };
  }

  // Retry loop: re-prompt on scan errors (nonexistent dir, etc.)
  let repos: ScannedRepo[] = [];
  while (true) {
    const dir = await input({ message: "Path to your projects directory:" });

    try {
      repos = scanForRepos(dir);
    } catch (e) {
      console.error(`  ${e instanceof Error ? e.message : String(e)}`);
      continue; // re-prompt
    }

    if (repos.length === 0) {
      console.log(`  no git repos found in ${dir}`);
      return { enrolled: [], skipped: [] };
    }

    break;
  }

  const choices = repos.map((repo) => ({
    name: repo.remote === null ? `${repo.name} (local-only)` : repo.name,
    value: repo,
  }));

  const selected = (await checkbox<ScannedRepo>({
    message: "Select repos to enroll (space to select, enter to confirm):",
    choices,
  })) as ScannedRepo[];

  if (selected.length === 0) {
    console.log("  nothing selected — no repos enrolled.");
    return { enrolled: [], skipped: [] };
  }

  let registry: Registry = loadRegistry(registryPath);
  const enrolled: Project[] = [];
  const skipped: string[] = [];

  for (const repo of selected) {
    const project: Project = {
      name: repo.name,
      path: repo.path,
      remote: repo.remote ?? "",
      target: "default",
    };

    try {
      registry = addProject(registry, project);
      enrolled.push(project);
    } catch (e) {
      if (e instanceof RegistryError) {
        console.log(`  ${repo.name} already enrolled, skipping`);
        skipped.push(repo.name);
      } else {
        throw e;
      }
    }
  }

  if (enrolled.length > 0) {
    saveRegistry(registry, registryPath);
    console.log(`\n  enrolled ${enrolled.length} project(s):`);
    for (const p of enrolled) {
      console.log(`    ${p.name}  →  target: ${p.target}`);
    }
  }

  return { enrolled, skipped };
}
