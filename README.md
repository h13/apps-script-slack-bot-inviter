# Slack Bot Inviter

[![CI](https://github.com/h13/apps-script-slack-bot-inviter/actions/workflows/ci.yml/badge.svg)](https://github.com/h13/apps-script-slack-bot-inviter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/h13/apps-script-slack-bot-inviter/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4.svg)](https://developers.google.com/apps-script)

[日本語](README.ja.md)

**Bulk-invite a bot to every Slack channel you belong to — with one slash command.** Anyone in the workspace can use it; each person authorizes once and the app acts with *their* membership, so private channels work without anyone handling tokens by hand.

Built from the [apps-script-fleet](https://github.com/h13/apps-script-fleet) template. Companion to [apps-script-slack-channel-archiver](https://github.com/h13/apps-script-slack-channel-archiver): an archiver bot can self-join public channels but must be *invited* to private ones — this app automates those invites.

## How It Works

```
/bot-inviter archiver
  → doPost (GAS web app)
      → first time: ephemeral "Authorize" link (Slack OAuth v2, user scopes)
          → doGet exchanges the code, stores the user token (Script Properties)
      → afterwards: enqueue job + one-off trigger, reply "working on it"
  → processInviteJobs (trigger)
      → users.conversations: channels YOU belong to (private by default)
      → conversations.invite: add the bot to each channel
      → summary posted back via response_url (ephemeral)
```

Design principle: **inviting is a user action, archiving is an app action.** This app uses per-user tokens (`xoxp`, acquired via OAuth — never typed or pasted); bots like the archiver keep their user-independent `xoxb` token. One token model per responsibility.

## Quick Start (Deployer)

### 1. Deploy the Apps Script Web App

Set up dev/prod script projects with [apps-script-fleet](https://github.com/h13/apps-script-fleet) (`./scripts/init.sh`) or `clasp create`, then:

```bash
pnpm install
pnpm run deploy        # dev
pnpm run deploy:prod   # prod
```

In the Apps Script editor: **Deploy → New deployment → Web app**, with:

- **Execute as**: Me
- **Who has access**: Anyone

Copy the Web app URL (`https://script.google.com/macros/s/…/exec`). Manage later code updates from **Deploy → Manage deployments** against the *same* deployment, so the URL stays stable.

### 2. Create the Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest** → paste [`slack-app-manifest.yml`](slack-app-manifest.yml) with both `REPLACE_WITH_DEPLOYMENT_ID` URLs replaced by your Web app URL → **Install to Workspace**.

### 3. Set Script Properties

In the Apps Script editor: Project Settings (gear icon) → Script Properties:

| key                        | value                                                                 | required |
| -------------------------- | --------------------------------------------------------------------- | -------- |
| `SLACK_CLIENT_ID`          | App credentials → Client ID                                           | yes      |
| `SLACK_CLIENT_SECRET`      | App credentials → Client Secret                                       | yes      |
| `SLACK_VERIFICATION_TOKEN` | App credentials → Verification Token                                  | yes      |
| `TARGET_BOTS`              | `alias=BOT_USER_ID[,alias=BOT_USER_ID…]`, e.g. `archiver=U0123ABCD`   | yes      |
| `INCLUDE_PUBLIC_CHANNELS`  | `true` to also invite into public channels (default: private only)    | no       |

To find a bot's user ID: open the bot's profile in Slack → three-dot menu → **Copy member ID** (`U…`/`W…`).

### 4. Use It

Anyone in the workspace:

```
/bot-inviter            # when exactly one bot is configured
/bot-inviter archiver   # pick a configured bot by alias
```

The first run returns an **Authorize** link (one time, per person). After authorizing, run the command again — a summary arrives within a minute: invited / already in / failed, per channel.

## Security Model

- **Per-user OAuth tokens** (`xoxp`) are acquired through Slack's OAuth v2 flow and stored in Script Properties (`USER_TOKEN_<user ID>`). Nobody types or sees a token; each token can act only on channels its owner belongs to, and dies with that user's account — the correct scope for an invite.
- **Script Properties are readable by editors of the Apps Script project.** Keep the project's editor list down to admins. Users can revoke their grant anytime from Slack → **Settings & administration → Manage apps → Bot Inviter**; revoked tokens are detected and deleted on next use.
- **CSRF**: the OAuth `state` is a single-use nonce (10-minute TTL) bound to the Slack user who ran the command, and the authorizing user must match it.
- **SSRF**: `response_url` is only ever posted to when it is under `https://hooks.slack.com/`.
- **Request verification**: GAS web apps do not expose HTTP headers, so Slack's signing-secret scheme (`X-Slack-Signature`) cannot be verified on this runtime. The app verifies the legacy verification token instead — weaker: treat the verification token as a secret. If it leaks, a forger can trigger invites of the *configured* bots on behalf of already-authorized users and receive the resulting summary (channel names included) at a response_url of their choosing — rotate the token from the app settings if you suspect exposure.

## Limits

- Script Properties hold at most ~500 keys — roughly 490 authorized users per deployment.
- A run stops after 5 minutes (the GAS limit is 6) and says it was truncated; run the command again to continue.
- `conversations.invite` is rate-limited by Slack (Tier 3); very large memberships may take a couple of runs.

## Project Structure

```
src/
├── index.ts          # GAS entry points (doPost, doGet, processInviteJobs)
├── config.ts         # Types, Script Property keys, scopes, limits
├── target-bots.ts    # TARGET_BOTS parsing + alias resolution (pure)
├── oauth-url.ts      # OAuth v2 authorize URL builder (pure)
├── messages.ts       # Slack message builders (pure)
├── store.ts          # Script Properties / cache / trigger wrappers
├── slack-client.ts   # Slack Web API wrapper (stateless)
└── setProperties.ts  # clasp run helper for CI/CD property injection
test/
├── target-bots.test.ts
├── oauth-url.test.ts
└── messages.test.ts
```

## Development

| Command                | Description                             |
| ---------------------- | --------------------------------------- |
| `pnpm run check`       | lint + typecheck + test (all checks)    |
| `pnpm run build`       | Bundle TypeScript and output to `dist/` |
| `pnpm run test`        | Jest with coverage                      |
| `pnpm run deploy`      | check → build → deploy to dev           |
| `pnpm run deploy:prod` | check → build → deploy to production    |

## CI/CD

CI runs on every push and PR. CD deploys on merge to `dev` or `main` — configured via GitHub Actions secrets/variables per environment. See the [apps-script-fleet docs](https://github.com/h13/apps-script-fleet#cicd-pipeline).

## Notes

- Functions in `src/index.ts` must not have the `export` keyword — the GAS runtime does not support ES module syntax
- `src/index.ts`, `src/slack-client.ts`, `src/store.ts`, `src/setProperties.ts` are excluded from test coverage (GAS globals cannot run in Node.js)
- Coverage threshold: 80% for all metrics (configurable in `jest.config.json`)

## License

[MIT](LICENSE)
