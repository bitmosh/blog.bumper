# Discord setup

`blog.bumper` reads your agent's reports from one Discord channel and writes its run
traces to another. To do that it needs a **bot** with a token and the IDs of those two
channels. This is the fiddliest part of setup — and the part most likely to trip you up —
but it's a one-time thing, and every step is on Discord's side, not `bumper`'s.

This guide is deliberately literal. If you've never made a Discord bot, follow it top to
bottom. If you have, the [TL;DR](#tldr) at the bottom is all you need.

> **What you'll end up with:** a bot token (one secret string) and two channel URIs in the
> form `discord://<guild-id>/<channel-id>` — one for reports, one for debug traces. That's
> everything `bumper`'s `[source]` config needs.

---

## 1. Create the application and bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and
   sign in with your Discord account.
2. Click **New Application**, give it a name (e.g. `blog.bumper`), agree to the terms, and
   **Create**.
3. In the left sidebar, open **Bot**.
4. Under **Token**, click **Reset Token** (this reveals it for the first time), confirm,
   and **copy the token**. You'll paste it into your `.env` in a moment.

> **Gotcha — the token is shown once.** Discord only displays the full token at the moment
> you reset it. If you navigate away without copying it, you can't see it again — you'll
> have to reset it (which invalidates the old one). Copy it now, paste it into your `.env`,
> then move on.

> **Never commit the token.** It goes in `.env`, which is gitignored. Anyone with the token
> can act as your bot. If it ever leaks, reset it immediately in this same screen — the old
> one stops working the instant you do.

---

## 2. Set the bot's permissions

`bumper` does two things in Discord: **reads** your report channel and **posts** to your
debug channel. It needs exactly two permissions, no more.

While still on the **Bot** page:

- Scroll to **Privileged Gateway Intents**. `bumper` reads message *content*, so enable
  **Message Content Intent**. (Without this, the bot can see that messages exist but not
  what they say — and parsing fails.)

The two channel-level permissions it needs — **Read Message History** on the report
channel and **Send Messages** on the debug channel — are granted when you invite the bot
(next step) and/or via the channel's permission settings. We'll scope them narrowly there.

> **Principle — least privilege.** `bumper` does not need administrator, does not need to
> manage the server, and does not need to read every channel. It needs to *read one channel*
> and *write to one channel*. Granting more is unnecessary risk. The invite link below
> requests only what's needed.

---

## 3. Invite the bot to your server

1. In the left sidebar, open **OAuth2** → **URL Generator**.
2. Under **Scopes**, check **`bot`**.
3. A **Bot Permissions** panel appears. Check:
   - **Read Message History**
   - **Send Messages**
   - **View Channels**
4. Copy the generated URL at the bottom, open it in your browser, choose your server, and
   **Authorize**.

The bot now appears in your server's member list (offline — that's normal; `bumper` is a
script that connects only when it runs, not a persistent always-on bot).

> **Gotcha — you must own or admin the server** to add a bot to it. If you're adding it to
> a server you don't manage, you'll need someone who does to authorize the invite.

---

## 4. Pick (or create) your two channels

`bumper` uses two channels. They can be existing channels or new ones:

- **Report channel** (your `#changelog`) — where your agent posts its structured
  end-of-task reports. `bumper` reads from here.
- **Debug channel** (your `#debug`) — where `bumper` writes a one-line trace on every run
  (what it did, how long it took, any error). This is your observability surface; a glance
  here tells you whether the last bump worked.

> **Why two channels.** Keeping traces out of your report channel means the report channel
> stays clean (just your agent's reports) and the debug channel stays useful (just bump
> outcomes). If something goes wrong, the debug channel tells you what and how to fix it —
> see the troubleshooting notes in `HOW_IT_WORKS.md`.

Make sure the bot can access both: the report channel needs **Read Message History** and
**View Channel** for the bot; the debug channel needs **Send Messages** and **View Channel**.
If you set channel-specific permission overrides, confirm the bot (or its role) is allowed
in each.

---

## 5. Get the guild and channel IDs

`bumper` identifies channels by numeric IDs, not names — names can change and aren't unique,
IDs are permanent. You need three IDs: your **server (guild) ID** and the **two channel IDs**.

First, turn on Developer Mode so you can copy IDs:

1. Discord → **User Settings** (gear icon) → **Advanced**.
2. Toggle **Developer Mode** on.

Now copy the IDs:

- **Guild (server) ID:** right-click your server's icon in the left rail → **Copy Server ID**.
- **Report channel ID:** right-click the report channel → **Copy Channel ID**.
- **Debug channel ID:** right-click the debug channel → **Copy Channel ID**.

> **Gotcha — IDs are long numbers, not names.** A channel ID looks like
> `1234567890123456789`, not `#changelog`. If you find yourself about to type a `#name`
> anywhere in your config, stop — you want the numeric ID. (`bumper` also rejects bare
> `#channel-name` mentions inside reports, for the same reason — see `CHANGELOG_CONTRACT.md`.)

---

## 6. Assemble the config values

You now have everything. The two channel values in your `.bumper.toml` use a URI format
that combines the guild ID and the channel ID:

```
discord://<guild-id>/<channel-id>
```

So if your guild ID is `111111111111111111`, your report channel is `222222222222222222`,
and your debug channel is `333333333333333333`, your `[source]` block looks like:

```toml
[source]
report_channel = "discord://111111111111111111/222222222222222222"
debug_channel  = "discord://111111111111111111/333333333333333333"
token_env      = "DISCORD_BOT_TOKEN"
```

And your `.env` (gitignored) holds the token:

```
DISCORD_BOT_TOKEN=the-token-you-copied-in-step-1
```

> **Gotcha — same guild, different channels.** Both URIs share the same guild ID (your
> server) but have different channel IDs. A common mistake is reusing the report channel ID
> for both — double-check the second number differs.

> **Format is validated.** `bumper` checks the URI matches `discord://<guild>/<channel>` at
> load time and gives a clear error if it doesn't. If you see a config error about the
> Discord URI, it's almost always a missing slash, a `#name` instead of an ID, or a stray
> space.

---

## 7. Verify it works

Once your `.bumper.toml` and `.env` are filled in, do a **dry run** — it connects to
Discord, fetches and parses a report, and shows you what it *would* write, without writing
or pushing anything:

```bash
bumper bump --dry
```

If the connection and permissions are right, you'll see the fetched message and the parsed
report. If something's off, the error points at the cause:

| Error mentions… | Likely cause | Fix |
| --- | --- | --- |
| token not set / unauthorized | `.env` missing or wrong token | Confirm `DISCORD_BOT_TOKEN` is in `.env` and matches the portal |
| missing access / forbidden | bot lacks permission on that channel | Re-check Read Message History (report) / Send Messages (debug) for the bot |
| can't read message content | Message Content Intent off | Enable it on the **Bot** page (step 2) |
| invalid discord URI | malformed channel value | Check the `discord://<guild>/<channel>` format (step 6) |
| channel too short for buffer | not enough messages yet | Post a report (or two — see the buffer note in `HOW_IT_WORKS.md`) |

---

## TL;DR

If you've done this before:

1. **Dev Portal** → New Application → **Bot** → Reset Token → copy it.
2. **Bot** page → enable **Message Content Intent**.
3. **OAuth2 → URL Generator** → scope `bot`, perms *View Channels / Read Message History /
   Send Messages* → authorize to your server.
4. Discord → **Settings → Advanced → Developer Mode** on.
5. Right-click → Copy IDs: server (guild), report channel, debug channel.
6. Config:
   ```toml
   [source]
   report_channel = "discord://<guild>/<report-channel>"
   debug_channel  = "discord://<guild>/<debug-channel>"
   ```
   `.env`: `DISCORD_BOT_TOKEN=...`
7. `bumper bump --dry` to verify.

---

*Next: with Discord wired, see the installation guide to configure the rest (`[target]`,
`[git]`, `[post]`, `[guard]`) and land your first post.*
