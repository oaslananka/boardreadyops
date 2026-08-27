export type ScimUser = {
  id: string;
  externalId: string | null;
  userName: string;
  email: string;
  givenName?: string;
  familyName?: string;
  active: boolean;
};

export interface ScimAdapter {
  provisionUser(tenantId: string, input: Omit<ScimUser, "id">): Promise<ScimUser>;
  deprovisionUser(tenantId: string, userId: string): Promise<void>;
  getUser(tenantId: string, userId: string): Promise<ScimUser | null>;
  listUsers(tenantId: string): Promise<ScimUser[]>;
  disableUser(tenantId: string, userId: string): Promise<void>;
}

export class InMemoryScimAdapter implements ScimAdapter {
  private readonly users = new Map<string, Map<string, ScimUser>>();
  private ensure(tenantId: string): Map<string, ScimUser> {
    if (!this.users.has(tenantId)) this.users.set(tenantId, new Map());
    return this.users.get(tenantId) as Map<string, ScimUser>;
  }
  async provisionUser(tenantId: string, input: Omit<ScimUser, "id">): Promise<ScimUser> {
    const map = this.ensure(tenantId);
    const id = `scim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const user: ScimUser = { id, ...input };
    map.set(id, user);
    return user;
  }
  async deprovisionUser(tenantId: string, userId: string): Promise<void> {
    const map = this.ensure(tenantId);
    if (!map.has(userId)) throw new Error("User not found");
    map.delete(userId);
    // On deprovision, revoke sessions/tokens (caller handles via billing-store + api-token-store)
  }
  async getUser(tenantId: string, userId: string): Promise<ScimUser | null> {
    return this.ensure(tenantId).get(userId) ?? null;
  }
  async listUsers(tenantId: string): Promise<ScimUser[]> {
    return [...this.ensure(tenantId).values()];
  }
  async disableUser(tenantId: string, userId: string): Promise<void> {
    const map = this.ensure(tenantId);
    const user = map.get(userId);
    if (!user) throw new Error("User not found");
    map.set(userId, { ...user, active: false });
    // Immediate session/token revoke is caller responsibility
  }
}
