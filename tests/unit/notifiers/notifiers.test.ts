import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateConfig } from "../../../src/core/config.js";
import { createFinding, summarizeFindings } from "../../../src/core/findings.js";
import { createLogger } from "../../../src/core/logger.js";
import { runPipeline } from "../../../src/core/pipeline.js";
import type { RunResult } from "../../../src/core/result.js";
import { DiscordNotifier } from "../../../src/notifiers/discord/DiscordNotifier.js";
import { dispatchNotifications, notificationPayloadFromResult } from "../../../src/notifiers/dispatch.js";
import { EmailNotifier } from "../../../src/notifiers/email/EmailNotifier.js";
import { sendSmtpEmail } from "../../../src/notifiers/email/smtp.js";
import { envValue, postJson } from "../../../src/notifiers/http.js";
import { type NotificationPayload, renderNotificationText } from "../../../src/notifiers/Notifier.js";
import { SlackNotifier } from "../../../src/notifiers/slack/SlackNotifier.js";
import { TeamsNotifier } from "../../../src/notifiers/teams/TeamsNotifier.js";
import { TelegramNotifier } from "../../../src/notifiers/telegram/TelegramNotifier.js";
import { writeFixture } from "../rules/helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("notifier configuration", () => {
  it("validates enabled notifier config without accepting inline secrets", () => {
    expect(
      validateConfig({
        version: 1,
        notifiers: {
          slack: { enabled: true, webhookEnv: "SLACK_WEBHOOK_URL", minSeverity: "high" },
          teams: { enabled: false, webhookEnv: "TEAMS_WEBHOOK_URL" },
          telegram: { enabled: true, botTokenEnv: "TG_BOT_TOKEN", chatId: "-100123", minSeverity: "medium" },
          discord: { enabled: true, webhookEnv: "DISCORD_WEBHOOK_URL" },
          email: {
            enabled: true,
            smtpEnv: "SMTP_URL",
            recipients: ["lead@example.com"],
            minSeverity: "critical",
          },
        },
      }),
    ).toEqual([]);

    expect(
      validateConfig({
        version: 1,
        notifiers: {
          slack: { enabled: true, webhookUrl: "https://hooks.slack.test/secret" },
        },
      }),
    ).not.toEqual([]);
  });
});

describe("notifier implementations", () => {
  it("posts Slack, Teams, Discord, and Telegram payloads through env-backed endpoints", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetcher = async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response("ok", { status: 200 });
    };
    const env = {
      SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/T000/B000/secret",
      TEAMS_WEBHOOK_URL: "https://teams.test/webhook/secret",
      DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/123/secret",
      TG_BOT_TOKEN: "telegram-secret",
    };

    const payload = samplePayload();
    await new SlackNotifier({ enabled: true, webhookEnv: "SLACK_WEBHOOK_URL" }, { env, fetcher }).notify(payload);
    await new TeamsNotifier({ enabled: true, webhookEnv: "TEAMS_WEBHOOK_URL" }, { env, fetcher }).notify(payload);
    await new DiscordNotifier({ enabled: true, webhookEnv: "DISCORD_WEBHOOK_URL" }, { env, fetcher }).notify(payload);
    await new TelegramNotifier(
      { enabled: true, botTokenEnv: "TG_BOT_TOKEN", chatId: "-100123" },
      { env, fetcher },
    ).notify(payload);

    expect(requests.map((request) => request.url)).toEqual([
      env.SLACK_WEBHOOK_URL,
      env.TEAMS_WEBHOOK_URL,
      env.DISCORD_WEBHOOK_URL,
      "https://api.telegram.org/bottelegram-secret/sendMessage",
    ]);
    expect(requests[0]?.body).toMatchObject({ text: expect.stringContaining("BoardReadyOps found 1 finding") });
    expect(requests[1]?.body).toMatchObject({ title: payload.title, text: expect.stringContaining("bom.missing-mpn") });
    expect(requests[2]?.body).toMatchObject({ content: expect.stringContaining(payload.title) });
    expect(requests[3]?.body).toMatchObject({ chat_id: "-100123", text: expect.stringContaining(payload.summary) });
  });

  it("sends email payloads through SMTP URLs without exposing credentials in the config", async () => {
    const sent: Array<{ smtpUrl: string; message: { from: string; to: string[]; subject: string; text: string } }> = [];
    const env = { SMTP_URL: "smtps://user:pass@smtp.example.com:465" };
    const notifier = new EmailNotifier(
      {
        enabled: true,
        smtpEnv: "SMTP_URL",
        from: "boardreadyops@example.com",
        recipients: ["lead@example.com", "qa@example.com"],
      },
      {
        env,
        sendEmail: async (smtpUrl, message) => {
          sent.push({ smtpUrl, message });
        },
      },
    );

    await notifier.notify(samplePayload());

    expect(sent).toEqual([
      {
        smtpUrl: env.SMTP_URL,
        message: {
          from: "boardreadyops@example.com",
          to: ["lead@example.com", "qa@example.com"],
          subject: "BoardReadyOps found 1 finding",
          text: expect.stringContaining("bom.missing-mpn"),
        },
      },
    ]);
  });

  it("reports notifier availability from enabled config and trimmed env values", () => {
    const env = {
      SLACK_WEBHOOK_URL: " https://hooks.slack.test/services/T000/B000/secret ",
      SMTP_URL: " smtp://smtp.example.com ",
      TG_BOT_TOKEN: " telegram-secret ",
    };

    expect(new SlackNotifier({ enabled: true, webhookEnv: "SLACK_WEBHOOK_URL" }, { env }).isAvailable()).toBe(true);
    expect(new SlackNotifier({ enabled: false, webhookEnv: "SLACK_WEBHOOK_URL" }, { env }).isAvailable()).toBe(false);
    expect(
      new TelegramNotifier({ enabled: true, botTokenEnv: "TG_BOT_TOKEN", chatId: "-100123" }, { env }).isAvailable(),
    ).toBe(true);
    expect(
      new TelegramNotifier({ enabled: true, botTokenEnv: "TG_BOT_TOKEN", chatId: " " }, { env }).isAvailable(),
    ).toBe(false);
    expect(
      new EmailNotifier(
        { enabled: true, smtpEnv: "SMTP_URL", recipients: [" ", "lead@example.com"] },
        { env },
      ).isAvailable(),
    ).toBe(true);
    expect(new EmailNotifier({ enabled: true, smtpEnv: "SMTP_URL", recipients: [" "] }, { env }).isAvailable()).toBe(
      false,
    );
    expect(envValue({ EMPTY: "   " }, "EMPTY")).toBeUndefined();
    expect(envValue(env, undefined)).toBeUndefined();
  });

  it("uses the default email sender address and filters blank recipients", async () => {
    const sent: Array<{ from: string; to: string[] }> = [];
    await new EmailNotifier(
      {
        enabled: true,
        smtpEnv: "SMTP_URL",
        recipients: ["", " lead@example.com "],
      },
      {
        env: { SMTP_URL: "smtp://smtp.example.com" },
        sendEmail: async (_smtpUrl, message) => {
          sent.push({ from: message.from, to: message.to });
        },
      },
    ).notify(samplePayload());

    expect(sent).toEqual([{ from: "boardreadyops@localhost", to: ["lead@example.com"] }]);
  });

  it("skips direct notifier sends when required environment is unavailable", async () => {
    await expect(
      new SlackNotifier({ enabled: true, webhookEnv: "SLACK_WEBHOOK_URL" }).notify(samplePayload()),
    ).resolves.toEqual({
      notifier: "slack",
      status: "skipped",
      reason: "unavailable",
    });
    await expect(
      new DiscordNotifier({ enabled: true, webhookEnv: "DISCORD_WEBHOOK_URL" }).notify(samplePayload()),
    ).resolves.toEqual({
      notifier: "discord",
      status: "skipped",
      reason: "unavailable",
    });
    await expect(
      new TeamsNotifier({ enabled: true, webhookEnv: "TEAMS_WEBHOOK_URL" }).notify(samplePayload()),
    ).resolves.toEqual({
      notifier: "teams",
      status: "skipped",
      reason: "unavailable",
    });
    await expect(
      new TelegramNotifier({ enabled: true, botTokenEnv: "TG_BOT_TOKEN" }).notify(samplePayload()),
    ).resolves.toEqual({
      notifier: "telegram",
      status: "skipped",
      reason: "unavailable",
    });
    await expect(new EmailNotifier({ enabled: true, smtpEnv: "SMTP_URL" }).notify(samplePayload())).resolves.toEqual({
      notifier: "email",
      status: "skipped",
      reason: "unavailable",
    });
  });

  it("sends email through a minimal SMTP server", async () => {
    const commands: string[] = [];
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 smtp.test ESMTP\r\n");
      let buffer = "";
      let dataMode = false;
      socket.on("data", (chunk) => {
        buffer += chunk;
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n");
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (dataMode) {
            if (line === ".") {
              dataMode = false;
              socket.write("250 accepted\r\n");
            }
            continue;
          }
          commands.push(line);
          if (line.startsWith("EHLO")) {
            socket.write("250 smtp.test\r\n");
          } else if (line.startsWith("AUTH PLAIN")) {
            socket.write("235 authenticated\r\n");
          } else if (line.startsWith("MAIL FROM")) {
            socket.write("250 sender ok\r\n");
          } else if (line.startsWith("RCPT TO")) {
            socket.write("250 recipient ok\r\n");
          } else if (line === "DATA") {
            dataMode = true;
            socket.write("354 end with dot\r\n");
          } else if (line === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else {
            socket.write("250 ok\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("SMTP test server did not expose a port.");
    }
    try {
      await sendSmtpEmail(`smtp://user:pass@127.0.0.1:${address.port}`, {
        from: "boardreadyops@example.com",
        to: ["lead@example.com"],
        subject: "BoardReadyOps found 1 finding",
        text: ".leading dot is escaped",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(commands).toEqual([
      "EHLO boardreadyops.local",
      expect.stringMatching(/^AUTH PLAIN /),
      "MAIL FROM:<boardreadyops@example.com>",
      "RCPT TO:<lead@example.com>",
      "DATA",
      "QUIT",
    ]);
  });

  it("sends SMTP without auth and accepts alternate recipient response codes", async () => {
    const commands: string[] = [];
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 smtp.test ESMTP\r\n");
      let buffer = "";
      let dataMode = false;
      socket.on("data", (chunk) => {
        buffer += chunk;
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n");
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (dataMode) {
            if (line === ".") {
              dataMode = false;
              socket.write("250 accepted\r\n");
            }
            continue;
          }
          commands.push(line);
          if (line.startsWith("EHLO")) {
            socket.write("250 smtp.test\r\n");
          } else if (line.startsWith("MAIL FROM")) {
            socket.write("250 sender ok\r\n");
          } else if (line.startsWith("RCPT TO")) {
            socket.write("251 recipient forwarded\r\n");
          } else if (line === "DATA") {
            dataMode = true;
            socket.write("354 end with dot\r\n");
          } else if (line === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else {
            socket.write("250 ok\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("SMTP test server did not expose a port.");
    }
    try {
      await sendSmtpEmail(`smtp://127.0.0.1:${address.port}`, {
        from: "boardreadyops@example.com",
        to: ["lead@example.com"],
        subject: "BoardReadyOps found 1 finding",
        text: "body",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(commands).toEqual([
      "EHLO boardreadyops.local",
      "MAIL FROM:<boardreadyops@example.com>",
      "RCPT TO:<lead@example.com>",
      "DATA",
      "QUIT",
    ]);
  });

  it("surfaces SMTP response failures", async () => {
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 smtp.test ESMTP\r\n");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n");
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (line.startsWith("EHLO")) {
            socket.write("250 smtp.test\r\n");
          } else if (line.startsWith("MAIL FROM")) {
            socket.write("550 sender rejected\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("SMTP test server did not expose a port.");
    }
    try {
      await expect(
        sendSmtpEmail(`smtp://127.0.0.1:${address.port}`, {
          from: "boardreadyops@example.com",
          to: ["lead@example.com"],
          subject: "subject",
          text: "body",
        }),
      ).rejects.toThrow("SMTP 550");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("times out stalled SMTP connections", async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.setEncoding("utf8");
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("SMTP test server did not expose a port.");
    }
    try {
      await expect(
        sendSmtpEmail(
          `smtp://127.0.0.1:${address.port}`,
          {
            from: "boardreadyops@example.com",
            to: ["lead@example.com"],
            subject: "subject",
            text: "body",
          },
          { timeoutMs: 1 },
        ),
      ).rejects.toThrow("SMTP timeout");
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects unsupported SMTP URLs and HTTP error responses", async () => {
    await expect(
      sendSmtpEmail("https://smtp.example.com", {
        from: "boardreadyops@example.com",
        to: ["lead@example.com"],
        subject: "subject",
        text: "body",
      }),
    ).rejects.toThrow("SMTP URL must use smtp or smtps.");

    await expect(
      postJson(
        async () =>
          new Response("bad", {
            status: 503,
          }),
        "https://hooks.example.test",
        {},
      ),
    ).rejects.toThrow("HTTP 503");

    vi.stubGlobal("fetch", undefined);
    await expect(postJson(undefined, "https://hooks.example.test", {})).rejects.toThrow("fetch is not available");
  });
});

describe("notifier dispatch", () => {
  it("returns no results when notifier config is absent and reports disabled notifiers", async () => {
    await expect(dispatchNotifications(undefined, samplePayload())).resolves.toEqual([]);
    await expect(dispatchNotifications({ slack: { enabled: false } }, samplePayload())).resolves.toEqual([
      { notifier: "slack", status: "skipped", reason: "disabled" },
    ]);
  });

  it("filters by minSeverity and skips unavailable env without failing", async () => {
    const requests: unknown[] = [];
    const results = await dispatchNotifications(
      {
        slack: { enabled: true, webhookEnv: "SLACK_WEBHOOK_URL", minSeverity: "critical" },
        discord: { enabled: true, webhookEnv: "DISCORD_WEBHOOK_URL", minSeverity: "medium" },
        teams: { enabled: true, webhookEnv: "MISSING_TEAMS_WEBHOOK" },
      },
      samplePayload(),
      {
        env: { SLACK_WEBHOOK_URL: "https://hooks.slack.test/secret", DISCORD_WEBHOOK_URL: "https://discord.test" },
        fetcher: async () => {
          requests.push("sent");
          return new Response("ok");
        },
      },
    );

    expect(results).toEqual([
      { notifier: "slack", status: "skipped", reason: "severity-filter" },
      { notifier: "discord", status: "sent" },
      { notifier: "teams", status: "skipped", reason: "unavailable" },
    ]);
    expect(requests).toEqual(["sent"]);
  });

  it("dispatches Telegram and Email notifiers through shared dispatch", async () => {
    const httpRequests: string[] = [];
    const sentEmail: string[] = [];
    const results = await dispatchNotifications(
      {
        telegram: { enabled: true, botTokenEnv: "TG_BOT_TOKEN", chatId: "-100123" },
        email: { enabled: true, smtpEnv: "SMTP_URL", recipients: ["lead@example.com"] },
      },
      samplePayload(),
      {
        env: { TG_BOT_TOKEN: "telegram-secret", SMTP_URL: "smtp://smtp.example.com" },
        fetcher: async (url) => {
          httpRequests.push(String(url));
          return new Response("ok");
        },
        sendEmail: async (_smtpUrl, message) => {
          sentEmail.push(message.to.join(","));
        },
      },
    );

    expect(results).toEqual([
      { notifier: "telegram", status: "sent" },
      { notifier: "email", status: "sent" },
    ]);
    expect(httpRequests).toEqual(["https://api.telegram.org/bottelegram-secret/sendMessage"]);
    expect(sentEmail).toEqual(["lead@example.com"]);
  });

  it("captures notifier failures and redacts endpoint secrets from logs", async () => {
    const memory = memoryStream();
    const logger = createLogger({
      level: "debug",
      format: "json",
      stream: memory.stream,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
    });

    const results = await dispatchNotifications(
      { slack: { enabled: true, webhookEnv: "SLACK_WEBHOOK_URL" } },
      samplePayload(),
      {
        env: { SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/T000/B000/secret" },
        fetcher: async () => {
          throw new Error("network down");
        },
        logger,
      },
    );

    expect(results).toEqual([{ notifier: "slack", status: "failed", reason: "network down" }]);
    expect(memory.text()).toContain("notifier.dispatch.failed");
    expect(memory.text()).not.toContain("secret");
  });

  it("dispatches configured notifications from pipeline without blocking run results", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/services/T000/B000/secret");
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response("not sent", { status: 500 });
    });
    const root = await writeFixture({
      "notified.kicad_pro": "{}",
      "notified.kicad_sch": "(kicad_sch)",
      "notified.kicad_pcb": '(kicad_pcb (title_block (rev "")))',
      "boardreadyops.yml": `version: 1
fail-on: never
notifiers:
  slack:
    enabled: true
    webhookEnv: SLACK_WEBHOOK_URL
    minSeverity: high
`,
    });

    const result = await runPipeline(
      {
        path: root,
        rules: ["release.revision-set"],
        failOn: "never",
        notificationLinks: { runUrl: "https://github.com/o/r/actions/runs/1" },
      },
      createLogger("silent"),
    );

    expect(result.summary.total).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]?.body)).toContain("https://github.com/o/r/actions/runs/1");
  });

  it("does not read notifier secrets or make notifier calls under the safe execution policy", async () => {
    const requests: string[] = [];
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/services/T000/B000/secret");
    vi.stubGlobal("fetch", async (url: string | URL) => {
      requests.push(String(url));
      return new Response(null, { status: 204 });
    });
    const root = await writeFixture({
      "notified.kicad_pro": "{}",
      "notified.kicad_sch": "(kicad_sch)",
      "notified.kicad_pcb": '(kicad_pcb (title_block (rev "")))',
      "boardreadyops.yml": `version: 1
fail-on: never
notifiers:
  slack:
    enabled: true
    webhookEnv: SLACK_WEBHOOK_URL
    minSeverity: high
`,
    });

    const result = await runPipeline(
      {
        path: root,
        executionPolicy: "safe",
        rules: ["release.revision-set"],
        failOn: "never",
      },
      createLogger("silent"),
    );

    expect(result.summary.total).toBeGreaterThan(0);
    expect(requests).toEqual([]);
  });
});

describe("webhook env-name resolution (SSRF-adjacent confused-deputy characteristic)", () => {
  it("posts to whatever URL the named env var holds, not just an intended webhook secret", async () => {
    // config.webhookEnv is only a lookup key (schemas/config.schema.json puts no allowlist/pattern
    // on it), and boardreadyops.yml is repository-controlled config. On a `pull_request`-triggered
    // workflow that checks out the PR head, a PR author can set webhookEnv to the NAME of any env
    // var they can guess, and this notifier will POST the run's findings to whatever URL-shaped
    // value that name resolves to in the CI environment -- even if that env var was never intended
    // as a webhook target. This test documents that this is current, real behavior; it is not fixed
    // here (see the W28 ledger remaining note for the proposed allowlist-pattern follow-up).
    const requests: string[] = [];
    const fetcher = async (url: string | URL) => {
      requests.push(String(url));
      return new Response("ok", { status: 200 });
    };
    const env = {
      // An env var present for an unrelated purpose (e.g. an internal service used elsewhere in CI),
      // not set up by the operator as a notification target.
      INTERNAL_METRICS_INGEST_URL: "https://internal-metrics.example.test/ingest",
    };

    await new SlackNotifier({ enabled: true, webhookEnv: "INTERNAL_METRICS_INGEST_URL" }, { env, fetcher }).notify(
      samplePayload(),
    );

    expect(requests).toEqual([env.INTERNAL_METRICS_INGEST_URL]);
  });

  it("fails closed (sends nothing) when the named env var is unset, rather than posting to an empty/undefined URL", async () => {
    const requests: string[] = [];
    const fetcher = async (url: string | URL) => {
      requests.push(String(url));
      return new Response("ok", { status: 200 });
    };

    const result = await new SlackNotifier(
      { enabled: true, webhookEnv: "SOME_ENV_VAR_THAT_IS_NOT_SET" },
      { env: {}, fetcher },
    ).notify(samplePayload());

    expect(result).toEqual({ notifier: "slack", status: "skipped", reason: "unavailable" });
    expect(requests).toEqual([]);
  });
});

function samplePayload(): NotificationPayload {
  const finding = createFinding({
    ruleId: "bom.missing-mpn",
    severity: "high",
    message: "R1 is missing an MPN.",
    project: "hardware/demo.kicad_pro",
    resource: { path: "hardware/bom.csv", kind: "bom" },
  });
  return {
    title: "BoardReadyOps found 1 finding",
    summary: "1 high finding requires attention.",
    severity: "high",
    findings: [finding],
    links: {
      reportUrl: "https://example.test/report",
      runUrl: "https://github.com/o/r/actions/runs/1",
    },
  };
}

function sampleResult(findings = samplePayload().findings): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "0.0.0-test" },
    summary: summarizeFindings(findings, "high"),
    projects: [],
    findings,
    fabrication: { bom: [], outputs: [] },
    generatedAt: new Date("2026-05-23T00:00:00.000Z").toISOString(),
  };
}

function memoryStream() {
  let text = "";
  return {
    stream: {
      write(value: string) {
        text += value;
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => text,
  };
}

describe("notification payload rendering", () => {
  it("builds a compact summary from run results", () => {
    expect(notificationPayloadFromResult(sampleResult(), { reportUrl: "https://example.test/report" })).toMatchObject({
      title: "BoardReadyOps found 1 finding",
      summary: "1 high finding. Max severity: high.",
      severity: "high",
      links: { reportUrl: "https://example.test/report" },
    });

    expect(notificationPayloadFromResult(sampleResult([]), {})).toMatchObject({
      title: "BoardReadyOps passed",
      summary: "No findings.",
      severity: "info",
    });
  });

  it("renders text without optional links or findings", () => {
    expect(
      renderNotificationText({
        title: "BoardReadyOps passed",
        summary: "No findings.",
        severity: "info",
        findings: [],
        links: {},
      }),
    ).toBe("BoardReadyOps passed\nNo findings.");
  });
});
