import { INSTANCE_CONFIG_SCHEMA } from "./config.js";
import { JOB_KEYS, PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES, WEBHOOK_KEYS } from "./constants.js";

/**
 * Paperclip plugin manifest (apiVersion 1). Declares the capability grants the
 * host enforces and the surfaces the worker registers. Keep capabilities minimal —
 * the host blocks any API call whose capability is not declared here.
 */
const manifest = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Google Chat",
  description:
    "Bidirectional Google Chat bridge: posts issue/agent/approval notifications to spaces and drives Paperclip from Chat slash commands.",
  author: "Measured Assets",
  categories: ["connector", "automation"],
  capabilities: [
    // read domain state for notifications + command responses
    "companies.read",
    "projects.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.read",
    "issue.comments.create",
    "agents.read",
    "agents.invoke",
    "agent.sessions.create",
    "agent.sessions.send",
    "goals.read",
    // outbound: event subscription + scheduled digest + HTTP to Google + secret refs
    "events.subscribe",
    "jobs.schedule",
    "http.outbound",
    "secrets.read-ref",
    // inbound: receive Google Chat app events
    "webhooks.receive",
    // agents can proactively push to Chat
    "agent.tools.register",
    // misc
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
    "instance.settings.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: INSTANCE_CONFIG_SCHEMA,
  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.chatEvents,
      displayName: "Google Chat events",
      description:
        "Configure your Google Chat app's HTTP endpoint to POST events here (MESSAGE, ADDED_TO_SPACE, CARD_CLICKED).",
    },
  ],
  jobs: [
    {
      key: JOB_KEYS.dailyDigest,
      displayName: "Daily digest",
      description: "Posts a once-daily summary to the digest space when digestMode is enabled.",
      // Hourly tick; the handler self-gates to the configured HH:MM.
      schedule: "0 * * * *",
    },
  ],
  tools: [
    {
      name: TOOL_NAMES.postMessage,
      displayName: "Post to Google Chat",
      description: "Post a plain-text or Markdown message to a configured Google Chat space.",
      parametersSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message body (Google Chat Markdown supported)." },
          space: {
            type: "string",
            description: "Optional routing key: default | approvals | errors | digest. Defaults to 'default'.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: TOOL_NAMES.escalateToHuman,
      displayName: "Escalate to human (Google Chat)",
      description: "Post an escalation message to the approvals space and ask a human to respond.",
      parametersSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          issueId: { type: "string", description: "Optional Paperclip issue id for context." },
        },
        required: ["message"],
      },
    },
    {
      name: TOOL_NAMES.sendBriefing,
      displayName: "Send briefing (Google Chat)",
      description: "Post a formatted briefing/report to the digest space (used by scheduled briefing routines).",
      parametersSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["body"],
      },
    },
  ],
} as const;

export default manifest;
