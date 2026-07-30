import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type AuditEventExportMetadata = Readonly<Record<string, boolean | number | string>>;

export type AuditEventExportItem = {
  id: string;
  installationId: string;
  eventType: string;
  actorType: string;
  actorId?: string;
  actorLogin?: string;
  subjectType: string;
  subjectId?: string;
  repositoryId?: string;
  repositoryFullName?: string;
  releaseRunId?: string;
  artifactId?: string;
  runnerRegistrationId?: string;
  requestId?: string;
  metadata: AuditEventExportMetadata;
  createdAt: string;
};

export type AuditEventCursor = {
  createdAt: Date;
  id: string;
};

export type AuditLogStore = {
  listAuditEvents(input: {
    installationId: string;
    repositoryId?: string;
    releaseRunId?: string;
    eventType?: string;
    cursor?: AuditEventCursor;
    limit?: number;
  }): Promise<AuditEventExportItem[]>;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const eventTypePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const bearerValuePattern = /\bBearer\s+[^\s]+/iu;
const credentialValuePattern = /\b(?:authorization|cookie|credential|password|private[_-]?key|secret|token)\s*[:=]/iu;
const exportableMetadataKeys = new Set([
  "action",
  "activeWaiverCount",
  "allowedRepositoryCount",
  "artifactCount",
  "blockingCount",
  "attemptStatus",
  "attemptUpdated",
  "bytes",
  "capabilityCount",
  "checkRunId",
  "checkRunUpdated",
  "conclusion",
  "configStatus",
  "configVersion",
  "decision",
  "decisionSummaryVersion",
  "contractVersion",
  "enrollmentId",
  "executionAttemptId",
  "expectedConclusion",
  "expiresAt",
  "fallbackReason",
  "findingCount",
  "expiredWaiverCount",
  "githubCheckConclusion",
  "githubInstallationId",
  "githubRepositoryId",
  "itemType",
  "leaseCompleted",
  "leaseId",
  "lifecycleBindingValid",
  "managedRunnerIdentityId",
  "maximumExpiresAt",
  "metricCount",
  "missingRecommendedCount",
  "missingRequiredCount",
  "nonBlockingCount",
  "observedConclusion",
  "observedStatus",
  "outcome",
  "outcomeCode",
  "progressPercent",
  "preset",
  "presetVersion",
  "probeId",
  "publicFailureReason",
  "pullRequestCommentCreated",
  "reason",
  "readinessReported",
  "readinessScore",
  "readinessStatus",
  "reasonCode",
  "reconciliationId",
  "repaired",
  "reportLinkCount",
  "repositoryPrivate",
  "resultDigest",
  "rotated",
  "routingPolicyMode",
  "routingPolicySource",
  "scope",
  "selfHostedOfflineAfterSeconds",
  "setupRevision",
  "sha256",
  "stage",
  "staleWaiverCount",
  "status",
  "terminalStatus",
  "waiversReported",
  "warningCount",
  "workflowContractVersion",
  "workflowStatus",
  "workerClass",
]);

function validatedIdentifier(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!identifierPattern.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function sanitizedMetadata(value: unknown): AuditEventExportMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const sanitized: Record<string, boolean | number | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!exportableMetadataKeys.has(key)) continue;
    if (typeof entry === "boolean") sanitized[key] = entry;
    if (typeof entry === "number" && Number.isFinite(entry)) sanitized[key] = entry;
    if (
      typeof entry === "string" &&
      entry.length <= 512 &&
      !bearerValuePattern.test(entry) &&
      !credentialValuePattern.test(entry)
    ) {
      sanitized[key] = entry;
    }
  }
  return sanitized;
}

class DatabaseRow {
  constructor(private readonly value: Record<string, unknown>) {}

  requiredText(name: string): string {
    const value = this.value[name];
    if (typeof value !== "string" || value.length === 0) throw new Error(`database row ${name} is invalid`);
    return value;
  }

  optionalText(name: string): string | undefined {
    const value = this.value[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  requiredDateIso(name: string): string {
    const value = this.value[name];
    if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (Number.isFinite(parsed.valueOf())) return parsed.toISOString();
    }
    throw new Error(`database row ${name} is invalid`);
  }

  metadata(): AuditEventExportMetadata {
    return sanitizedMetadata(this.value.metadata);
  }
}

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

export function createSqlAuditLogStore(executor: SqlQueryExecutor): AuditLogStore {
  return {
    async listAuditEvents(input) {
      const installationId = validatedIdentifier("installationId", input.installationId);
      const repositoryId = validatedIdentifier("repositoryId", input.repositoryId);
      const releaseRunId = validatedIdentifier("releaseRunId", input.releaseRunId);
      const eventType = input.eventType;
      if (eventType !== undefined && (eventType.length > 160 || !eventTypePattern.test(eventType))) {
        throw new Error("eventType is invalid");
      }
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit is invalid");
      if (input.cursor) {
        validatedIdentifier("cursor.id", input.cursor.id);
        if (!Number.isFinite(input.cursor.createdAt.valueOf())) throw new Error("cursor.createdAt is invalid");
      }

      const predicates = ["audit.installation_id = $1"];
      const parameters: unknown[] = [installationId];
      const addPredicate = (column: string, value: unknown) => {
        parameters.push(value);
        predicates.push(`${column} = $${parameters.length}`);
      };
      if (repositoryId) addPredicate("audit.repository_id", repositoryId);
      if (releaseRunId) addPredicate("audit.release_run_id", releaseRunId);
      if (eventType) addPredicate("audit.event_type", eventType);
      if (input.cursor) {
        parameters.push(input.cursor.createdAt.toISOString(), input.cursor.id);
        predicates.push(
          `(audit.created_at, audit.id) < ($${parameters.length - 1}::timestamptz, $${parameters.length})`,
        );
      }
      parameters.push(limit);

      const result = await executor.query(
        `select audit.id,
                audit.installation_id,
                audit.event_type,
                audit.actor_type,
                audit.actor_id,
                audit.actor_login,
                audit.subject_type,
                audit.subject_id,
                audit.repository_id,
                case when repository.id is null then null else repository.owner || '/' || repository.name end as repository_full_name,
                audit.release_run_id,
                audit.artifact_id,
                audit.runner_registration_id,
                audit.request_id,
                audit.metadata,
                audit.created_at
           from audit_events as audit
           left join repositories as repository
             on repository.id = audit.repository_id
            and repository.installation_id = audit.installation_id
          where ${predicates.join("\n            and ")}
          order by audit.created_at desc, audit.id desc
          limit $${parameters.length}`,
        parameters,
      );

      return rows(result).map((value) => {
        const row = new DatabaseRow(value);
        const actorId = row.optionalText("actor_id");
        const actorLogin = row.optionalText("actor_login");
        const subjectId = row.optionalText("subject_id");
        const repositoryId = row.optionalText("repository_id");
        const repositoryFullName = row.optionalText("repository_full_name");
        const releaseRunId = row.optionalText("release_run_id");
        const artifactId = row.optionalText("artifact_id");
        const runnerRegistrationId = row.optionalText("runner_registration_id");
        const requestId = row.optionalText("request_id");
        return {
          id: row.requiredText("id"),
          installationId: row.requiredText("installation_id"),
          eventType: row.requiredText("event_type"),
          actorType: row.requiredText("actor_type"),
          ...(actorId ? { actorId } : {}),
          ...(actorLogin ? { actorLogin } : {}),
          subjectType: row.requiredText("subject_type"),
          ...(subjectId ? { subjectId } : {}),
          ...(repositoryId ? { repositoryId } : {}),
          ...(repositoryFullName ? { repositoryFullName } : {}),
          ...(releaseRunId ? { releaseRunId } : {}),
          ...(artifactId ? { artifactId } : {}),
          ...(runnerRegistrationId ? { runnerRegistrationId } : {}),
          ...(requestId ? { requestId } : {}),
          metadata: row.metadata(),
          createdAt: row.requiredDateIso("created_at"),
        } satisfies AuditEventExportItem;
      });
    },
  };
}
