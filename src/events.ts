/**
 * Domain-event → Google Chat notification mapping.
 *
 * The host emits domain events (issue lifecycle, approvals, agent runs). We
 * subscribe in the worker and turn each into a `{ routeKey, text }` notification,
 * gated by the per-event config toggles. The mapping is pure so it can be tested
 * without the SDK; the worker performs the actual `postToWebhook`.
 */

import type { GoogleChatConfig } from "./config.js";
import { DOMAIN_EVENTS, TERMINAL_ISSUE_STATUSES } from "./constants.js";
import {
  formatAgentRunFailed,
  formatApprovalRequested,
  formatIssueCompleted,
  formatIssueCreated,
  type IssueLike,
  type RouteKey,
} from "./google-chat.js";

/** Loose shape of a host PluginEvent payload. */
export interface DomainEvent {
  type: string;
  data?: Record<string, unknown>;
}

export interface Notification {
  routeKey: RouteKey;
  text: string;
}

function asIssue(data: Record<string, unknown> | undefined): IssueLike {
  const d = data ?? {};
  return {
    id: typeof d.id === "string" ? d.id : undefined,
    title: typeof d.title === "string" ? d.title : undefined,
    status: typeof d.status === "string" ? d.status : undefined,
    url: typeof d.url === "string" ? d.url : undefined,
  };
}

/**
 * Map a domain event to a notification, or null if the event is unmapped or its
 * config toggle is off.
 */
export function mapEventToNotification(
  event: DomainEvent,
  config: GoogleChatConfig,
): Notification | null {
  switch (event.type) {
    case DOMAIN_EVENTS.issueCreated:
      if (!config.notifyOnIssueCreated) return null;
      return { routeKey: "default", text: formatIssueCreated(asIssue(event.data)) };

    case DOMAIN_EVENTS.issueUpdated: {
      // The host has no `issue.completed`; completion surfaces as an update to a
      // terminal status. Only notify on that transition, not every edit.
      if (!config.notifyOnIssueCompleted) return null;
      const issue = asIssue(event.data);
      if (!issue.status || !TERMINAL_ISSUE_STATUSES.has(issue.status.toLowerCase())) return null;
      return { routeKey: "default", text: formatIssueCompleted(issue) };
    }

    case DOMAIN_EVENTS.approvalCreated:
      if (!config.notifyOnApprovalRequested) return null;
      return { routeKey: "approvals", text: formatApprovalRequested(asIssue(event.data)) };

    case DOMAIN_EVENTS.agentRunFailed: {
      if (!config.notifyOnAgentRunFailed) return null;
      const d = event.data ?? {};
      const agentName = typeof d.agentName === "string" ? d.agentName : "agent";
      const errorMsg = typeof d.error === "string" ? d.error : "unknown error";
      return { routeKey: "errors", text: formatAgentRunFailed(agentName, errorMsg) };
    }

    default:
      return null;
  }
}
