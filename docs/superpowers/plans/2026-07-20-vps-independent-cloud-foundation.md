# VPS-Independent Cloud Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BoardReadyOps Cloud fail closed when required persistence is unavailable and expose dependency-free liveness plus PostgreSQL-backed readiness endpoints before the Cloudflare/Neon migration.

**Architecture:** Add one focused runtime-configuration module and one focused readiness service under `apps/web/lib`. Keep route handlers thin: liveness is dependency-free, readiness delegates to the service, and the GitHub webhook converts configuration failures into stable HTTP 503 responses. PostgreSQL remains the only deployed persistence mode; an explicit in-memory mode is allowed only when `NODE_ENV` is `test` or `development`.

**Tech Stack:** TypeScript, Next.js 16 route handlers, Node.js runtime, PostgreSQL via the existing `@boardreadyops/db/pg-executor`, Vitest 4.

## Implementation Reconciliation

This plan has been executed. The approved design document remains the source of truth where early plan examples differ from the final implementation. The completed implementation uses these exact decisions:

- `BOARDREADYOPS_PERSISTENCE_MODE=memory` is accepted only in `test` or `development`; production always rejects it.
- Liveness responses use `{ "ok": true, "service": "boardreadyops-cloud", "check": "liveness" }`.
- Successful readiness responses include `check: "readiness"` and `checks.configuration/database: "pass"`.
- Failed readiness responses include `check: "readiness"` and a stable public reason without raw dependency errors.
- The default readiness PostgreSQL executor is cached per connection string so health polling does not create a new pool on every request.
- The webhook route imports the typed configuration error directly; `lifecycle-store.d.ts` did not require modification.
- Repository-approved `core` commit scope is used instead of the invalid illustrative `cloud` scope in early commit examples.

## Global Constraints

- Production must never silently select a no-op lifecycle store.
- `postgres` is the deployed persistence mode and requires `DATABASE_URL`.
- `memory` is valid only when `NODE_ENV` is `test` or `development` and must be selected explicitly with `BOARDREADYOPS_PERSISTENCE_MODE=memory`.
- `/api/health/live` must not touch PostgreSQL or any external service.
- `/api/health/ready` must verify required configuration and execute `select 1` with a 2,000 ms timeout.
- Readiness and webhook errors must expose stable reason codes without secrets, raw SQL errors, stack traces, connection strings, or hostnames.
- Existing `/api/health` remains a temporary compatibility alias for liveness.
- No Cloudflare, Neon, Redis, queue, or new production dependency is introduced in this increment.

---

## File Map

- Create `apps/web/lib/cloud-runtime-config.ts`: parse and validate persistence mode and required deployed configuration.
- Create `apps/web/lib/cloud-readiness.ts`: perform timeout-bounded PostgreSQL readiness checks and return typed public results.
- Create `apps/web/app/api/health/live/route.ts`: dependency-free liveness endpoint.
- Create `apps/web/app/api/health/ready/route.ts`: readiness endpoint delegating to `cloud-readiness`.
- Modify `apps/web/app/api/health/route.ts`: compatibility alias that reuses the liveness handler.
- Modify `apps/web/app/api/github/webhook/lifecycle-store.js`: replace implicit no-op selection with explicit validated persistence selection.
- Modify `apps/web/app/api/github/webhook/lifecycle-store.d.ts`: expose the typed configuration error used by the webhook route.
- Modify `apps/web/app/api/github/webhook/route.ts`: map persistence configuration errors to stable HTTP 503 JSON.
- Create `tests/unit/web/cloud-runtime-config.test.ts`: configuration policy coverage.
- Create `tests/unit/web/cloud-readiness.test.ts`: readiness behavior with injected query executors.
- Create `tests/unit/web/health-routes.test.ts`: route-level liveness/readiness coverage.
- Modify `tests/unit/web/github-webhook-route.test.ts`: fail-closed persistence and explicit test-memory behavior.

---

### Task 1: Runtime Persistence Configuration

**Files:**
- Create: `apps/web/lib/cloud-runtime-config.ts`
- Test: `tests/unit/web/cloud-runtime-config.test.ts`

**Interfaces:**
- Produces: `CloudPersistenceMode = "postgres" | "memory"`
- Produces: `CloudRuntimeConfigurationError extends Error` with public `code: "invalid-persistence-mode" | "memory-persistence-not-allowed" | "missing-database-url"`
- Produces: `resolveCloudPersistenceConfiguration(environment?: NodeJS.ProcessEnv): { mode: CloudPersistenceMode; databaseUrl?: string }`
- Consumes: only `NodeJS.ProcessEnv`; no database or framework dependency.

- [ ] **Step 1: Write the failing configuration tests**

Create `tests/unit/web/cloud-runtime-config.test.ts` with tests that assert:

```ts
import { describe, expect, it } from "vitest";
import {
  CloudRuntimeConfigurationError,
  resolveCloudPersistenceConfiguration,
} from "../../../apps/web/lib/cloud-runtime-config.js";

describe("cloud runtime persistence configuration", () => {
  it("defaults to postgres and requires DATABASE_URL", () => {
    expect(() => resolveCloudPersistenceConfiguration({ NODE_ENV: "production" })).toThrowError(
      expect.objectContaining({ code: "missing-database-url" }),
    );
  });

  it("returns postgres configuration when DATABASE_URL exists", () => {
    expect(
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://example.invalid/boardreadyops",
      }),
    ).toEqual({
      mode: "postgres",
      databaseUrl: "postgresql://example.invalid/boardreadyops",
    });
  });

  it("allows explicit memory persistence only in tests", () => {
    expect(
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "test",
        BOARDREADYOPS_PERSISTENCE_MODE: "memory",
      }),
    ).toEqual({ mode: "memory" });
  });

  it("rejects memory persistence outside tests", () => {
    expect(() =>
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "development",
        BOARDREADYOPS_PERSISTENCE_MODE: "memory",
      }),
    ).toThrowError(expect.objectContaining({ code: "memory-persistence-not-allowed" }));
  });

  it("rejects unknown persistence modes", () => {
    expect(() =>
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "test",
        BOARDREADYOPS_PERSISTENCE_MODE: "redis",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-persistence-mode" }));
  });

  it("uses a typed configuration error", () => {
    try {
      resolveCloudPersistenceConfiguration({ NODE_ENV: "production" });
      throw new Error("expected configuration resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRuntimeConfigurationError);
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm vitest run tests/unit/web/cloud-runtime-config.test.ts
```

Expected: FAIL because `apps/web/lib/cloud-runtime-config.ts` does not exist.

- [ ] **Step 3: Implement the minimal configuration module**

Create `apps/web/lib/cloud-runtime-config.ts`:

```ts
export type CloudPersistenceMode = "postgres" | "memory";

export type CloudRuntimeConfigurationErrorCode =
  | "invalid-persistence-mode"
  | "memory-persistence-not-allowed"
  | "missing-database-url";

export class CloudRuntimeConfigurationError extends Error {
  readonly code: CloudRuntimeConfigurationErrorCode;

  constructor(code: CloudRuntimeConfigurationErrorCode, message: string) {
    super(message);
    this.name = "CloudRuntimeConfigurationError";
    this.code = code;
  }
}

export type CloudPersistenceConfiguration =
  | { mode: "postgres"; databaseUrl: string }
  | { mode: "memory" };

export function resolveCloudPersistenceConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CloudPersistenceConfiguration {
  const configuredMode = environment.BOARDREADYOPS_PERSISTENCE_MODE?.trim();

  if (configuredMode && configuredMode !== "postgres" && configuredMode !== "memory") {
    throw new CloudRuntimeConfigurationError(
      "invalid-persistence-mode",
      "BOARDREADYOPS_PERSISTENCE_MODE must be postgres or memory",
    );
  }

  const mode: CloudPersistenceMode = configuredMode ?? "postgres";

  if (mode === "memory") {
    if (environment.NODE_ENV !== "test") {
      throw new CloudRuntimeConfigurationError(
        "memory-persistence-not-allowed",
        "memory persistence is allowed only when NODE_ENV=test",
      );
    }

    return { mode };
  }

  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new CloudRuntimeConfigurationError("missing-database-url", "DATABASE_URL is required");
  }

  return { mode, databaseUrl };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
corepack pnpm vitest run tests/unit/web/cloud-runtime-config.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/web/lib/cloud-runtime-config.ts tests/unit/web/cloud-runtime-config.test.ts
git commit -m "feat(cloud): validate persistence configuration"
```

---

### Task 2: PostgreSQL Readiness Service

**Files:**
- Create: `apps/web/lib/cloud-readiness.ts`
- Test: `tests/unit/web/cloud-readiness.test.ts`

**Interfaces:**
- Consumes: `resolveCloudPersistenceConfiguration(environment)` from Task 1.
- Produces: `CloudReadinessReason = "ready" | "missing-configuration" | "database-unavailable" | "database-timeout"`
- Produces: `CloudReadinessResult = { ok: true; service: "boardreadyops-cloud"; reason: "ready" } | { ok: false; service: "boardreadyops-cloud"; reason: Exclude<CloudReadinessReason, "ready">; missing?: string[] }`
- Produces: `checkCloudReadiness(options?: { environment?: NodeJS.ProcessEnv; query?: (sql: string) => Promise<unknown>; timeoutMs?: number }): Promise<CloudReadinessResult>`

- [ ] **Step 1: Write failing readiness-service tests**

Create `tests/unit/web/cloud-readiness.test.ts` with injected query functions covering:

```ts
import { describe, expect, it, vi } from "vitest";
import { checkCloudReadiness } from "../../../apps/web/lib/cloud-readiness.js";

describe("cloud readiness", () => {
  it("reports missing deployed configuration without calling PostgreSQL", async () => {
    const query = vi.fn();
    await expect(
      checkCloudReadiness({ environment: { NODE_ENV: "production" }, query }),
    ).resolves.toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      reason: "missing-configuration",
      missing: ["DATABASE_URL", "GITHUB_WEBHOOK_SECRET"],
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("reports ready after a successful select 1", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] });
    await expect(
      checkCloudReadiness({
        environment: {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://example.invalid/boardreadyops",
          GITHUB_WEBHOOK_SECRET: "secret",
        },
        query,
      }),
    ).resolves.toEqual({ ok: true, service: "boardreadyops-cloud", reason: "ready" });
    expect(query).toHaveBeenCalledWith("select 1 as ready");
  });

  it("reports database-unavailable without leaking the database error", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED db.internal:5432"));
    const result = await checkCloudReadiness({
      environment: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://example.invalid/boardreadyops",
        GITHUB_WEBHOOK_SECRET: "secret",
      },
      query,
    });
    expect(result).toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      reason: "database-unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("db.internal");
  });

  it("reports database-timeout when the query exceeds the timeout", async () => {
    const query = vi.fn(() => new Promise(() => undefined));
    await expect(
      checkCloudReadiness({
        environment: {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://example.invalid/boardreadyops",
          GITHUB_WEBHOOK_SECRET: "secret",
        },
        query,
        timeoutMs: 5,
      }),
    ).resolves.toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      reason: "database-timeout",
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
corepack pnpm vitest run tests/unit/web/cloud-readiness.test.ts
```

Expected: FAIL because `cloud-readiness.ts` does not exist.

- [ ] **Step 3: Implement the readiness service**

Create `apps/web/lib/cloud-readiness.ts` with:

```ts
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  CloudRuntimeConfigurationError,
  resolveCloudPersistenceConfiguration,
} from "./cloud-runtime-config.js";

const service = "boardreadyops-cloud" as const;
const defaultTimeoutMs = 2_000;

export type CloudReadinessResult =
  | { ok: true; service: typeof service; reason: "ready" }
  | {
      ok: false;
      service: typeof service;
      reason: "missing-configuration" | "database-unavailable" | "database-timeout";
      missing?: string[];
    };

type Query = (sql: string) => Promise<unknown>;

function missingConfiguration(environment: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  if (!environment.DATABASE_URL?.trim()) missing.push("DATABASE_URL");
  if (!environment.GITHUB_WEBHOOK_SECRET?.trim()) missing.push("GITHUB_WEBHOOK_SECRET");
  return missing;
}

export async function checkCloudReadiness(options: {
  environment?: NodeJS.ProcessEnv;
  query?: Query;
  timeoutMs?: number;
} = {}): Promise<CloudReadinessResult> {
  const environment = options.environment ?? process.env;
  const missing = missingConfiguration(environment);
  if (missing.length > 0) {
    return { ok: false, service, reason: "missing-configuration", missing };
  }

  let persistence;
  try {
    persistence = resolveCloudPersistenceConfiguration(environment);
  } catch (error) {
    if (error instanceof CloudRuntimeConfigurationError) {
      return { ok: false, service, reason: "missing-configuration" };
    }
    throw error;
  }

  if (persistence.mode === "memory") {
    return { ok: true, service, reason: "ready" };
  }

  const executor = options.query
    ? { query: options.query }
    : createPgQueryExecutor({ connectionString: persistence.databaseUrl, max: 1 });
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      executor.query("select 1 as ready"),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("BOARDREADYOPS_DATABASE_TIMEOUT")), timeoutMs);
      }),
    ]);
    return { ok: true, service, reason: "ready" };
  } catch (error) {
    return {
      ok: false,
      service,
      reason: error instanceof Error && error.message === "BOARDREADYOPS_DATABASE_TIMEOUT"
        ? "database-timeout"
        : "database-unavailable",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run focused tests and typecheck**

```bash
corepack pnpm vitest run tests/unit/web/cloud-readiness.test.ts
corepack pnpm --filter @boardreadyops/web typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/web/lib/cloud-readiness.ts tests/unit/web/cloud-readiness.test.ts
git commit -m "feat(cloud): add PostgreSQL readiness check"
```

---

### Task 3: Liveness and Readiness Route Handlers

**Files:**
- Create: `apps/web/app/api/health/live/route.ts`
- Create: `apps/web/app/api/health/ready/route.ts`
- Modify: `apps/web/app/api/health/route.ts`
- Create: `tests/unit/web/health-routes.test.ts`

**Interfaces:**
- Consumes: `checkCloudReadiness()` from Task 2.
- Produces: liveness HTTP 200 `{ ok: true, service: "boardreadyops-cloud", status: "live" }`.
- Produces: readiness HTTP 200 when ready and HTTP 503 for every non-ready result.
- Preserves: `/api/health` compatibility as the same liveness response.

- [ ] **Step 1: Write failing route tests**

Create `tests/unit/web/health-routes.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { GET as getHealth } from "../../../apps/web/app/api/health/route.js";
import { GET as getLive } from "../../../apps/web/app/api/health/live/route.js";
import { GET as getReady } from "../../../apps/web/app/api/health/ready/route.js";

const tracked = ["DATABASE_URL", "GITHUB_WEBHOOK_SECRET", "BOARDREADYOPS_PERSISTENCE_MODE"] as const;
const original = new Map(tracked.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of tracked) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("cloud health routes", () => {
  it("serves dependency-free liveness", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const response = getLive();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "boardreadyops-cloud",
      status: "live",
    });
  });

  it("keeps /api/health as a liveness alias", async () => {
    await expect(getHealth().json()).resolves.toEqual({
      ok: true,
      service: "boardreadyops-cloud",
      status: "live",
    });
  });

  it("returns 503 readiness when required configuration is missing", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const response = await getReady();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      reason: "missing-configuration",
      missing: ["DATABASE_URL", "GITHUB_WEBHOOK_SECRET"],
    });
  });
});
```

- [ ] **Step 2: Run the route test and verify RED**

```bash
corepack pnpm vitest run tests/unit/web/health-routes.test.ts
```

Expected: FAIL because the live and ready route modules do not exist.

- [ ] **Step 3: Implement thin route handlers**

Create `apps/web/app/api/health/live/route.ts`:

```ts
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json({ ok: true, service: "boardreadyops-cloud", status: "live" });
}
```

Replace `apps/web/app/api/health/route.ts` with:

```ts
export { runtime, GET } from "./live/route.js";
```

Create `apps/web/app/api/health/ready/route.ts`:

```ts
import { checkCloudReadiness } from "../../../../lib/cloud-readiness.js";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const result = await checkCloudReadiness();
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
```

- [ ] **Step 4: Run route tests and web typecheck**

```bash
corepack pnpm vitest run tests/unit/web/health-routes.test.ts
corepack pnpm --filter @boardreadyops/web typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/web/app/api/health tests/unit/web/health-routes.test.ts
git commit -m "feat(cloud): expose liveness and readiness endpoints"
```

---

### Task 4: Fail-Closed GitHub Webhook Persistence

**Files:**
- Modify: `apps/web/app/api/github/webhook/lifecycle-store.js`
- Modify: `apps/web/app/api/github/webhook/lifecycle-store.d.ts`
- Modify: `apps/web/app/api/github/webhook/route.ts`
- Modify: `tests/unit/web/github-webhook-route.test.ts`

**Interfaces:**
- Consumes: `resolveCloudPersistenceConfiguration()` and `CloudRuntimeConfigurationError` from Task 1.
- Preserves: `getGitHubAppLifecycleStore(): GitHubAppLifecycleStore` and test reset function.
- Produces: webhook HTTP 503 `{ ok: false, error: "cloud persistence is not configured", code: <configuration code> }` when store creation fails due to configuration.
- Produces: explicit test-memory mode retaining existing no-op store behavior only for route unit tests.

- [ ] **Step 1: Change webhook tests first**

Modify environment tracking to include `BOARDREADYOPS_PERSISTENCE_MODE`. Change the lifecycle execution test and invalid runner-mode test to set:

```ts
process.env.NODE_ENV = "test";
process.env.BOARDREADYOPS_PERSISTENCE_MODE = "memory";
```

Add this failing test:

```ts
it("fails closed when PostgreSQL persistence is not configured", async () => {
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;

  const response = await POST(signedGitHubRequest("installation", installationPayload()));

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "cloud persistence is not configured",
    code: "missing-database-url",
  });
});
```

Keep the unsupported-event test without persistence configuration because unsupported events are acknowledged before store creation.

- [ ] **Step 2: Run webhook tests and verify RED**

```bash
corepack pnpm vitest run tests/unit/web/github-webhook-route.test.ts
```

Expected: FAIL because accepted lifecycle events still create an implicit no-op store.

- [ ] **Step 3: Replace implicit no-op selection**

Update `apps/web/app/api/github/webhook/lifecycle-store.js`:

```js
import { createNoopGitHubAppLifecycleStore } from "@boardreadyops/cloud-core/lifecycle-executor";
import { createSqlGitHubAppLifecycleStore } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

let cachedStore;

export function getGitHubAppLifecycleStore() {
  if (cachedStore) return cachedStore;

  const configuration = resolveCloudPersistenceConfiguration();
  if (configuration.mode === "memory") {
    cachedStore = createNoopGitHubAppLifecycleStore();
    return cachedStore;
  }

  cachedStore = createSqlGitHubAppLifecycleStore(
    createPgQueryExecutor({
      connectionString: configuration.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    }),
  );
  return cachedStore;
}

export function resetGitHubAppLifecycleStoreForTests() {
  cachedStore = undefined;
}
```

Update `apps/web/app/api/github/webhook/lifecycle-store.d.ts`:

```ts
import type { GitHubAppLifecycleStore } from "@boardreadyops/cloud-core/lifecycle-executor";
export { CloudRuntimeConfigurationError } from "../../../../lib/cloud-runtime-config.js";

export declare function getGitHubAppLifecycleStore(): GitHubAppLifecycleStore;
export declare function resetGitHubAppLifecycleStoreForTests(): void;
```

Update `apps/web/app/api/github/webhook/route.ts` to import `CloudRuntimeConfigurationError` directly from `../../../../lib/cloud-runtime-config.js`, wrap `getGitHubAppLifecycleStore()` in a `try/catch`, and return:

```ts
if (error instanceof CloudRuntimeConfigurationError) {
  return Response.json(
    {
      ok: false,
      error: "cloud persistence is not configured",
      code: error.code,
    },
    { status: 503 },
  );
}
throw error;
```

- [ ] **Step 4: Run focused cloud tests and typecheck**

```bash
corepack pnpm vitest run \
  tests/unit/web/cloud-runtime-config.test.ts \
  tests/unit/web/cloud-readiness.test.ts \
  tests/unit/web/health-routes.test.ts \
  tests/unit/web/github-webhook-route.test.ts
corepack pnpm run cloud:typecheck
```

Expected: all focused tests and typechecks PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add \
  apps/web/app/api/github/webhook/lifecycle-store.js \
  apps/web/app/api/github/webhook/lifecycle-store.d.ts \
  apps/web/app/api/github/webhook/route.ts \
  tests/unit/web/github-webhook-route.test.ts
git commit -m "fix(cloud): fail closed without persistence"
```

---

### Task 5: Final Verification and Documentation Alignment

**Files:**
- Modify only if required by verification: `apps/web/Dockerfile`, `deploy/docker-compose.yml`, or documentation references.
- Verify: all files changed in Tasks 1-4.

**Interfaces:**
- No new interface; this task proves the increment is internally consistent and does not introduce unrelated deployment mutations.

- [ ] **Step 1: Run formatting and lint checks for changed files**

```bash
corepack pnpm biome check \
  apps/web/lib/cloud-runtime-config.ts \
  apps/web/lib/cloud-readiness.ts \
  apps/web/app/api/health/route.ts \
  apps/web/app/api/health/live/route.ts \
  apps/web/app/api/health/ready/route.ts \
  apps/web/app/api/github/webhook/route.ts \
  tests/unit/web/cloud-runtime-config.test.ts \
  tests/unit/web/cloud-readiness.test.ts \
  tests/unit/web/health-routes.test.ts \
  tests/unit/web/github-webhook-route.test.ts
```

Expected: PASS with no diagnostics.

- [ ] **Step 2: Run all web unit tests**

```bash
corepack pnpm vitest run tests/unit/web
```

Expected: PASS.

- [ ] **Step 3: Run cloud typecheck and build**

```bash
corepack pnpm run cloud:typecheck
corepack pnpm run cloud:build
```

Expected: PASS. The Next.js build includes `/api/health`, `/api/health/live`, and `/api/health/ready`.

- [ ] **Step 4: Review diff and confirm scope**

```bash
git diff main...HEAD --stat
git diff --check
git status --short
```

Expected: no whitespace errors; only the design, plan, configuration/readiness modules, health routes, webhook persistence changes, and tests are present.

- [ ] **Step 5: Commit any verification-only adjustments**

Only when Step 1-4 required a correction:

```bash
git add <corrected-files>
git commit -m "chore(cloud): align foundation verification"
```

If no correction was required, do not create an empty commit.
