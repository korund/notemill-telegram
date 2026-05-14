# notemill-telegram

Telegram producer for notemill-worker. Receives voice an udio messages via a Telegram webhook, hands the bytes to the worker throug  shared queue + bucket, and reports the outcome back to the user as  essage reaction (and a reply on errors).

The producer writes `TranscribeJob` records to the queue and consume NotifyResult` records back. The exact shape of those records, the queu able schema, and the bucket key layout live in the project's wire-contrac ocument (shared with the worker); that document is the source of truth.

## What it does

- Hosts an HTTPS webhook for one Telegram bot.
- Authorizes updates against a static allowlist of Telegram user ids
  (deny-by-default; unauthorized updates are silently dropped).
- For each authorized `voice` or `audio` message:
  1. Downloads the file from Telegram.
  2. Writes the bytes to the bucket under a content-addressed key.
  3. Enqueues a `TranscribeJob` for the worker.
  4. Sets a `queued` reaction on the original message.
- Drains the worker's notification queue and updates the reaction to `done` or `error`. On error, also replies with a short message containing the worker's error code.

Anything not in this list (slash-commands, inline mode, group chats beyon he allowlist, retries, DLQ handling, admin UI) is out of scope.

## Requirements

- Node.js >= 22.15 (uses the built-in `node:sqlite` module).
- A reachable HTTPS URL for the Telegram webhook (terminate TLS in front of the bot; the bot itself speaks plain HTTP).
- A Telegram bot token and a webhook secret you choose.
- A running `notemill-worker` sharing the same queue database and bucket storage.

## Configuration

A single YAML file. See [`config/config.example.yaml`](config/config.example.yaml or the full annotated shape. The main blocks:

- `telegram` / `webhook` - bot token, public webhook URL, listen address, webhook secret.
- `queue` - backend selector (`sqlite` ships today; `sqs` reserved) plus the per-backend block.
- `bucket` - backend selector (`fs` ships today; `s3` reserved) plus the per-backend block.
- `access.allowed_user_ids` - the allowlist. Empty means nobody.
- `reactions` - which emoji to use for queued/done/error, or disable the feature entirely.

Secrets (bot token, webhook secret) are never written into the YAML. Eac ecret is loaded from a file path or an environment variable, file takin recedence. This works cleanly with both docker secrets and plain `.env ompose setups.

## Running

The composition root is `src/bin/server.ts`. It loads the config, builds th ueue and bucket clients from their factories, and runs the ingress
(webhook) and notifier (result drain) loops in parallel until SIGINT/SIGTERM.

In production, run the published Docker image (see `Dockerfile`); it expose ort 8080 and starts the server with the config baked in by your deployment.

For local development:

```
npm install
npm run server -- --config config/config.local.yaml
```

A typed dry-run check:

```
npm run typecheck
```

## Development helpers

Two single-shot CLIs let you exercise the pipeline without Telegram in th oop. They share the same queue and bucket the server uses, so they ar seful for debugging the worker integration in isolation:

- `npm run produce -- <audio-file>` - drop a file into the bucket and enqueue one `TranscribeJob`.
- `npm run poll` - drain `queue_notifications` and print each `NotifyResult` as a single JSON line.

Both accept `--help`. When running these against a local worker, make sur oth sides see the same filesystem: SQLite in WAL mode does not coordinat cross DrvFs / 9P boundaries, so running the worker in WSL and the produce n Windows-side `/mnt/c/...` will silently fail to deliver rows. Stay on on ilesystem (in Docker both containers share a volume and this is  on-issue).
