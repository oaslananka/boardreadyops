import { connect, createServer, type Socket } from "node:net";

/**
 * Drop an actual PostgreSQL TCP response *after* ReadyForQuery confirms that
 * the targeted statement has completed. Unlike throwing from a query
 * wrapper, this exercises the pg driver's real lost-acknowledgement behavior.
 *
 * Only accept a loopback disposable database; never proxy a shared/remote DB.
 */
export async function startLostPostgresReplyProxy(databaseUrl: string, marker: string) {
  const target = new URL(databaseUrl);
  if (target.hostname !== "127.0.0.1" || !target.port) {
    throw new Error("lost-reply integration test requires a disposable loopback PostgreSQL endpoint");
  }

  let droppedReply = false;
  const sockets = new Set<Socket>();
  const queryMarker = Buffer.from(marker);
  const server = createServer((client) => {
    const postgres = connect(Number(target.port), target.hostname);
    sockets.add(client);
    sockets.add(postgres);
    let armed = false;
    let sentTail = Buffer.alloc(0);
    let buffered = Buffer.alloc(0);

    client.on("data", (chunk: Buffer) => {
      // Preserve the marker across TCP packet boundaries without storing
      // request secrets or recording their values in test output.
      const sent = Buffer.concat([sentTail, chunk]);
      if (sent.includes(queryMarker)) armed = true;
      sentTail = sent.subarray(-(queryMarker.length - 1));
      if (!postgres.destroyed) postgres.write(chunk);
    });
    postgres.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      // PostgreSQL backend messages: one type byte, length (including the
      // length word), and payload. The final Z/ReadyForQuery follows commit.
      while (buffered.length >= 5) {
        const length = buffered.readUInt32BE(1);
        if (length < 4 || length > 16 * 1024 * 1024) {
          client.destroy();
          postgres.destroy();
          return;
        }
        const total = length + 1;
        if (buffered.length < total) break;
        const packet = buffered.subarray(0, total);
        buffered = buffered.subarray(total);
        if (armed) {
          // Withhold the complete result, including command completion.
          // Destroy the real socket only after PostgreSQL reports readiness.
          if (packet[0] === 90) {
            droppedReply = true;
            client.destroy();
            postgres.destroy();
            return;
          }
          continue;
        }
        client.write(packet);
      }
    });
    client.on("error", () => postgres.destroy());
    postgres.on("error", () => client.destroy());
    client.on("close", () => {
      sockets.delete(client);
      postgres.destroy();
    });
    postgres.on("close", () => {
      sockets.delete(postgres);
      client.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PostgreSQL test proxy has no TCP address");
  const proxyUrl = new URL(databaseUrl);
  proxyUrl.hostname = "127.0.0.1";
  proxyUrl.port = String(address.port);
  return {
    connectionString: proxyUrl.toString(),
    droppedReply: () => droppedReply,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
