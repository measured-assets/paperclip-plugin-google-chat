/**
 * Agent-callable tools. Registered in the worker so agents can proactively push to
 * Google Chat (e.g. a daily-briefing routine calling `send_briefing`, or an agent
 * escalating to a human). Each handler returns a `ToolResult` ({ content | error }).
 */

import { TOOL_NAMES } from "./constants.js";
import { formatBriefing, type GoogleChatMessage, type RouteKey } from "./google-chat.js";

/** Posts a message to a routed space; returns delivery status. */
export type PostFn = (
  routeKey: RouteKey,
  message: GoogleChatMessage,
) => Promise<{ ok: boolean; status: number; body: string }>;

interface ToolResultLike {
  content?: string;
  data?: unknown;
  error?: string;
}

interface ToolsHost {
  tools: {
    register(
      name: string,
      declaration: { displayName: string; description: string; parametersSchema: unknown },
      fn: (params: unknown, runCtx: unknown) => Promise<ToolResultLike>,
    ): void;
  };
}

export function registerTools(ctx: ToolsHost, post: PostFn): void {
  ctx.tools.register(
    TOOL_NAMES.postMessage,
    {
      displayName: "Post to Google Chat",
      description: "Post a plain-text or Markdown message to a configured Google Chat space.",
      parametersSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          space: { type: "string", description: "default | approvals | errors | digest" },
        },
        required: ["text"],
      },
    },
    async (params): Promise<ToolResultLike> => {
      const p = (params ?? {}) as { text?: string; space?: string };
      if (!p.text) return { error: "text is required" };
      const route = normalizeRoute(p.space);
      const res = await post(route, { text: p.text });
      return res.ok
        ? { content: `Posted to the ${route} space.` }
        : { error: `Google Chat post failed (HTTP ${res.status}): ${res.body.slice(0, 200)}` };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.escalateToHuman,
    {
      displayName: "Escalate to human (Google Chat)",
      description: "Post an escalation to the approvals space and ask a human to respond.",
      parametersSchema: {
        type: "object",
        properties: { message: { type: "string" }, issueId: { type: "string" } },
        required: ["message"],
      },
    },
    async (params): Promise<ToolResultLike> => {
      const p = (params ?? {}) as { message?: string; issueId?: string };
      if (!p.message) return { error: "message is required" };
      const suffix = p.issueId ? `\n_issue: ${p.issueId}_` : "";
      const res = await post("approvals", { text: `🙋 *Escalation*\n${p.message}${suffix}` });
      return res.ok ? { content: "Escalation posted to the approvals space." } : { error: `Post failed (HTTP ${res.status}).` };
    },
  );

  ctx.tools.register(
    TOOL_NAMES.sendBriefing,
    {
      displayName: "Send briefing (Google Chat)",
      description: "Post a formatted briefing/report to the digest space.",
      parametersSchema: {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["body"],
      },
    },
    async (params): Promise<ToolResultLike> => {
      const p = (params ?? {}) as { title?: string; body?: string };
      if (!p.body) return { error: "body is required" };
      const res = await post("digest", { text: formatBriefing(p.title, p.body) });
      return res.ok ? { content: "Briefing posted to the digest space." } : { error: `Post failed (HTTP ${res.status}).` };
    },
  );
}

function normalizeRoute(space: string | undefined): RouteKey {
  switch (space) {
    case "approvals":
    case "errors":
    case "digest":
      return space;
    default:
      return "default";
  }
}
