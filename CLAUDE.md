# CLAUDE.md — working on blog.bumper with a coding agent

This file orients a coding agent (Claude Code or similar) working **on the `blog.bumper`
codebase** — contributing, modifying, or extending it. It is not the report format your agent posts
to publish blog posts; that's [`docs/CHANGELOG_CONTRACT.md`](docs/CHANGELOG_CONTRACT.md).

If you're a human, this doubles as a contributor's orientation. Adapt anything here to your own
workflow — the safety conventions are recommendations, not requirements baked into the code.

---

## What this project is

`blog.bumper` is a small, stateless CLI that reads structured reports from a chat channel and turns
them into blog posts in a Git-backed content repo. Read [`docs/INTRODUCTION.md`](docs/INTRODUCTION.md)
for the concept and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit. The
pipeline itself is in [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md).

---

## Stack & conventions

- **Node 22+** (pinned in `.nvmrc`). Use `nvm use` to match it.
- **npm**, not pnpm or yarn. `blog.bumper` is a standalone CLI; keep it on npm. (The *blog repo*
  `bumper` writes to may use a different package manager — that's a separate project. Don't cross
  the streams: running `pnpm install` inside this repo will clobber its npm `node_modules` and drop
  a stray `pnpm-lock.yaml`.)
- **TypeScript, strict mode.** Build with `npm run build` (`tsc`), test with `npm test` (vitest).
- **ESM throughout** (`"type": "module"`). Imports use `.js` extensions even for `.ts` sources —
  that's the NodeNext convention, not a mistake.

---

## Dependencies, lockfiles, and vulnerabilities

This is worth getting right, especially given the current npm supply-chain threat climate.

**Install with scripts disabled.** A compromised package's payload typically runs via a lifecycle
(postinstall) script the moment you install. Disable them:

```bash
npm install --ignore-scripts
```

You then run the build explicitly (`npm run build`), which is the normal flow anyway. If a
*legitimate* package needs its install script to set up a native binary (esbuild, for example) and
you hit a "binary not found" error, re-run that one package's setup deliberately —
`npm rebuild <package>` — rather than dropping `--ignore-scripts` globally.

**Always commit `package-lock.json`.** With caret ranges (`^x.y.z`) in `package.json`, the lockfile
is what actually pins the resolved version of every dependency in the tree. Committing it makes a
fresh `npm ci` reproducible and protects you from a transitive dependency silently resolving to a
different (possibly compromised) version. Treat the lockfile as a tracked, reviewed artifact.

**Vet a dependency before adding it.** When adding or bumping a dependency:
- Check the latest version is current and the package is actively maintained (not abandoned or in a
  "maintenance limbo" fork). A package's npm/Socket page shows last-publish date and health.
- Be wary of major-version "upgrade available" nudges — a major bump (e.g. zod 3 → 4) can break the
  schema contract this project relies on. Pins are often deliberate. Check before bumping.
- Don't trust a version number from training data or memory — verify the current one at the time you
  add it. Versions move; "latest" from six months ago is stale.
- Prefer fewer dependencies. This codebase deliberately uses Node 22's built-in `fetch` instead of a
  Discord client library, and hand-rolls small things rather than pulling packages. Keep that bias.

**After installing, the lockfile is the record.** Commit `package.json` and `package-lock.json`
together in the same change, so the declared range and the resolved tree stay in sync.

---

## Git protocol — confirm before each gate (recommended)

A safety convention worth keeping when an agent is driving git in this project: **stop and confirm
with the human before each of commit, merge, and push** — don't fire them off automatically as one
uninterrupted sequence.

```
do the work  →  [confirm]  →  commit  →  [confirm]  →  merge  →  [confirm]  →  push
```

The reasoning: these three are the irreversible-ish steps (push especially, once it's on a remote
others pull from). A confirmation gate before each gives the human a chance to catch a wrong branch,
an unintended file, or a bad merge target *before* it propagates. It costs a few seconds and
prevents the class of mistake that's annoying to unwind.

This isn't enforced by any code — it's a working protocol. Some people relax it once they trust a
flow (committing freely, gating only on push, say). But for an agent operating with repo access,
keeping all three gates is the safe default. If you're an agent reading this: **ask before you
commit, ask before you merge, ask before you push**, unless the human has explicitly told you to
proceed without gating for this session.

A related habit that pairs well: **one logical change per branch, audit before merge.** Do a unit
of work on its own branch, show the human what changed, merge on approval. It keeps history legible
and makes any single change easy to revert.

---

## Working clone & state

`bumper` is stateless but keeps a working clone of the *target* blog repo at `local_clone` (default
`~/.bumper/<repo>`). If that clone gets into a weird state during development or testing, it's
disposable — `rm -rf` it and the next run re-clones. A stale clone is the usual cause of "a post I
deleted came back" — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#state-and-the-working-clone).

---

## Secrets

The only secret is the chat-source bot token. It lives in a gitignored `.env`, loaded via Node's
`--env-file-if-exists` (no dotenv dependency). The config holds only the *name* of the env var, never
the token. Never log, echo, commit, or write the token to disk anywhere but `.env`. See
[`ENV_AND_SECRETS.md`](ENV_AND_SECRETS.md). Before any commit, confirm no real `.env`, token, or real
channel IDs are staged — a public repo's history is permanent.

---

## Where to look

| You want to… | Read / edit |
|---|---|
| Understand the concept | `docs/INTRODUCTION.md` |
| Understand the pipeline | `docs/HOW_IT_WORKS.md` |
| Understand the system & roles | `docs/ARCHITECTURE.md` |
| Change config behavior | `docs/CONFIG.md` + `src/config.ts` |
| Change the report format | `docs/CHANGELOG_CONTRACT.md` + `src/parser/` |
| Change how posts are written | `src/mdx/` (mind the two injection boundaries) |
| Change git/push behavior | `src/git/driver.ts` (mind the fast-forward guard) |
| Add a new chat source | `src/discord.ts` is the reference adapter; mirror its shape |
