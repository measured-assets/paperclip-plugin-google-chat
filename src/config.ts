/**
 * Instance configuration for the Google Chat plugin.
 *
 * Secret values (Google Chat incoming-webhook URLs, an optional service-account
 * key) are NEVER stored here in plaintext. The config holds **secret references**
 * — opaque UUIDs minted by Paperclip's secret store — which the worker resolves at
 * runtime via `ctx.secrets.resolve(ref)`. This mirrors the Telegram plugin's
 * `telegramBotTokenRef` pattern and keeps credentials out of config exports/logs.
 */

export interface GoogleChatConfig {
  // --- Outbound credentials (secret references, not raw values) ---
  /** Secret ref → a Google Chat *incoming webhook* URL for the default space. */
  defaultWebhookUrlRef?: string;
  /** Optional per-category routing. Each is a secret ref to a space webhook URL. */
  approvalsWebhookUrlRef?: string;
  errorsWebhookUrlRef?: string;
  digestWebhookUrlRef?: string;
  /**
   * Optional secret ref → a Google service-account JSON key. Only needed for the
   * Chat REST API (threaded replies, reading messages). Plain incoming webhooks do
   * not require it. Left unset = webhook-only mode.
   */
  serviceAccountKeyRef?: string;

  // --- Outbound event toggles ---
  notifyOnIssueCreated?: boolean;
  notifyOnIssueCompleted?: boolean;
  notifyOnApprovalRequested?: boolean;
  notifyOnAgentRunFailed?: boolean;
  /** Use Cards v2 formatting instead of plain text where supported. */
  useCards?: boolean;

  // --- Inbound (Google Chat app → Paperclip) ---
  /** Master switch for inbound slash commands. */
  enableCommands?: boolean;
  /**
   * Shared verification token. Google Chat includes a bearer/verification token on
   * each request; we compare it to reject forged webhook deliveries. Stored as a
   * secret ref. (For production, prefer verifying the Google-signed bearer JWT.)
   */
  verificationTokenRef?: string;
  /** Allowlist of Google Chat space IDs permitted to issue commands. Empty = all. */
  allowedSpaceIds?: string[];
  /** Allowlist of user emails permitted to issue mutating commands. Empty = all. */
  allowedUserEmails?: string[];

  // --- Digest job ---
  digestMode?: boolean;
  /** 24h "HH:MM" local time for the daily digest. */
  dailyDigestTime?: string;
}

export const DEFAULT_CONFIG: GoogleChatConfig = {
  notifyOnIssueCreated: false,
  notifyOnIssueCompleted: true,
  notifyOnApprovalRequested: true,
  notifyOnAgentRunFailed: true,
  useCards: false,
  enableCommands: true,
  allowedSpaceIds: [],
  allowedUserEmails: [],
  digestMode: false,
  dailyDigestTime: "08:00",
};

/** JSON-schema fragment surfaced in Paperclip's plugin settings UI. */
export const INSTANCE_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    defaultWebhookUrlRef: {
      type: "string",
      title: "Default space webhook (secret ref)",
      description:
        "Secret reference to a Google Chat incoming-webhook URL. Create the secret in Paperclip, paste the returned UUID here.",
    },
    approvalsWebhookUrlRef: { type: "string", title: "Approvals space webhook (secret ref)" },
    errorsWebhookUrlRef: { type: "string", title: "Errors space webhook (secret ref)" },
    digestWebhookUrlRef: { type: "string", title: "Digest space webhook (secret ref)" },
    serviceAccountKeyRef: {
      type: "string",
      title: "Service-account key (secret ref, optional)",
      description: "Only required for the Chat REST API (threaded replies). Webhook-only mode leaves this blank.",
    },
    notifyOnIssueCreated: { type: "boolean", title: "Notify on issue created", default: false },
    notifyOnIssueCompleted: { type: "boolean", title: "Notify on issue completed", default: true },
    notifyOnApprovalRequested: { type: "boolean", title: "Notify on approval requested", default: true },
    notifyOnAgentRunFailed: { type: "boolean", title: "Notify on agent run failed", default: true },
    useCards: { type: "boolean", title: "Use Cards v2 formatting", default: false },
    enableCommands: { type: "boolean", title: "Enable inbound slash commands", default: true },
    verificationTokenRef: { type: "string", title: "Verification token (secret ref)" },
    allowedSpaceIds: { type: "array", title: "Allowed space IDs", items: { type: "string" } },
    allowedUserEmails: { type: "array", title: "Allowed user emails", items: { type: "string" } },
    digestMode: { type: "boolean", title: "Enable daily digest", default: false },
    dailyDigestTime: { type: "string", title: "Daily digest time (HH:MM)", default: "08:00" },
  },
} as const;

/** Pure validator used by the worker's `onValidateConfig` hook and unit tests. */
export function validateConfig(config: GoogleChatConfig): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.dailyDigestTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.dailyDigestTime)) {
    errors.push("dailyDigestTime must be 24h HH:MM, e.g. 08:00");
  }
  if (config.digestMode && !config.digestWebhookUrlRef && !config.defaultWebhookUrlRef) {
    errors.push("digestMode is on but no digest/default webhook secret ref is set");
  }
  const anyNotify =
    config.notifyOnIssueCreated ||
    config.notifyOnIssueCompleted ||
    config.notifyOnApprovalRequested ||
    config.notifyOnAgentRunFailed;
  if (anyNotify && !config.defaultWebhookUrlRef) {
    warnings.push("Notifications are enabled but no defaultWebhookUrlRef is set — category routing only.");
  }
  if (config.serviceAccountKeyRef === "") {
    warnings.push("serviceAccountKeyRef is an empty string; leave it unset for webhook-only mode.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
