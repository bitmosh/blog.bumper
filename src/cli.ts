import { Command } from "commander";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
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
  .description("Write .bumper.example.toml in the current directory")
  .option("--force", "overwrite if the file already exists")
  .action((opts: { force?: boolean }) => {
    const dest = resolve(process.cwd(), ".bumper.example.toml");
    if (existsSync(dest) && !opts.force) {
      console.error("error: .bumper.example.toml already exists (pass --force to overwrite)");
      process.exit(1);
    }
    writeFileSync(dest, EXAMPLE_TOML, "utf-8");
    console.log("wrote .bumper.example.toml");
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

      if (dry) {
        console.log(`[dry] fetched ${message.id} via ${source}`);
        console.log("[dry] parsed report:");
        console.log(JSON.stringify(parsed, null, 2));
      } else {
        console.log(`fetched ${message.id} via ${source}`);
      }

      // ── MDX + git ──────────────────────────────────────────────────────
      let outcome: string;
      try {
        if (dry) {
          const mdx = renderMDX(parsed, config); // Zod gate
          console.log("[dry] MDX:");
          console.log(mdx);
          const plan = buildGitPlan(config, parsed);
          console.log("[dry] git plan:");
          console.log(`  clone/pull:  ${plan.cloneOrPull}`);
          console.log(`  target:      ${plan.targetPath}`);
          console.log(`  commit:      ${plan.commitMessage}`);
          console.log(`  push target: ${plan.pushTarget}`);
          outcome = `dry-run — ${parsed.version} ${parsed.commit}`;
        } else {
          const bumpResult = await bumpRepo(parsed, config);
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

await program.parseAsync();
