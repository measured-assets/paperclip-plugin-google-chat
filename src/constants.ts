/**
 * Stable identifiers for the Google Chat plugin. Keeping these in one place keeps
 * the manifest, worker, and tests in sync (the kitchen-sink reference plugin uses
 * the same convention).
 */

export const PLUGIN_ID = "google-chat";
export const PLUGIN_VERSION = "0.1.1";

/** Webhook endpoint keys declared in the manifest and matched in `onWebhook`. */
export const WEBHOOK_KEYS = {
  /** Google Chat app events (MESSAGE, ADDED_TO_SPACE, CARD_CLICKED, …) POST here. */
  chatEvents: "chat-events",
} as const;

/** Agent-callable tool names. */
export const TOOL_NAMES = {
  postMessage: "post_to_google_chat",
  escalateToHuman: "escalate_to_human",
  sendBriefing: "send_briefing",
} as const;

/** Scheduled job keys. */
export const JOB_KEYS = {
  dailyDigest: "daily-digest",
} as const;

/**
 * Domain events we translate into Google Chat notifications. The host emits these;
 * we subscribe via `ctx.events.on`. Names mirror the kitchen-sink event surface.
 */
export const DOMAIN_EVENTS = {
  issueCreated: "issue.created",
  issueUpdated: "issue.updated",
  issueCompleted: "issue.completed",
  approvalRequested: "approval.requested",
  agentRunFailed: "agent.run.failed",
} as const;
