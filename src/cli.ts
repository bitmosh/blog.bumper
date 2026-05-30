import { Command } from "commander";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, EXAMPLE_TOML } from "./config.js";
import {
  DiscordError,
  parseChannelId,
  postDebug,
  resolveMessage,
} from "./discord.js";
import { parseReport, ParseError } from "./parser/index.js";
import { renderMDX, WriterError } from "./mdx/writer.js";
import { bumpRepo, GitError, buildGitPlan } from "./git/driver.js";
import {
  addProjectCmd,
  listProjectsCmd,
  infoProjectCmd,
  removeProjectCmd,
} from "./registry/commands.js";
import { loadRegistry } from "./registry/store.js";
import { resolveRoute, RouteError } from "./registry/route.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("bumper")
  .description(
    "Parse Bandit's #changelog reports and land pass-posts in the blog's daily container",
  )
  .version(VERSION);

program
  .command("init")
  .description("Interactive setup wizard — produces .bumper.toml and .env")
  .option("--example", "write .bumper.example.toml instead of running the wizard")
  .option("--force", "overwrite .bumper.example.toml if it exists (only with --example)")
  .action(async (opts: { example?: boolean; force?: boolean }) => {
    if (opts.example) {
      // Legacy behavior: write the static example file.
      const dest = resolve(process.cwd(), ".bumper.example.toml");
      if (existsSync(dest) && !opts.force) {
        console.error("error: .bumper.example.toml already exists (pass --force to overwrite)");
        process.exit(1);
      }
      writeFileSync(dest, EXAMPLE_TOML, "utf-8");
      console.log("wrote .bumper.example.toml");
      return;
    }

    // Interactive wizard.
    const { runWizard } = await import("./prompts/runner.js");
    const { manifest, assembleConfig } = await import("./prompts/manifest.js");
    const { writeConfigFiles } = await import("./prompts/writer.js");
    const { confirm } = await import("@inquirer/prompts");

    console.log("\nblog.bumper setup wizard\n");

    let answers: Record<string, unknown>;
    try {
      answers = await runWizard(manifest);
    } catch (e) {
      // User pressed Ctrl-C (ExitPromptError) — exit cleanly.
      if (e instanceof Error && e.name === "ExitPromptError") {
        console.log("\ncancelled.");
        process.exit(0);
      }
      throw e;
    }

    const raw = assembleConfig(answers);

    console.log("\nwriting config...");
    let outcome;
    try {
      outcome = await writeConfigFiles(raw, process.cwd());
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }

    console.log("\ndone.");
    if (outcome.tomlWritten) console.log(`  .bumper.toml → ${outcome.tomlPath}`);
    if (outcome.envUpdated) console.log(`  .env         → ${outcome.envPath}`);

    // Determine the token env var name from the assembled config.
    const sourceSection = raw["source"] as Record<string, unknown>;
    const tokenEnvKey =
      typeof sourceSection?.token_env === "string"
        ? sourceSection.token_env
        : "DISCORD_BOT_TOKEN";

    // Check if the token is actually set: in process.env OR non-empty in .env.
    const tokenInEnv = !!(process.env[tokenEnvKey]);
    let tokenInFile = false;
    try {
      const envContent = readFileSync(outcome.envPath, "utf-8");
      const line = envContent.split("\n").find((l) => l.startsWith(tokenEnvKey + "="));
      if (line) tokenInFile = line.slice(tokenEnvKey.length + 1).trim().length > 0;
    } catch { /* .env absent or unreadable */ }

    if (tokenInEnv || tokenInFile) {
      // Token is present — the verify run will actually work.
      const runDry = await confirm({
        message: "Run `bumper bump --dry` to verify the config?",
        default: false,
      }).catch(() => false);

      if (runDry) {
        console.log("\nrun: bumper bump --dry --config .bumper.toml");
      }
    } else {
      // Token is empty — guide the user rather than offering a verify that would fail.
      console.log(`
✓ Config written.

One more step before you can post:
  1. Add your Discord bot token to .env — open it and fill in the ${tokenEnvKey}= line.
  2. Then verify with:  bumper bump --dry

(.env is gitignored — your token stays local. See DISCORD_SETUP.md if you still need to create a bot.)`);
    }
  });

program
  .command("bump")
  .description("Fetch a report from #changelog and land a pass-post")
  .option("--last", "bump the second-most-recent report (buffer=1 default)")
  .option("--msg <id>", "bump a specific Discord message by ID")
  .option("--config <path>", "path to .bumper.toml", ".bumper.toml")
  .option("--dry", "fetch, parse, and validate — but do not write or push")
  .action(async (opts: { last?: boolean; msg?: string; config: string; dry?: boolean }) => {
    const config = loadConfig(opts.config);

    const token = process.env[config.source.token_env] ?? "";
    if (!token) {
      console.error(
        `error: ${config.source.token_env} is not set — add it to .env (see .env.example)`,
      );
      process.exit(1);
    }

    const reportChannelId = parseChannelId(config.source.report_channel);
    const debugChannelId = parseChannelId(config.source.debug_channel);
    const t0 = Date.now();
    const dry = !!opts.dry;
    const source = opts.msg ? `--msg ${opts.msg}` : `buffer=${config.source.buffer}`;

    try {
      const message = await resolveMessage(
        reportChannelId,
        token,
        config.source.buffer,
        opts.msg,
      );

      if (!message) {
        const outcome = "no-op — channel too short for buffer position";
        await sendTrace(debugChannelId, token, source, outcome, dry, t0);
        if (config.guard.skip_if_no_report) {
          console.log(`bumper: ${outcome}`);
          return;
        }
        console.error(`error: ${outcome}`);
        process.exit(1);
      }

      // ── parse ──────────────────────────────────────────────────────────
      let parsed;
      try {
        parsed = parseReport({
          content: message.content,
          timestamp: message.timestamp,
          messageId: message.id,
          configModule: config.source.module,
        });
      } catch (e) {
        if (e instanceof ParseError) {
          const failDir = "parse-failures";
          mkdirSync(failDir, { recursive: true });
          const fname = `${failDir}/${Date.now()}-${message.id}.txt`;
          writeFileSync(fname, message.content, "utf-8");
          const traceMsg = `parse failed — field: ${e.field} — ${e.message}`;
          console.error(`error: ${e.message}`);
          console.error(`  raw text saved to ${fname}`);
          await sendTrace(debugChannelId, token, source, traceMsg, dry, t0).catch(() => {});
          process.exit(1);
        }
        throw e; // unexpected — rethrow to outer handler
      }

      // ── route ──────────────────────────────────────────────────────────
      let routedParsed: typeof parsed;
      let routedConfig: typeof config;
      try {
        const registry = loadRegistry();
        const route = resolveRoute(parsed.module, registry, config);
        routedParsed = { ...parsed, module: route.module };
        routedConfig = { ...config, target: route.target };
        if (dry) {
          console.log(`[dry] route: ${route.source} (module=${route.module})`);
        }
      } catch (e) {
        if (e instanceof RouteError) {
          console.error(`error: ${e.message}`);
          await sendTrace(debugChannelId, token, source, `route error: ${e.message}`, dry, t0).catch(() => {});
          process.exit(1);
        }
        throw e;
      }

      if (dry) {
        console.log(`[dry] fetched ${message.id} via ${source}`);
        console.log("[dry] parsed report:");
        console.log(JSON.stringify(routedParsed, null, 2));
      } else {
        console.log(`fetched ${message.id} via ${source}`);
      }

      // ── MDX + git ──────────────────────────────────────────────────────
      let outcome: string;
      try {
        if (dry) {
          const mdx = renderMDX(routedParsed, routedConfig); // Zod gate
          console.log("[dry] MDX:");
          console.log(mdx);
          const plan = buildGitPlan(routedConfig, routedParsed);
          console.log("[dry] git plan:");
          console.log(`  clone/pull:  ${plan.cloneOrPull}`);
          console.log(`  target:      ${plan.targetPath}`);
          console.log(`  commit:      ${plan.commitMessage}`);
          console.log(`  push target: ${plan.pushTarget}`);
          outcome = `dry-run — ${parsed.version} ${parsed.commit}`;
        } else {
          const bumpResult = await bumpRepo(routedParsed, routedConfig);
          if (bumpResult.status === "skipped") {
            if (config.guard.fail_on_duplicate) {
              console.error(`error: duplicate — commit=${parsed.commit} already posted`);
              await sendTrace(debugChannelId, token, source, `duplicate: ${parsed.commit}`, dry, t0).catch(() => {});
              process.exit(1);
            }
            console.log(`  skipped — duplicate commit ${parsed.commit}`);
            outcome = `skipped — duplicate ${parsed.commit}`;
          } else {
            console.log(`  bumped: ${bumpResult.path} (${bumpResult.commitSha})`);
            outcome = `bumped ${parsed.version} ${parsed.commit} → ${bumpResult.commitSha}`;
          }
        }
      } catch (e) {
        if (e instanceof WriterError) {
          console.error(`error: ${e.message}`);
          await sendTrace(debugChannelId, token, source, `writer failed (${e.code}): ${e.message}`, dry, t0).catch(() => {});
          process.exit(1);
        }
        if (e instanceof GitError) {
          if (e.code === "ff-refused") {
            // GitError message is the full #debug abort message
            await postDebug(debugChannelId, e.message, token).catch(() => {});
            console.error(`error: non-FF guard refused — see #debug`);
          } else {
            console.error(`error: ${e.message}`);
            await sendTrace(debugChannelId, token, source, `git error (${e.code}): ${e.message}`, dry, t0).catch(() => {});
          }
          process.exit(1);
        }
        throw e;
      }

      await sendTrace(debugChannelId, token, source, outcome, dry, t0);
    } catch (e) {
      const msg = e instanceof DiscordError ? e.message : `unexpected error: ${String(e)}`;
      console.error(`error: ${msg}`);
      await sendTrace(debugChannelId, token, source, `error: ${msg}`, dry, t0).catch(() => {});
      process.exit(1);
    }
  });

async function sendTrace(
  debugChannelId: string,
  token: string,
  source: string,
  outcome: string,
  dry: boolean,
  t0: number,
): Promise<void> {
  const elapsed = Date.now() - t0;
  const lines = [
    `⏱ bump trace · ${new Date().toISOString()}`,
    `  source:  ${source}`,
    `  outcome: ${outcome}`,
    `  elapsed: ${elapsed}ms`,
    ...(dry ? ["  mode:    dry-run"] : []),
  ];
  await postDebug(debugChannelId, lines.join("\n"), token);
}

program
  .command("project-add <name>")
  .description("Enroll a git repo as a project in the registry")
  .option("--path <path>", "local path to the repo (skips the prompt)")
  .action(async (name: string, opts: { path?: string }) => {
    try {
      await addProjectCmd(name, opts);
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command("project-list")
  .description("List all enrolled projects")
  .action(() => {
    try {
      listProjectsCmd();
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command("project-info <name>")
  .description("Show details for an enrolled project, including its resolved target")
  .action((name: string) => {
    try {
      infoProjectCmd(name);
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program
  .command("project-remove <name>")
  .description("Remove a project from the registry (does not touch files on disk)")
  .option("-y, --yes", "skip confirmation prompt")
  .action(async (name: string, opts: { yes?: boolean }) => {
    try {
      await removeProjectCmd(name, opts);
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

await program.parseAsync();
