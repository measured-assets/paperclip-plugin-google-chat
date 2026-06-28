import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import plugin from "../src/worker.js";
import manifest from "../src/manifest.js";

/**
 * Docker-free integration smoke test: loads the real worker into the SDK's
 * in-memory host harness, which enforces the manifest's declared capabilities
 * and simulates the host APIs. This catches what the manifest-schema check can't
 * — worker load, capability gaps, and handler registration — without a running
 * Paperclip. Outbound HTTP/secret paths are exercised only up to the point where
 * no webhook is configured (graceful no-op), so no network is needed.
 */
describe("worker integration (in-memory host harness)", () => {
  it("loads and registers under capability enforcement", async () => {
    const h = createTestHarness({ manifest, config: {} });
    await plugin.definition.setup(h.ctx); // throws if a handler registration violates a capability
    const health = await plugin.definition.onHealth();
    expect(["ok", "degraded"]).toContain(health.status);
  });

  it("registers post_to_google_chat and handles a missing webhook gracefully", async () => {
    const h = createTestHarness({ manifest, config: {} });
    await plugin.definition.setup(h.ctx);
    const res = await h.executeTool("post_to_google_chat", { text: "hi" });
    // No webhook configured → tool returns an error result, not a throw.
    expect(res.error).toBeTruthy();
  });

  it("routes an inbound /status command end-to-end without throwing", async () => {
    const h = createTestHarness({ manifest, config: {} });
    await plugin.definition.setup(h.ctx);
    await expect(
      plugin.definition.onWebhook({
        endpointKey: "chat-events",
        parsedBody: {
          type: "MESSAGE",
          space: { name: "spaces/AAAA" },
          user: { email: "ops@example.com" },
          message: { text: "/status" },
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("runs the daily-digest job (digest off) without throwing", async () => {
    const h = createTestHarness({ manifest, config: {} });
    await plugin.definition.setup(h.ctx);
    await expect(h.runJob("daily-digest")).resolves.toBeUndefined();
  });

  it("rejects an undeclared webhook endpoint", async () => {
    await expect(plugin.definition.onWebhook({ endpointKey: "not-a-real-endpoint" })).rejects.toThrow();
  });
});
