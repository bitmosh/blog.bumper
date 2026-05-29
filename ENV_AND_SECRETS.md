# ENV_AND_SECRETS.md — token loading (Bumper.2)

How `blog.bumper` loads its one secret (the Discord bot token) without adding a dependency,
and the rules around it.

## Loading

The token lives in `.env` (gitignored) and loads via **Node 22's built-in `--env-file`** — no
`dotenv` package. `.env.example` (committed) documents the shape.

- bumper reads the token at runtime as `process.env[config.source.token_env]`
  (default key: `DISCORD_BOT_TOKEN`). It never reads a token from a file directly.
- Wire `--env-file-if-exists=.env` into the launch path so token-less commands don't break when
  `.env` is absent (`bumper init`, `bumper version` need no token). `--env-file-if-exists`
  (not `--env-file`) means a missing `.env` is a no-op, not an error.

`bin/bumper` shim:
```sh
#!/usr/bin/env sh
exec node --env-file-if-exists=.env "$(dirname "$0")/../dist/cli.js" "$@"
```

`package.json` dev script:
```json
"dev": "node --env-file-if-exists=.env --import tsx src/cli.ts"
```

For now `.env` is expected in the repo root (cwd) during development and testing. The
token-location story for invoking bumper from a *source* repo (LumaWeave, etc.) is a Bumper.7/8
concern — don't solve it here.

## Rules (non-negotiable)

- **Never log the token.** Not in console output, not in `#debug` traces, not in error messages.
- **Never write it to disk** beyond the gitignored `.env`.
- **Never include it in a Discord message** (the `#debug` trace especially).
- Unit tests must **not** require a live token — mock `fetch`. The live token is only for the
  manual `bump --msg <id>` DoD check.
- If the token is missing when a command needs it, fail with a clear message
  (`DISCORD_BOT_TOKEN not set — see .env.example`), not a raw fetch 401.
