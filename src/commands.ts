/**
 * Inbound Google Chat event handling.
 *
 * A Google Chat *app* delivers events as JSON POSTs. The shapes we care about:
 *
 *   { type: "MESSAGE", space: { name, type }, user: { email, displayName },
 *     message: { text, argumentText, slashCommand?, thread } }
 *   { type: "ADDED_TO_SPACE" | "REMOVED_FROM_SPACE", ... }
 *   { type: "CARD_CLICKED", ... }
 *
 * We translate a `MESSAGE` whose text begins with a slash into a Paperclip action.
 * Parsing and authorization are pure functions; the side-effecting handlers take an
 * injected `CommandDeps` so they can be unit-tested without the SDK.
 */

import type { GoogleChatConfig } from "./config.js";

export interface ChatEvent {
  type?: string;
  space?: { name?: string; type?: string };
  user?: { email?: string; displayName?: string };
  message?: { text?: string; argumentText?: string; thread?: { name?: string } };
}

export interface ParsedCommand {
  command: string; // e.g. "status" (no leading slash, lower-cased)
  args: string; // trimmed remainder
  spaceId: string; // "spaces/AAAA" → "AAAA"
  userEmail: string;
  threadKey?: string;
  raw: string;
}

/** Extract a `/command args` from a Chat MESSAGE event. Returns null if not a command. */
export function parseChatEvent(event: ChatEvent): ParsedCommand | null {
  if (event.type !== "MESSAGE") return null;
  const text = (event.message?.text ?? "").trim();
  if (!text.startsWith("/")) return null;

  const withoutSlash = text.slice(1);
  const spaceIdx = withoutSlash.search(/\s/);
  const command = (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1).trim();

  const spaceName = event.space?.name ?? "";
  const spaceId = spaceName.startsWith("spaces/") ? spaceName.slice("spaces/".length) : spaceName;

  return {
    command,
    args,
    spaceId,
    userEmail: event.user?.email ?? "",
    threadKey: event.message?.thread?.name,
    raw: text,
  };
}

/** Space-level allowlist (who may issue ANY command). */
export function isSpaceAllowed(spaceId: string, config: GoogleChatConfig): boolean {
  const allow = config.allowedSpaceIds ?? [];
  return allow.length === 0 || allow.includes(spaceId);
}

/** User-level allowlist (who may issue MUTATING commands). */
export function isUserAllowed(email: string, config: GoogleChatConfig): boolean {
  const allow = config.allowedUserEmails ?? [];
  return allow.length === 0 || allow.includes(email);
}

/** Commands that change Paperclip state (require user allowlist). */
export const MUTATING_COMMANDS = new Set(["objective", "report", "approve"]);

/**
 * Side-effecting dependencies the router needs. Implemented in the worker against
 * the Paperclip SDK; mocked in tests.
 */
export interface CommandDeps {
  listIssues(): Promise<Array<{ title?: string; status?: string }>>;
  listAgents(): Promise<Array<{ name?: string; status?: string }>>;
  setObjective(text: string): Promise<string>; // returns a confirmation string
  buildReport(): Promise<string>;
}

const HELP_TEXT = [
  "*Paperclip — Google Chat commands*",
  "`/status` — fleet + issue snapshot",
  "`/issues` — open issues",
  "`/agents` — agent roster + state",
  "`/report` — generate a status report",
  "`/objective <text>` — set/queue an objective (restricted)",
  "`/help` — this message",
].join("\n");

/**
 * Route a parsed command to a reply string. Returns the text to post back to the
 * space. Authorization is enforced here; unknown commands return help.
 */
export async function handleCommand(
  parsed: ParsedCommand,
  config: GoogleChatConfig,
  deps: CommandDeps,
): Promise<string> {
  if (config.enableCommands === false) return ""; // silently ignore when disabled
  if (!isSpaceAllowed(parsed.spaceId, config)) {
    return "This space is not authorized to issue commands.";
  }
  if (MUTATING_COMMANDS.has(parsed.command) && !isUserAllowed(parsed.userEmail, config)) {
    return `You (${parsed.userEmail || "unknown"}) are not authorized to run /${parsed.command}.`;
  }

  switch (parsed.command) {
    case "help":
      return HELP_TEXT;

    case "status": {
      const [issues, agents] = await Promise.all([deps.listIssues(), deps.listAgents()]);
      const open = issues.filter((i) => i.status !== "done" && i.status !== "completed").length;
      const running = agents.filter((a) => a.status === "running" || a.status === "active").length;
      return `*Status* — ${open} open issues · ${running}/${agents.length} agents active`;
    }

    case "issues": {
      const issues = await deps.listIssues();
      if (issues.length === 0) return "No issues.";
      return issues
        .slice(0, 20)
        .map((i) => `• ${i.title ?? "(untitled)"}${i.status ? ` _(${i.status})_` : ""}`)
        .join("\n");
    }

    case "agents": {
      const agents = await deps.listAgents();
      if (agents.length === 0) return "No agents.";
      return agents.map((a) => `• ${a.name ?? "(unnamed)"} — ${a.status ?? "unknown"}`).join("\n");
    }

    case "report":
      return await deps.buildReport();

    case "objective": {
      if (!parsed.args) return "Usage: /objective <text>";
      return await deps.setObjective(parsed.args);
    }

    default:
      return HELP_TEXT;
  }
}
