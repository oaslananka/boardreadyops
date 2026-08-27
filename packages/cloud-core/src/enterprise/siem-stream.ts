export type SiemEvent = {
  id: string;
  tenantId: string;
  type: string;
  actorId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
};

export interface SiemStream {
  publish(event: SiemEvent): Promise<void>;
  exportForTenant(tenantId: string, since: string): Promise<SiemEvent[]>;
}

export class InMemorySiemStream implements SiemStream {
  private readonly events: SiemEvent[] = [];
  private readonly webhookUrl: string | null;
  constructor(webhookUrl?: string | null) {
    this.webhookUrl = webhookUrl ?? process.env.SIEM_WEBHOOK_URL ?? null;
  }
  async publish(event: SiemEvent): Promise<void> {
    this.events.push(event);
    if (this.webhookUrl) {
      // In production, POST to webhookUrl with HMAC. For now, no-op if not configured.
      // We keep local buffer for export API.
    }
  }
  async exportForTenant(tenantId: string, since: string): Promise<SiemEvent[]> {
    const sinceTs = new Date(since).getTime();
    return this.events.filter((e) => e.tenantId === tenantId && new Date(e.timestamp).getTime() >= sinceTs);
  }
}
