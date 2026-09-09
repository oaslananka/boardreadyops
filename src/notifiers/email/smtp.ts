import net from "node:net";
import tls from "node:tls";

export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

export type EmailSender = (smtpUrl: string, message: EmailMessage) => Promise<void>;

interface SmtpOptions {
  timeoutMs?: number | undefined;
}

export async function sendSmtpEmail(smtpUrl: string, message: EmailMessage, options: SmtpOptions = {}): Promise<void> {
  const parsed = new URL(smtpUrl);
  if (parsed.protocol !== "smtp:" && parsed.protocol !== "smtps:") {
    throw new Error("SMTP URL must use smtp or smtps.");
  }
  let port = parsed.protocol === "smtps:" ? 465 : 25;
  if (parsed.port) port = Number.parseInt(parsed.port, 10);
  const secure = parsed.protocol === "smtps:";
  const socket = secure
    ? tls.connect({ host: parsed.hostname, port, servername: parsed.hostname })
    : net.connect({ host: parsed.hostname, port });
  const client = new SmtpClient(socket, options.timeoutMs ?? 10_000);
  try {
    await client.expect(220);
    await client.command(`EHLO ${hostnameForEhlo()}`, 250);
    if (parsed.username || parsed.password) {
      const credentials = Buffer.from(
        `\0${decodeURIComponent(parsed.username)}\0${decodeURIComponent(parsed.password)}`,
      ).toString("base64");
      await client.command(`AUTH PLAIN ${credentials}`, 235);
    }
    await client.command(`MAIL FROM:<${message.from}>`, 250);
    for (const recipient of message.to) {
      await client.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await client.command("DATA", 354);
    await client.command(`${formatMessage(message)}\r\n.`, 250);
    await client.command("QUIT", 221);
  } finally {
    socket.end();
  }
}

function formatMessage(message: EmailMessage): string {
  return [
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${message.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.text.replace(/^\./gm, ".."),
  ].join("\r\n");
}

function hostnameForEhlo(): string {
  return "boardreadyops.local";
}

class SmtpClient {
  private buffer = "";
  private pending:
    | {
        expected: number[];
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | undefined;

  constructor(
    private readonly socket: net.Socket | tls.TLSSocket,
    timeoutMs: number,
  ) {
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error) => this.pending?.reject(error));
    socket.on("timeout", () => {
      this.pending?.reject(new Error("SMTP timeout"));
      socket.destroy();
    });
  }

  async expect(expected: number | number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending = {
        expected: Array.isArray(expected) ? expected : [expected],
        resolve,
        reject,
      };
      this.flush();
    });
  }

  async command(command: string, expected: number | number[]): Promise<void> {
    this.socket.write(`${command}\r\n`);
    await this.expect(expected);
  }

  private flush(): void {
    if (!this.pending) {
      return;
    }
    const response = completeResponse(this.buffer);
    if (!response) {
      return;
    }
    this.buffer = this.buffer.slice(response.length);
    const code = Number.parseInt(response.slice(0, 3), 10);
    const pending = this.pending;
    this.pending = undefined;
    if (pending.expected.includes(code)) {
      pending.resolve();
    } else {
      pending.reject(new Error(`SMTP ${code}`));
    }
  }
}

function completeResponse(buffer: string): string | undefined {
  const lines = buffer.split(/\r?\n/);
  if (lines.length < 2) {
    return undefined;
  }
  let consumed = "";
  for (const line of lines) {
    if (line === "") {
      return consumed || undefined;
    }
    consumed += `${line}\r\n`;
    if (/^\d{3}\s/.test(line)) {
      return consumed;
    }
  }
  return undefined;
}
