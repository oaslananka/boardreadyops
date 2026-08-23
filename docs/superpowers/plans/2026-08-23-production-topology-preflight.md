# Production Topology Preflight Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect the exact Compose/direct-Docker ownership drift that caused the production worker/Caddy name conflicts before any future BoardReadyOps rollout begins, without granting the exec-agent generic Docker or root execution.

**Architecture:** Extend the existing root-owned, typed maintenance boundary with a read-only `topology-preflight` operation backed by a fixed shell helper. The helper inspects only aggregate Docker name/label/state metadata for the `boardreadyops-cloud` project, fails on unmanaged/mislabelled conflicting containers, and never returns environment values or secrets. Deployment remains a separate privileged/operator action; this task adds a mandatory preflight contract and documentation rather than inventing a new deployment engine inside the UI PR.

**Tech Stack:** Bash, Python 3 maintenance broker, Docker CLI read-only inspect/ps commands, Vitest contract tests.

**Spec:** `docs/superpowers/specs/2026-08-23-premium-ui-docs-design.md` section 18.

## Global Constraints

- Do not add `exec-agent` to the Docker group.
- Do not add sudoers/NOPASSWD rules.
- Do not expose arbitrary command/path/environment fields through the maintenance socket.
- The new operation is read-only and fixed-argv only.
- Do not print Docker environment values, runtime env files, database URLs, GitHub credentials, or private keys.
- Do not stop, rename, remove, restart, or recreate any container in the preflight helper.
- Keep this change in its own focused PR, separate from premium UI/docs implementation.

---

## File structure

- `deploy/maintenance/topology-preflight.sh` — fixed read-only topology validator.
- `deploy/maintenance/server.py` — add exactly one typed `topology-preflight` operation.
- `deploy/maintenance/client.py` — allow the fixed operation name only.
- `deploy/maintenance/install.sh` — install the helper alongside existing maintenance assets.
- `tests/unit/scripts/production-maintenance.test.ts` — operation and secret-boundary contract tests.
- `docs/deployment/self-hosted.md` — require preflight before a production rollout.

### Task 1: Define the read-only maintenance operation contract

**Files:**
- Modify: `deploy/maintenance/server.py`
- Modify: `deploy/maintenance/client.py`
- Modify: `tests/unit/scripts/production-maintenance.test.ts`

**Interfaces:**
- Consumes: existing versioned JSON request `{ "version": 1, "operation": string }`.
- Produces: new fixed operation name `topology-preflight`; no user-supplied command/path/env arguments.

- [ ] **Step 1: Write the failing server contract test**

Change the first maintenance contract test to assert three operations:

```py
assert module.parse_request(b'{"version":1,"operation":"runtime-status"}\n') == "runtime-status"
assert module.parse_request(b'{"version":1,"operation":"backup-restore-verify"}\n') == "backup-restore-verify"
assert module.parse_request(b'{"version":1,"operation":"topology-preflight"}\n') == "topology-preflight"
assert module.command_for_operation("topology-preflight", "/srv/boardreadyops") == [
    "/opt/boardreadyops-maintenance/topology-preflight.sh", "--deployment-dir", "/srv/boardreadyops"
]
```

Keep the rejection assertions for arbitrary `command`, `path`, and `env` fields.

- [ ] **Step 2: Run the maintenance test and verify RED**

```bash
corepack pnpm exec vitest run tests/unit/scripts/production-maintenance.test.ts
```

Expected: FAIL because `topology-preflight` is not an allowed operation.

- [ ] **Step 3: Add only the fixed operation mapping**

In `server.py`:

```py
OPERATIONS = frozenset({"runtime-status", "backup-restore-verify", "topology-preflight"})
```

In `command_for_operation`:

```py
elif operation == "topology-preflight":
    helper = f"{INSTALL_ROOT}/topology-preflight.sh"
```

Use a 30-second timeout for `topology-preflight`, same as `runtime-status`.

In `client.py`, extend only the fixed operation choices; do not add generic argv fields.

- [ ] **Step 4: Re-run the contract test**

```bash
corepack pnpm exec vitest run tests/unit/scripts/production-maintenance.test.ts
```

Expected: mapping assertions PASS; later helper/install assertions remain to be added.

### Task 2: Implement exact Compose ownership drift detection

**Files:**
- Create: `deploy/maintenance/topology-preflight.sh`
- Modify: `tests/unit/scripts/production-maintenance.test.ts`

**Interfaces:**
- Output: one JSON document containing only project/service/name/state/health/ownership booleans and `ready`.
- Exit 0 only when topology is safe; exit 3 when unavailable/drifted; exit 2 for invalid invocation.

- [ ] **Step 1: Add failing static security/behavior assertions**

Add to `production-maintenance.test.ts`:

```ts
const topologyPreflightPath = `${root}/topology-preflight.sh`;

it("detects unmanaged or mislabelled production container names without mutating Docker", () => {
  const script = read(topologyPreflightPath);
  expect(script).toContain('readonly project="boardreadyops-cloud"');
  expect(script).toContain('com.docker.compose.project');
  expect(script).toContain('com.docker.compose.service');
  expect(script).toContain('boardreadyops-cloud-worker-1');
  expect(script).toContain('boardreadyops-cloud-caddy-1');
  expect(script).toContain('boardreadyops_production_topology_preflight');
  expect(script).not.toMatch(/docker\s+(rm|stop|start|restart|rename|update|run|compose\s+up)\b/u);
  expect(script).not.toMatch(/Env|runtime\.env|POSTGRES_PASSWORD|DATABASE_URL|GITHUB_APP|PRIVATE_KEY/u);
});
```

- [ ] **Step 2: Verify RED because the helper does not exist**

```bash
corepack pnpm exec vitest run tests/unit/scripts/production-maintenance.test.ts
```

Expected: FAIL reading `topology-preflight.sh`.

- [ ] **Step 3: Create the read-only helper**

Create `deploy/maintenance/topology-preflight.sh` with this contract:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

readonly project="boardreadyops-cloud"
readonly services=(postgres redis web worker caddy)

fail() {
  local message="$1"
  local exit_code="${2:-3}"
  printf '%s\n' "$message" >&2
  exit "$exit_code"
}

[[ "$#" -eq 2 && "$1" = "--deployment-dir" ]] || fail "deployment scope is required" 2
deployment_dir="$2"
[[ "$deployment_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "deployment scope is invalid" 2
repo_dir="${deployment_dir}/repo"
[[ -d "$repo_dir" && ! -L "$repo_dir" ]] || fail "BoardReadyOps deployment is unavailable"

records=()
ready=true
for service in "${services[@]}"; do
  expected_name="${project}-${service}-1"
  id="$(/usr/bin/docker ps -a --filter "name=^/${expected_name}$" --format '{{ .ID }}' | head -n 1)"
  if [[ -z "$id" ]]; then
    records+=("${service}|${expected_name}|missing|missing|false")
    ready=false
    continue
  fi
  compose_project="$(/usr/bin/docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$id" 2>/dev/null || true)"
  compose_service="$(/usr/bin/docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$id" 2>/dev/null || true)"
  state="$(/usr/bin/docker inspect --format '{{ .State.Status }}' "$id" 2>/dev/null || true)"
  health="$(/usr/bin/docker inspect --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' "$id" 2>/dev/null || true)"
  owned=false
  [[ "$compose_project" = "$project" && "$compose_service" = "$service" ]] && owned=true
  [[ "$owned" = true ]] || ready=false
  records+=("${service}|${expected_name}|${state}|${health}|${owned}")
done
```

Before emitting JSON, also inspect all containers matching the exact prefix `boardreadyops-cloud-` and set `ready=false` if any running container under that prefix lacks `com.docker.compose.project=boardreadyops-cloud`. Do not read `.Config.Env`.

Emit bounded JSON with Python in the same style as `runtime-status.sh`:

```json
{"event":"boardreadyops_production_topology_preflight","ready":true,"services":[{"service":"postgres","name":"boardreadyops-cloud-postgres-1","state":"running","health":"healthy","owned":true},{"service":"redis","name":"boardreadyops-cloud-redis-1","state":"running","health":"healthy","owned":true},{"service":"web","name":"boardreadyops-cloud-web-1","state":"running","health":"healthy","owned":true},{"service":"worker","name":"boardreadyops-cloud-worker-1","state":"running","health":"healthy","owned":true},{"service":"caddy","name":"boardreadyops-cloud-caddy-1","state":"running","health":"none","owned":true}]}
```

Exit 3 after printing the JSON when `ready=false`; exit 0 when true.

- [ ] **Step 4: Shell syntax-check and run unit contract tests**

```bash
bash -n deploy/maintenance/topology-preflight.sh
corepack pnpm exec vitest run tests/unit/scripts/production-maintenance.test.ts
```

Expected: PASS.

### Task 3: Install the helper through the existing hardened boundary

**Files:**
- Modify: `deploy/maintenance/install.sh`
- Modify: `tests/unit/scripts/production-maintenance.test.ts`

**Interfaces:**
- Existing service identity, socket permissions, `NoNewPrivileges`, `ProtectSystem`, and `ProtectHome` behavior remain unchanged.

- [ ] **Step 1: Add failing installer assertions**

Add:

```ts
expect(installer).toContain("topology-preflight.sh");
expect(installer).toContain('install -o root -g root -m 0755 "$SCRIPT_DIR/topology-preflight.sh"');
```

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm exec vitest run tests/unit/scripts/production-maintenance.test.ts
```

Expected: FAIL because installer does not copy the helper.

- [ ] **Step 3: Add the helper to the fixed asset list and installation commands**

Update `install.sh` so the asset validation loop includes `topology-preflight.sh`, then install it as root-owned mode 0755 into `/opt/boardreadyops-maintenance/topology-preflight.sh`.

Do not modify socket mode, service permissions, user/group, or Docker group membership.

- [ ] **Step 4: Re-run tests**

```bash
corepack pnpm exec vitest run tests/unit/scripts/production-maintenance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the code hardening**

```bash
git add deploy/maintenance/topology-preflight.sh deploy/maintenance/server.py deploy/maintenance/client.py deploy/maintenance/install.sh tests/unit/scripts/production-maintenance.test.ts
git commit -m "fix(cloud): detect production topology drift before rollout"
```

### Task 4: Document and verify the required rollout preflight

**Files:**
- Modify: `docs/deployment/self-hosted.md`
- Modify: `tests/unit/docs/control-plane-operations-docs.test.ts`

**Interfaces:**
- Operators get one stable command through the maintenance client; deployment behavior itself is unchanged.

- [ ] **Step 1: Write the failing docs contract assertion**

Add to the existing deployment/operations docs test:

```ts
expect(documentation).toContain("topology-preflight");
expect(documentation).toContain("unmanaged or mislabelled container");
expect(documentation).toContain("must pass before a production rollout");
```

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm exec vitest run tests/unit/docs/control-plane-operations-docs.test.ts
```

Expected: FAIL because the preflight is not documented.

- [ ] **Step 3: Add the operational contract to `self-hosted.md`**

Immediately before repeatable production deploy instructions, document:

```text
Run the maintenance `topology-preflight` operation before any rollout. It is read-only and must report ready=true. If it reports an unmanaged or mislabelled container, stop: do not run the deployment or attempt rollback until container ownership is reconciled. The preflight never repairs containers automatically.
```

Include the supported maintenance-client invocation used by the installed tool; do not document direct Docker mutation as the normal repair path.

- [ ] **Step 4: Run focused and repository verification**

```bash
corepack pnpm exec vitest run tests/unit/scripts/production-maintenance.test.ts tests/unit/docs/control-plane-operations-docs.test.ts
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run gc
```

Expected: all exit 0.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/deployment/self-hosted.md tests/unit/docs/control-plane-operations-docs.test.ts
git commit -m "docs(cloud): require production topology preflight"
```

### Task 5: Separate PR and production installation verification

**Files:**
- No further source changes unless CI/review identifies a defect.

- [ ] **Step 1: Open a dedicated hardening PR**

Do not mix it with the premium UI/docs PR. Explain the observed failure mode factually: expected Compose names existed with missing/wrong Compose ownership labels, causing create and rollback name conflicts.

- [ ] **Step 2: Require all CI/security checks**

In particular require unit tests, lint, typecheck, docs-build, security gate, ShellCheck/pre-commit, SonarCloud, CodeQL, and Semgrep.

- [ ] **Step 3: Merge only after review and post-merge checks**

No branch-protection bypass.

- [ ] **Step 4: Install the updated maintenance boundary with the repository installer**

Use the exact merged production checkout and existing root installer. This is a privileged production change; verify the frozen deployment directory before applying it.

- [ ] **Step 5: Verify the read-only operation against the normalized production stack**

Expected result:

```json
{"event":"boardreadyops_production_topology_preflight","ready":true,"services":[{"service":"postgres","name":"boardreadyops-cloud-postgres-1","state":"running","health":"healthy","owned":true},{"service":"redis","name":"boardreadyops-cloud-redis-1","state":"running","health":"healthy","owned":true},{"service":"web","name":"boardreadyops-cloud-web-1","state":"running","health":"healthy","owned":true},{"service":"worker","name":"boardreadyops-cloud-worker-1","state":"running","health":"healthy","owned":true},{"service":"caddy","name":"boardreadyops-cloud-caddy-1","state":"running","health":"none","owned":true}]}
```

Also verify `runtime-status` remains `ready=true` and public health is unchanged.

- [ ] **Step 6: Do not delete retained rollback containers/images as part of this hardening task**

Retention cleanup is a separate operator decision after rollback windows expire.
