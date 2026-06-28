import { describe, expect, it, vi } from "vitest";
import {
  appendQuery,
  formatAgentRunFailed,
  formatApprovalRequested,
  formatIssueCompleted,
  formatIssueCreated,
  link,
  postToWebhook,
  type HttpFetch,
} from "../src/google-chat.js";

describe("formatters", () => {
  it("formats a created issue with a link when url is present", () => {
    const out = formatIssueCreated({ title: "Ship it", url: "https://x/i/1", status: "open" });
    expect(out).toContain("Ship it");
    expect(out).toContain("https://x/i/1");
    expect(out).toContain("🆕");
  });

  it("formats a created issue without a link when url is absent", () => {
    const out = formatIssueCreated({ title: "No link" });
    expect(out).toContain("No link");
    expect(out).not.toContain("|");
  });

  it("formats completion and approval and failure", () => {
    expect(formatIssueCompleted({ title: "Done" })).toContain("✅");
    expect(formatApprovalRequested({ title: "Need" })).toContain("Approval needed");
    expect(formatAgentRunFailed("cos", "boom")).toContain("cos: boom");
  });

  it("renders Google Chat link syntax", () => {
    expect(link("text", "https://u")).toBe("<https://u|text>");
  });
});

describe("appendQuery", () => {
  it("uses ? for the first param and & afterwards", () => {
    expect(appendQuery("https://h/x", { a: "1" })).toBe("https://h/x?a=1");
    expect(appendQuery("https://h/x?k=v", { a: "1" })).toBe("https://h/x?k=v&a=1");
  });
});

describe("postToWebhook", () => {
  it("POSTs a JSON text body and returns status", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" })) as unknown as HttpFetch;
    const res = await postToWebhook(fetchImpl, "https://chat.googleapis.com/v1/spaces/A/messages", { text: "hi" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("chat.googleapis.com");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ text: "hi" });
  });

  it("appends threadKey params when threading", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" })) as unknown as HttpFetch;
    await postToWebhook(fetchImpl, "https://h/m", { text: "hi", threadKey: "spaces/A/threads/T" });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("threadKey=");
    expect(call[0]).toContain("messageReplyOption=");
  });

  it("throws on empty url", async () => {
    const fetchImpl = vi.fn() as unknown as HttpFetch;
    await expect(postToWebhook(fetchImpl, "", { text: "x" })).rejects.toThrow();
  });
});
