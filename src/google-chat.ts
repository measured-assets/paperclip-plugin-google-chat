/**
 * Google Chat outbound client + pure formatting helpers.
 *
 * Outbound delivery uses Google Chat **incoming webhooks**: an HTTPS POST of a
 * message resource to a per-space URL. The simplest body is `{ text }`; richer
 * messages use Cards v2 (`cardsV2`). We keep the HTTP call behind a small
 * `HttpFetch` seam so the formatters and routing can be unit-tested without the
 * Paperclip SDK runtime.
 *
 * Docs: https://developers.google.com/workspace/chat/quickstart/webhooks
 */

/** Minimal fetch shape compatible with `ctx.http.fetch` and the global `fetch`. */
export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type RouteKey = "default" | "approvals" | "errors" | "digest";

export interface GoogleChatMessage {
  text?: string;
  cardsV2?: unknown[];
  /** Thread key for grouping replies in a space. */
  threadKey?: string;
}

/**
 * POST a message to a Google Chat space via its incoming-webhook URL.
 * Returns the parsed result; throws on transport failure so callers can log.
 */
export async function postToWebhook(
  fetchImpl: HttpFetch,
  webhookUrl: string,
  message: GoogleChatMessage,
): Promise<{ ok: boolean; status: number; body: string }> {
  if (!webhookUrl) throw new Error("postToWebhook: empty webhook URL");

  const body: Record<string, unknown> = {};
  if (message.text) body.text = message.text;
  if (message.cardsV2) body.cardsV2 = message.cardsV2;

  const url = message.threadKey
    ? appendQuery(webhookUrl, { threadKey: message.threadKey, messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" })
    : webhookUrl;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

/** Append query params without clobbering existing ones. Exported for tests. */
export function appendQuery(url: string, params: Record<string, string>): string {
  const sep = url.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${url}${sep}${qs}`;
}

// --- Pure formatters (unit-tested) -----------------------------------------

/** Google Chat supports a limited Markdown: *bold*, _italic_, `code`. */
export function bold(s: string): string {
  return `*${s}*`;
}

export function link(text: string, url: string): string {
  // Google Chat renders <url|text> as a hyperlink.
  return `<${url}|${text}>`;
}

export interface IssueLike {
  id?: string;
  title?: string;
  status?: string;
  url?: string;
}

export function formatIssueCreated(issue: IssueLike): string {
  const title = issue.title ?? "(untitled)";
  const head = issue.url ? link(`🆕 ${title}`, issue.url) : `🆕 ${title}`;
  return `${head}\nNew issue created${issue.status ? ` · ${issue.status}` : ""}`;
}

export function formatIssueCompleted(issue: IssueLike): string {
  const title = issue.title ?? "(untitled)";
  const head = issue.url ? link(`✅ ${title}`, issue.url) : `✅ ${title}`;
  return `${head}\nIssue completed`;
}

export function formatApprovalRequested(issue: IssueLike): string {
  const title = issue.title ?? "(untitled)";
  const head = issue.url ? link(`⏳ ${title}`, issue.url) : `⏳ ${title}`;
  return `${bold("Approval needed")}\n${head}`;
}

export function formatAgentRunFailed(agentName: string, errorMsg: string): string {
  return `${bold("⚠️ Agent run failed")}\n${agentName}: ${errorMsg}`;
}

export function formatBriefing(title: string | undefined, body: string): string {
  return title ? `${bold(title)}\n${body}` : body;
}
