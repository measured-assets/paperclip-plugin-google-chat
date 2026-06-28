import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, validateConfig } from "../src/config.js";
import { mapEventToNotification } from "../src/events.js";

describe("validateConfig", () => {
  it("accepts the defaults", () => {
    expect(validateConfig(DEFAULT_CONFIG).ok).toBe(true);
  });

  it("rejects a malformed digest time", () => {
    const r = validateConfig({ ...DEFAULT_CONFIG, dailyDigestTime: "25:99" });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("HH:MM");
  });

  it("errors when digestMode is on with no webhook", () => {
    const r = validateConfig({ digestMode: true });
    expect(r.ok).toBe(false);
  });

  it("warns when notifications are on with no default webhook", () => {
    const r = validateConfig({ notifyOnIssueCompleted: true });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("mapEventToNotification", () => {
  it("routes approval.created to the approvals space", () => {
    const n = mapEventToNotification(
      { type: "approval.created", data: { title: "X" } },
      { ...DEFAULT_CONFIG, notifyOnApprovalRequested: true },
    );
    expect(n?.routeKey).toBe("approvals");
  });

  it("notifies completion only on issue.updated to a terminal status", () => {
    const cfg = { ...DEFAULT_CONFIG, notifyOnIssueCompleted: true };
    // Non-terminal update → no notification.
    expect(mapEventToNotification({ type: "issue.updated", data: { title: "X", status: "in_progress" } }, cfg)).toBeNull();
    // Terminal update → completion notification on the default route.
    const done = mapEventToNotification({ type: "issue.updated", data: { title: "X", status: "done" } }, cfg);
    expect(done?.routeKey).toBe("default");
    expect(done?.text).toContain("✅");
  });

  it("routes agent failures to the errors space", () => {
    const n = mapEventToNotification(
      { type: "agent.run.failed", data: { agentName: "cos", error: "boom" } },
      { ...DEFAULT_CONFIG, notifyOnAgentRunFailed: true },
    );
    expect(n?.routeKey).toBe("errors");
    expect(n?.text).toContain("boom");
  });

  it("returns null when the toggle is off", () => {
    const n = mapEventToNotification(
      { type: "issue.created", data: { title: "X" } },
      { ...DEFAULT_CONFIG, notifyOnIssueCreated: false },
    );
    expect(n).toBeNull();
  });

  it("returns null for unmapped events", () => {
    expect(mapEventToNotification({ type: "nope.event" }, DEFAULT_CONFIG)).toBeNull();
  });
});
