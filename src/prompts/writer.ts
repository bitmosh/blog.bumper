import { stringify as tomlStringify } from "smol-toml";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { confirm } from "@inquirer/prompts";
import { parseConfig } from "../config.js";

export type WriteOutcome = {
  tomlPath: string;
  envPath: string;
  tomlWritten: boolean;
  envUpdated: boolean;
};

/**
 * Validates the assembled config via Zod, serializes to TOML, writes .bumper.toml.
 * Appends or creates .env with the token env var stub.
 * Prompts before overwriting any existing file.
 */
export async function writeConfigFiles(
  raw: Record<string, unknown>,
  cwd: string,
): Promise<WriteOutcome> {
  // Validate through Zod before touching the filesystem — fail fast.
  const validated = parseConfig(raw);

  const tomlPath = resolve(cwd, ".bumper.toml");
  const envPath = resolve(cwd, ".env");
  let tomlWritten = false;
  let envUpdated = false;

  // ── .bumper.toml ──────────────────────────────────────────────────────
  if (existsSync(tomlPath)) {
    const ok = await confirm({
      message: ".bumper.toml already exists. Overwrite?",
      default: false,
    });
    if (!ok) {
      console.log("  skipped .bumper.toml (kept existing)");
    } else {
      writeFileSync(tomlPath, tomlStringify(validated as Record<string, unknown>), "utf-8");
      console.log(`  wrote ${tomlPath}`);
      tomlWritten = true;
    }
  } else {
    writeFileSync(tomlPath, tomlStringify(validated as Record<string, unknown>), "utf-8");
    console.log(`  wrote ${tomlPath}`);
    tomlWritten = true;
  }

  // ── .env ──────────────────────────────────────────────────────────────
  const tokenKey = validated.source.token_env;

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, "utf-8");
    if (existing.split("\n").some((line) => line.startsWith(tokenKey + "="))) {
      console.log(`  .env already contains ${tokenKey}= — not modified`);
    } else {
      const appended = existing.endsWith("\n") ? existing : existing + "\n";
      writeFileSync(envPath, appended + `${tokenKey}=\n`, "utf-8");
      console.log(`  appended ${tokenKey}= to existing .env`);
      envUpdated = true;
    }
  } else {
    writeFileSync(envPath, `${tokenKey}=\n`, "utf-8");
    console.log(`  wrote .env (add your bot token — .env is gitignored)`);
    envUpdated = true;
  }

  return { tomlPath, envPath, tomlWritten, envUpdated };
}
