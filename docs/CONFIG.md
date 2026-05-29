# Config reference — `.bumper.toml`

> **TL;DR** — `bumper` reads one config file, `.bumper.toml`, from your working directory (override
> with `--config <path>`). It has five sections: `[source]` (where reports come from), `[target]`
> (where posts go), `[git]` (how commits are made), `[post]` (post defaults), and `[guard]` (safety
> rails). Every field is validated on load — a bad value fails immediately, naming the field.

Run `bumper init` to drop a commented `.bumper.example.toml` in your current directory as a starting
point. This doc explains every field, its default, and the mistakes that actually cause problems.

> **Secrets never live here.** The only secret is your chat-source token, and the config holds only
> the *name* of the environment variable that contains it (`token_env`), never the token itself. Keep
> the token in a gitignored `.env` file. See [the security model in ARCHITECTURE.md](ARCHITECTURE.md#trust-boundaries--where-untrusted-data-crosses-into-your-system).

---

## A complete example

```toml
[source]
module         = "general"                            # default module/project for posts (see enum below)
report_channel = "discord://<guild-id>/<channel-id>"  # where reports are read (read-only to bumper)
debug_channel  = "discord://<guild-id>/<channel-id>"  # where bumper writes traces
buffer         = 1                                     # 0 = latest message; 1 = second-most-recent (review window)
token_env      = "DISCORD_BOT_TOKEN"                   # env var NAME holding the bot token (not the token)

[target]
repo         = "https://github.com/you/your-blog"      # the content repo bumper writes into
branch       = "blog/dev"                              # the branch bumper pushes to (use a review branch)
content_path = "content/blog/dev/{YYYY-MM-DD}/{slug}/index.mdx"  # where the post file lands
local_clone  = "~/.bumper/your-blog"                   # bumper's working clone (disposable)

[git]
author          = "blog.bumper <bumper@yourdomain.dev>"          # commit author identity
commit_template = "bump: {version} → {date} ({title})"           # commit message template
push            = "auto"                                         # auto | manual | dry-run

[post]
status       = "published"        # published | draft  → frontmatter status
commentary   = "empty"            # empty | draft-synthesis
tag_strategy = "from-version"     # seeds tags with [version]
timezone     = "America/Chicago"  # IANA tz: day-container rollover + time rendering

[guard]
fail_on_validation_error = true   # invalid frontmatter → refuse, write nothing
fail_on_duplicate        = false  # same commit already posted → skip (false) or error (true)
skip_if_no_report        = true   # buffer finds nothing → quiet no-op (true) or error (false)
require_blog_ff          = true   # refuse to push if the repo isn't fast-forwardable
```

---

## `[source]` — where reports come from

| Field | Type | Default | Purpose |
|---|---|---|---|
| `module` | enum | *(required)* | Default module/project for posts that don't name one. See enum note below. |
| `report_channel` | discord URI | *(required)* | The channel `bumper` reads reports from. Read-only — `bumper` never posts here. |
| `debug_channel` | discord URI | *(required)* | The channel `bumper` writes observability traces to. |
| `buffer` | int ≥ 0 | `1` | Which message to pick: `0` = latest, `1` = second-most-recent. |
| `token_env` | string | `DISCORD_BOT_TOKEN` | The **name** of the env var holding the bot token. |

**`module` — the enum.** In the reference implementation this is a fixed set
(`lumaweave | cerebra | bonsai | gwells | general`). **Adopters: change this to your own set.** It's
defined in two places that must match — `bumper`'s schema and your blog's content schema — so edit
both (see the schema-sync note in [ARCHITECTURE.md](ARCHITECTURE.md#the-schema-one-definition-two-enforcers)).
A report's `Project:` line, if present, overrides this default; otherwise every post from this repo
gets tagged with `module`.

**The `discord://` URI format.** Both channel fields use `discord://<guild-id>/<channel-id>`.

> **Common mistake — guild vs channel ID.** These are two *different* numbers. The guild ID is your
> server; the channel ID is the specific channel. Putting the channel ID in both positions (or
> swapping them) produces a 404 on fetch. To get each: enable Developer Mode in Discord (User
> Settings → Advanced), then right-click the **server** → Copy Server ID (guild), and right-click the
> **channel** → Copy Channel ID.

> **Common mistake — the buffer and an empty-ish channel.** `buffer = 1` needs the channel to have at
> least **two** messages, or there's no "second-most-recent" and `bumper` no-ops. This bites on your
> very first post. Fix: post two reports, set `buffer = 0`, or target the report with
> `--msg <id>`. (Details in [HOW_IT_WORKS.md](HOW_IT_WORKS.md#stage-1--fetch-a-report-and-the-buffer).)

> **Never put the token in `token_env`.** The field holds the variable *name*. The value lives in
> `.env`. If you accidentally paste the token here, it ends up in your repo — rotate it immediately.

---

## `[target]` — where posts go

| Field | Type | Default | Purpose |
|---|---|---|---|
| `repo` | URL | *(required)* | The content repo `bumper` writes into. |
| `branch` | string | `main` | The branch `bumper` commits and pushes to. |
| `content_path` | template | *(required)* | Where the post file lands. Supports `{YYYY-MM-DD}` and `{slug}`. |
| `local_clone` | path | `~/.bumper/<repo>` | `bumper`'s working clone. Disposable. `~` expands to home. |

**`branch` — use a review branch.** The default is `main`, but `bumper` **refuses to push directly to
`main` on the content repo** — it requires a review branch (e.g. `blog/dev`). Set this to your review
branch. Posts land there; you merge to live manually. (You *can* point it at your live branch later,
deliberately — see the branching note in [ARCHITECTURE.md](ARCHITECTURE.md#branching-model--why-the-review-branch-exists).)

> **Common mistake — the branch must exist on the remote first.** `bumper` clones with `--branch
> <branch>`; if that branch doesn't exist on the remote, the clone fails. Create the review branch
> and push it before the first run: `git checkout -b blog/dev main && git push -u origin blog/dev`.

**`content_path` — the placeholders.** `{YYYY-MM-DD}` is replaced with the post's date (from the
report, not the clock — see below), `{slug}` with the generated slug. The date determines the dated
folder; the folder is created on first write.

> **Common mistake — `content_path` not matching your blog's expected structure.** `bumper` writes
> wherever you point `content_path`, but your blog's content pipeline reads from a *specific*
> directory with a *specific* shape. If they don't match, `bumper` writes a file your blog never sees.
> Point `content_path` at exactly the directory + structure your content pipeline globs.

> **The clone is disposable.** If `local_clone` ever gets into a weird state, `rm -rf` it and re-run —
> `bumper` re-clones. This is also the fix for the "deleted post came back" problem (a stale clone
> carrying an old file forward). See [ARCHITECTURE.md](ARCHITECTURE.md#state-and-the-working-clone).

---

## `[git]` — how commits are made

| Field | Type | Default | Purpose |
|---|---|---|---|
| `author` | string | *(required)* | Commit author, `Name <email>` format. |
| `commit_template` | template | `bump: {version} → {date} ({title})` | Commit message. Supports `{version}`, `{date}`, `{title}`. |
| `push` | enum | `auto` | `auto` = commit + push; `manual` = commit, you push; `dry-run` = commit nothing, log only. |

**`push` modes, concretely:**
- `auto` — the normal mode. Commits and pushes to `branch`.
- `manual` — commits to the local clone but leaves the push to you. Useful if you want to inspect the
  commit before it goes up.
- `dry-run` — combined with the `--dry` flag's behavior, this is the "show me, change nothing" mode.

> **Note:** the `--dry` *flag* on `bump` is the safest preview — it runs fetch/parse/validate/render
> and prints the full MDX and git plan **without writing or committing anything**. The `push =
> "dry-run"` *config value* is a milder thing (it commits locally but doesn't push). For a true
> no-side-effects rehearsal, use the `--dry` flag. See
> [HOW_IT_WORKS.md](HOW_IT_WORKS.md#dry-run-see-everything-change-nothing).

---

## `[post]` — post defaults

| Field | Type | Default | Purpose |
|---|---|---|---|
| `status` | enum | `published` | Frontmatter `status`: `published` or `draft`. |
| `commentary` | enum | `empty` | `empty` (no commentary block) or `draft-synthesis`. |
| `tag_strategy` | enum | `from-version` | Seeds the post's `tags` with `[version]`. |
| `timezone` | IANA tz | `America/Chicago` | Used for day-container rollover and rendering the post time. |

**`status`.** Set `draft` if you want posts that exist but are excluded from your blog's index/feed
(your content pipeline decides what "draft" means at build). `published` is the normal mode.

**`timezone` — why it matters.** Posts are filed into a dated day-container. The date boundary
("when does today become tomorrow?") is computed in this timezone. Set it to *your* timezone so a
late-night post files under the day you'd expect, not UTC's day.

> **Common mistake — an invalid IANA timezone string.** It must be a valid IANA name like
> `America/Chicago` or `Europe/London`, not an abbreviation like `CST` or an offset like `-06:00`.
> An invalid value produces wrong date math, not always an obvious error.

---

## `[guard]` — safety rails

| Field | Type | Default | Purpose |
|---|---|---|---|
| `fail_on_validation_error` | bool | `true` | Invalid frontmatter → refuse and write nothing. |
| `fail_on_duplicate` | bool | `false` | Same commit already posted → skip (`false`) or hard-error (`true`). |
| `skip_if_no_report` | bool | `true` | Buffer finds nothing new → quiet no-op (`true`) or error (`false`). |
| `require_blog_ff` | bool | `true` | Refuse to push if the blog repo isn't fast-forwardable. |

**Leave these at their defaults unless you have a specific reason.** They're the rails that make
`bumper` safe to run semi-automatically.

- **`fail_on_validation_error = true`** — keep this on. It's what stops a malformed post from reaching
  your repo. Turning it off means `bumper` could write a post your build then rejects.
- **`fail_on_duplicate = false`** — keep this off (the default). It makes re-running a report safe (a
  duplicate is skipped, not an error). Set `true` only if you want a duplicate run to be a loud
  failure for some pipeline reason.
- **`skip_if_no_report = true`** — keep this on if you run `bumper` on a schedule, so "nothing new"
  isn't treated as an error every time.
- **`require_blog_ff = true`** — keep this on. **Turning it off disables the fast-forward guard**,
  which is the protection against clobbering a shared repo. `bumper` will print a loud warning if you
  disable it. The only time to consider it is a single-writer repo you fully control, and even then
  the safety is nearly free.

> **The biggest config mistake is disabling a guard to "make it work."** If a guard is firing, it's
> almost always telling you about a real problem (a stale clone, a diverged branch, a malformed
> report). Disabling the guard hides the problem instead of fixing it. Read the trace, fix the cause,
> leave the guards on.

---

## Loading and overrides

- `bumper bump` looks for `.bumper.toml` in the current directory.
- `bumper bump --config <path>` uses a config at an explicit path. Useful if you run `bumper` for
  multiple blogs from one place — keep a config per blog and point at the right one.
- The config is validated on every load. A type error, a bad enum value, or a malformed `discord://`
  URI fails immediately with a message naming the bad field — `bumper` never runs on a half-valid
  config.

---

**Next:** [CHANGELOG_CONTRACT.md](CHANGELOG_CONTRACT.md) — the exact report format your agent posts,
which is the other half of getting `bumper` running.
