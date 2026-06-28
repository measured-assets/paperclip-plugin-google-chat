import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type GoogleChatConfig } from "../src/config.js";
import {
  handleCommand,
  isSpaceAllowed,
  isUserAllowed,
  parseChatEvent,
  type ChatEvent,
  type CommandDeps,
} from "../src/commands.js";

const msg = (text: string, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  type: "MESSAGE",
  space: { name: "spaces/AAAA", type: "ROOM" },
  user: { email: "ops@example.com" },
  message: { text },
  ...extra,
});

const deps: CommandDeps = {
  async listIssues() {
    return [
      { title: "open one", status: "open" },
      { title: "done one", status: "done" },
    ];
  },
  async listAgents() {
    return [
      { name: "cos", status: "running" },
      { name: "cto", status: "idle" },
    ];
  },
  async setObjective(text) {
    return `set:${text}`;
  },
  async buildReport() {
    return "REPORT";
  },
};

describe("parseChatEvent", () => {
  it("parses a slash command with args", () => {
    const p = parseChatEvent(msg("/objective grow MRR"));
    expect(p).not.toBeNull();
    expect(p!.command).toBe("objective");
    expect(p!.args).toBe("grow MRR");
    expect(p!.spaceId).toBe("AAAA");
    expect(p!.userEmail).toBe("ops@example.com");
  });

  it("parses a bare command", () => {
    expect(parseChatEvent(msg("/status"))!.command).toBe("status");
  });

  it("returns null for non-commands and non-MESSAGE events", () => {
    expect(parseChatEvent(msg("hello"))).toBeNull();
    expect(parseChatEvent({ type: "ADDED_TO_SPACE" })).toBeNull();
  });
});

describe("authorization", () => {
  it("space allowlist: empty allows all, populated restricts", () => {
    expect(isSpaceAllowed("AAAA", { allowedSpaceIds: [] })).toBe(true);
    expect(isSpaceAllowed("AAAA", { allowedSpaceIds: ["BBBB"] })).toBe(false);
    expect(isSpaceAllowed("AAAA", { allowedSpaceIds: ["AAAA"] })).toBe(true);
  });
  it("user allowlist behaves the same", () => {
    expect(isUserAllowed("a@x", {})).toBe(true);
    expect(isUserAllowed("a@x", { allowedUserEmails: ["b@x"] })).toBe(false);
  });
});

describe("handleCommand", () => {
  const cfg: GoogleChatConfig = { ...DEFAULT_CONFIG };

  it("/status summarizes open issues and active agents", async () => {
    const out = await handleCommand(parseChatEvent(msg("/status"))!, cfg, deps);
    expect(out).toContain("1 open issues");
    expect(out).toContain("1/2 agents active");
  });

  it("/issues lists titles", async () => {
    const out = await handleCommand(parseChatEvent(msg("/issues"))!, cfg, deps);
    expect(out).toContain("open one");
  });

  it("/report delegates to deps.buildReport", async () => {
    const out = await handleCommand(parseChatEvent(msg("/report"))!, cfg, deps);
    expect(out).toBe("REPORT");
  });

  it("/objective requires args and runs when authorized", async () => {
    expect(await handleCommand(parseChatEvent(msg("/objective"))!, cfg, deps)).toContain("Usage");
    expect(await handleCommand(parseChatEvent(msg("/objective go"))!, cfg, deps)).toBe("set:go");
  });

  it("blocks mutating command from a non-allowlisted user", async () => {
    const restricted: GoogleChatConfig = { ...cfg, allowedUserEmails: ["boss@example.com"] };
    const out = await handleCommand(parseChatEvent(msg("/objective go"))!, restricted, deps);
    expect(out).toContain("not authorized");
  });

  it("returns help for unknown commands", async () => {
    const out = await handleCommand(parseChatEvent(msg("/wat"))!, cfg, deps);
    expect(out).toContain("Paperclip — Google Chat commands");
  });

  it("returns empty string when commands are disabled", async () => {
    const out = await handleCommand(parseChatEvent(msg("/status"))!, { ...cfg, enableCommands: false }, deps);
    expect(out).toBe("");
  });
});
