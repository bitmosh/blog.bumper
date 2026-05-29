# Contributing to blog.bumper

`blog.bumper` is built to be modified. The whole philosophy is an open loop: take it, run it, change
it, and — if you'd like — let us see what you did. Contributions, adapters, and "here's how I'm using
it" notes are all genuinely welcome.

This doc covers how to get set up, the conventions to follow, and the kinds of contributions that are
especially useful.

---

## Getting set up

```bash
# Node 22+ (pinned in .nvmrc)
nvm use                       # or install Node 22 however you like

# Install dependencies — with scripts disabled (supply-chain hygiene; see below)
npm install --ignore-scripts

# Build and test
npm run build                 # tsc → dist/
npm test                      # vitest — should be all green
```

If `npm run build` or `npm test` fails on a missing native binary (e.g. esbuild) right after install,
that's the `--ignore-scripts` flag blocking a legitimate setup step. Re-run just that package's setup:
`npm rebuild <package>`. Don't drop `--ignore-scripts` globally.

---

## Conventions

- **npm, not pnpm or yarn.** `blog.bumper` is a standalone CLI; keep it on npm. (Running another
  package manager here will clobber the npm `node_modules` and drop a stray lockfile.)
- **TypeScript, strict mode. ESM throughout** (`"type": "module"`). Imports use `.js` extensions on
  `.ts` sources — that's the NodeNext convention, not a bug.
- **Commit `package-lock.json`** alongside any `package.json` change, so the resolved dependency tree
  stays reproducible.
- **Keep the dependency surface small.** This project deliberately uses Node's built-in `fetch`
  instead of a Discord client library and hand-rolls small utilities rather than pulling packages.
  A PR that adds a heavy dependency for something small will get pushback — propose it in an issue
  first.
- **Tests for behavior changes.** The suite is fixture-driven (`tests/fixtures/`). If you change the
  parser, writer, or git logic, add or update fixtures and assertions. The two injection boundaries
  (frontmatter and MDX body) and the fast-forward guard have dedicated tests — don't weaken them.

---

## Adding a dependency

Before adding or bumping one:

- Verify the latest version is current and the package is actively maintained — check its npm page
  for last-publish date and health. Don't trust a version from memory; versions move.
- Be cautious with major-version bumps. Some pins are deliberate (e.g. the validation library version
  is matched to the blog's schema tooling). Check before bumping a major.
- Prefer the standard library or a few lines of code over a new dependency.

---

## Git etiquette

A working convention, especially if you use a coding agent with repo access: **confirm before each of
commit, merge, and push** rather than firing them off automatically. These are the steps that are
annoying to unwind once they propagate. One logical change per branch, reviewed before merge, keeps
history legible and any change easy to revert. This isn't enforced by code — it's a habit worth
keeping. (More in [CLAUDE.md](CLAUDE.md).)

---

## High-value contributions

Some things that would genuinely help the project:

- **New chat-source adapters.** Discord is the current reference adapter (`src/discord.ts`), but the
  system is built around a *chat source* role, not Discord specifically. A Telegram adapter, a Slack
  adapter, or a generic webhook/file source are all natural fits. Mirror the shape of `src/discord.ts`
  — the contract is "fetch messages by recency or ID, and post a message." See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-roles-model-read-this-first--its-why-the-system-survives-change)
  for the roles model.
- **Host or content-repo notes.** The reference setup is GitHub + Vercel, but the content repo is
  "any Git host" and the host is "any deploy-on-push host." If you get it working with Netlify,
  Cloudflare Pages, GitLab, etc., a docs note or a config example helps the next person.
- **Post-template support.** Different post types (release notes, link posts, now-playing posts) could
  use different templates, with the report carrying a type the writer dispatches on. This is on the
  roadmap; design input or a first implementation is welcome.
- **Docs improvements.** If something in the docs tripped you up during setup, that's a real bug in
  the docs — a fix or a clarifying note is a great first contribution.

---

## Filing issues

- **Setup/config problems:** include your config (with the token and any real IDs redacted), what you
  ran, and the full output. The boundary-level issues (Discord permissions, channel IDs, host build
  settings) are the most common — check the troubleshooting tables in
  [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md#troubleshooting) and
  [docs/CONFIG.md](docs/CONFIG.md) first.
- **Bugs:** a minimal reproduction (a report that parses wrong, a config that behaves unexpectedly) is
  worth a lot. The parser and writer are fixture-driven, so a failing report makes a perfect bug
  report.
- **Never paste a real bot token or secret into an issue.** Redact it.

---

## The open loop

If you build something on top of `blog.bumper` — an adapter, a template, an interesting use — we'd
genuinely like to see it. Keeping the small `bitmosh.dev` attribution in your site footer lets that
tag link to a showcase of your use; it's how interesting builds get found and featured, and how the
project learns what people actually do with it. You're free to strip it — but if you leave it, you're
part of the visible community using this, not just a silent clone. Either way: build cool things with
it.

---

*By contributing, you agree your contributions are licensed under the project's MIT license.*
