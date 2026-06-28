/**
 * Google Chat plugin worker — wires the SDK seams together:
 *
 *  - setup()      registers domain-event subscriptions, the daily-digest job, and
 *                 the agent tools.
 *  - onWebhook()  receives Google Chat app events and routes slash commands.
 *  - outbound     resolves a per-route incoming-webhook URL from a secret ref and
 *                 POSTs the message via `ctx.http.fetch`.
 *
 * The pure logic (formatting, parsing, routing) lives in sibling modules and is
 * unit-tested; this file is the thin SDK-facing shell.
 */

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, validateConfig, type GoogleChatConfig } from "./config.js";
import { DOMAIN_EVENTS, JOB_KEYS, WEBHOOK_KEYS } from "./constants.js";
import { handleCommand, parseChatEvent, type ChatEvent, type CommandDeps } from "./commands.js";
import { mapEventToNotification, type DomainEvent } from "./events.js";
import { postToWebhook, type GoogleChatMessage, type RouteKey } from "./google-chat.js";
import { registerTools } from "./tools.js";

// The SDK's PluginContext is richly typed; we keep a loose local alias so this
// reference plugin stays readable. Swap to `PluginContext` from the SDK once you
// pin the exact version.
type Ctx = any;

let currentCtx: Ctx | null = null;

async function getConfig(ctx: Ctx): Promise<GoogleChatConfig> {
  const raw = (await ctx.config.get()) as GoogleChatConfig;
  return { ...DEFAULT_CONFIG, ...raw };
}

/** Raw webhook URL for a route, falling back to the default. */
function rawUrlForRoute(config: GoogleChatConfig, route: RouteKey): string | undefined {
  switch (route) {
    case "approvals":
      return config.approvalsWebhookUrl ?? config.defaultWebhookUrl;
    case "errors":
      return config.errorsWebhookUrl ?? config.defaultWebhookUrl;
    case "digest":
      return config.digestWebhookUrl ?? config.defaultWebhookUrl;
    default:
      return config.defaultWebhookUrl;
  }
}

/** Secret ref for a route, falling back to the default. */
function refForRoute(config: GoogleChatConfig, route: RouteKey): string | undefined {
  switch (route) {
    case "approvals":
      return config.approvalsWebhookUrlRef ?? config.defaultWebhookUrlRef;
    case "errors":
      return config.errorsWebhookUrlRef ?? config.defaultWebhookUrlRef;
    case "digest":
      return config.digestWebhookUrlRef ?? config.defaultWebhookUrlRef;
    default:
      return config.defaultWebhookUrlRef;
  }
}

/**
 * Resolve a route's webhook URL — preferring a raw URL (works on every host),
 * falling back to a secret ref (only where the host enables plugin secret-ref
 * resolution; some builds disable it). Returns null if neither yields a URL.
 */
async function resolveWebhookUrl(ctx: Ctx, config: GoogleChatConfig, route: RouteKey): Promise<string | null> {
  const raw = rawUrlForRoute(config, route);
  if (raw) return raw;
  const ref = refForRoute(config, route);
  if (!ref) return null;
  try {
    return await ctx.secrets.resolve(ref);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger?.warn?.(
      `Could not resolve secret ref for route "${route}" (${msg}). ` +
        `If your Paperclip build disables plugin secret references, set the raw "${route}WebhookUrl" field instead.`,
    );
    return null;
  }
}

/** Resolve a route's webhook URL and POST a message. */
async function post(
  ctx: Ctx,
  route: RouteKey,
  message: GoogleChatMessage,
): Promise<{ ok: boolean; status: number; body: string }> {
  const config = await getConfig(ctx);
  const url = await resolveWebhookUrl(ctx, config, route);
  if (!url) {
    ctx.logger?.warn?.(`No webhook URL available for route "${route}"`);
    return { ok: false, status: 0, body: `no webhook configured for route ${route}` };
  }
  return postToWebhook((u, init) => ctx.http.fetch(u, init), url, message);
}

/** Build the inbound command dependencies against the SDK domain APIs. */
function buildCommandDeps(ctx: Ctx, companyId: string | undefined): CommandDeps {
  const scope = companyId ? { companyId, limit: 50, offset: 0 } : { limit: 50, offset: 0 };
  return {
    async listIssues() {
      try {
        return (await ctx.issues.list(scope)) ?? [];
      } catch {
        return [];
      }
    },
    async listAgents() {
      try {
        return (await ctx.agents.list(scope)) ?? [];
      } catch {
        return [];
      }
    },
    // TODO: wire to a target agent/objective intake. Setting an objective and
    // building a report both require a chosen company + agent; the space→company
    // mapping (a `/connect` flow, see README) is the next milestone.
    async setObjective(text: string) {
      ctx.logger?.info?.(`/objective received: ${text}`);
      return `Queued objective: "${text}" (intake wiring pending — see README §Roadmap).`;
    },
    async buildReport() {
      const [issues, agents] = await Promise.all([this.listIssues(), this.listAgents()]);
      return `*Report*\nIssues: ${issues.length}\nAgents: ${agents.length}`;
    },
  };
}

const plugin = definePlugin({
  async setup(ctx: Ctx) {
    currentCtx = ctx;

    // --- Outbound: subscribe to domain events → post notifications ---
    for (const eventType of Object.values(DOMAIN_EVENTS)) {
      ctx.events.on(eventType, async (event: DomainEvent) => {
        const config = await getConfig(ctx);
        const notification = mapEventToNotification(event, config);
        if (!notification) return;
        const res = await post(ctx, notification.routeKey, { text: notification.text });
        if (!res.ok) {
          ctx.logger?.warn?.(`Notification post failed for ${eventType}: HTTP ${res.status}`);
        }
      });
    }

    // --- Daily digest job (hourly tick, self-gated to configured HH:MM) ---
    ctx.jobs.register(JOB_KEYS.dailyDigest, async () => {
      const config = await getConfig(ctx);
      if (!config.digestMode) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes() < 30 ? "00" : "30").padStart(2, "0")}`;
      // Fire when the hour matches the configured digest hour.
      const wantHour = (config.dailyDigestTime ?? "08:00").slice(0, 2);
      if (hhmm.slice(0, 2) !== wantHour) return;
      const deps = buildCommandDeps(ctx, undefined);
      const report = await deps.buildReport();
      await post(ctx, "digest", { text: `🗓️ *Daily digest*\n${report}` });
    });

    // --- Agent tools ---
    registerTools(ctx, (route, message) => post(ctx, route, message));

    ctx.logger?.info?.("google-chat plugin setup complete");
  },

  async onHealth() {
    const ctx = currentCtx;
    const config = ctx ? await getConfig(ctx) : DEFAULT_CONFIG;
    const configured = Boolean(config.defaultWebhookUrl || config.defaultWebhookUrlRef);
    return {
      status: configured ? "ok" : "degraded",
      message: configured ? "google-chat plugin ready" : "no default webhook URL or secret ref configured",
      details: { commandsEnabled: config.enableCommands !== false, digestMode: config.digestMode === true },
    };
  },

  async onValidateConfig(config: GoogleChatConfig) {
    return validateConfig({ ...DEFAULT_CONFIG, ...config });
  },

  async onWebhook(input: { endpointKey: string; parsedBody?: unknown }) {
    if (input.endpointKey !== WEBHOOK_KEYS.chatEvents) {
      throw new Error(`Unsupported webhook endpoint "${input.endpointKey}"`);
    }
    const ctx = currentCtx;
    if (!ctx) return;

    const event = (input.parsedBody ?? {}) as ChatEvent;
    const parsed = parseChatEvent(event);
    if (!parsed) return; // not a slash command (e.g. ADDED_TO_SPACE) — ignore for now

    const config = await getConfig(ctx);
    const deps = buildCommandDeps(ctx, undefined);
    const reply = await handleCommand(parsed, config, deps);
    if (!reply) return;

    // Incoming webhooks are per-space; reply via the default route. Threaded
    // per-space replies require the Chat REST API (serviceAccountKeyRef) — roadmap.
    await post(ctx, "default", { text: reply, threadKey: parsed.threadKey });
  },

  async onShutdown() {
    currentCtx = null;
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
