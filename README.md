# paperclip-plugin-google-chat

Bidirectional **Google Chat** integration for [Paperclip](https://github.com/paperclipai/paperclip).

- **Outbound** — posts issue / approval / agent-failure notifications to Google Chat spaces, driven by Paperclip domain events. Agents can also push messages on demand via registered tools (`post_to_google_chat`, `escalate_to_human`, `send_briefing`).
- **Inbound** — a Google Chat app delivers events to the plugin's webhook endpoint; slash commands (`/status`, `/issues`, `/agents`, `/report`, `/objective`) query or drive Paperclip from a space.

Built on the first-party [Paperclip plugin SDK](https://github.com/paperclipai/paperclip/tree/master/packages/plugins/sdk) (`apiVersion: 1`). No external relay service required — Paperclip terminates the webhook and makes the outbound calls itself.

> Status: **0.1.0 — scaffold.** Outbound notifications + tools and inbound command routing are implemented and unit-tested. The space→company `/connect` mapping and the Chat REST API reply path are on the roadmap (see below).

## Why a plugin (not a Cloudflare Worker + curl)

Everything this needs is a first-class SDK primitive, so the whole bridge lives inside Paperclip:

| Need | SDK capability |
|------|----------------|
| Receive Google Chat events | `webhooks.receive` |
| Post to a space | `http.outbound` (`ctx.http.fetch`) |
| Keep the webhook URL secret | `secrets.read-ref` (`ctx.secrets.resolve`) |
| Notify on issue/approval/agent events | `events.subscribe` |
| Let agents push messages | `agent.tools.register` |
| Daily digest | `jobs.schedule` |

The Google Chat webhook URL is **never stored in plaintext** — config holds a Paperclip secret *reference* (a UUID), resolved at runtime.

## Install

```bash
# from a checkout of this repo
npm install
npm run build
# then register the built plugin with your Paperclip instance
paperclipai plugin install /absolute/path/to/paperclip-plugin-google-chat
```

## Configure

1. **Create an incoming webhook** in your Google Chat space (Space → *Apps & integrations* → *Webhooks*). Copy the URL.
2. In Paperclip, store it as a **company secret** (Settings → Secrets, or `POST /api/companies/{companyId}/secrets`). You get back a UUID.
3. In the plugin's settings, paste that UUID into **`defaultWebhookUrlRef`** (and optionally `approvalsWebhookUrlRef` / `errorsWebhookUrlRef` / `digestWebhookUrlRef` for per-category routing).
4. Toggle which events notify (`notifyOnIssueCompleted`, `notifyOnApprovalRequested`, …) and, if you want inbound commands, set up a Google Chat **app** pointing its HTTP endpoint at this plugin's webhook URL, then set `allowedSpaceIds` / `allowedUserEmails`.

### Config keys

See [`src/config.ts`](src/config.ts) for the full schema. All credential fields are **secret references**, not raw values.

## Slash commands

| Command | Action | Restricted |
|---------|--------|:---:|
| `/status` | Open-issue + active-agent snapshot | |
| `/issues` | List open issues | |
| `/agents` | Agent roster + state | |
| `/report` | Generate a status report | |
| `/objective <text>` | Set/queue an objective | ✅ allowlist |
| `/help` | Command help | |

Mutating commands require the sender's email to be in `allowedUserEmails`.

## Architecture

```
src/
  manifest.ts    capabilities + webhook/tool/job declarations
  config.ts      config schema + validator (secret-ref based)
  google-chat.ts outbound client (incoming webhooks) + pure formatters
  events.ts      domain-event → notification mapping
  commands.ts    inbound event parsing + slash-command router
  tools.ts       agent-callable tool handlers
  worker.ts      definePlugin() wiring: setup / onWebhook / onHealth
```

Pure logic (formatting, parsing, routing, validation) is separated from the SDK-facing worker so it is unit-tested without a running Paperclip (`tests/`).

## Develop

```bash
npm install
npm test         # vitest — pure-logic unit tests
npm run typecheck
npm run build
```

## Roadmap

- **`/connect <company>`** — map a Google Chat space to a Paperclip company and persist it in plugin state (today inbound commands assume a single company scope).
- **Chat REST API path** — threaded, per-space replies and message reads via a service-account key (`serviceAccountKeyRef`); today replies post via the configured incoming webhook.
- **Cards v2** — richer notification/approval cards with interactive buttons (`useCards`).
- **Inbound verification** — validate Google's signed bearer token, not just a shared `verificationTokenRef`.

## License

MIT © Measured Assets
