import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assessHistoricalUserWorkspaceCandidates } from "../../packages/db/src/data-export-historical-workspace-candidates.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const suite = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString }) : null;
const tenant = ["workspace-original-", randomUUID().slice(0, 10)].join("");
const foreignTenant = ["workspace-foreign-", randomUUID().slice(0, 10)].join("");
const oldLogin = ["workspace-previous-", randomUUID().slice(0, 10)].join("");
const originalNumeric = 8_099_887_765;
const foreignNumeric = originalNumeric + 1;
const exportId = randomUUID();
const installationId = randomUUID();
const competingInstallationId = randomUUID();
const numericWorkspace = randomUUID();
const legacyWorkspace = randomUUID();
const foreignWorkspace = randomUUID();
const projectId = randomUUID();
const foreignProjectId = randomUUID();
const membershipId = randomUUID();
const policyId = randomUUID();
const memberAuditIds = [randomUUID(), randomUUID()];
const policyAuditIds = [randomUUID(), randomUUID()];
const authority = { exportId, verifiedGitHubUserId: originalNumeric };
const gitInstallation = () => Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);

suite("disposable PostgreSQL original USER: no-FK collaboration ownership ambiguity", () => {
  afterAll(async () => {
    // Both audit tables are intentionally append-only. Do not weaken triggers
    // or mutate their history in teardown; these tests require a disposable
    // PostgreSQL instance which is destroyed after the suite.
    if (db) await db.close();
  });

  it("separates numeric grants, legacy usernames, shared projects and actor/subject audit references", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [installationId, gitInstallation(), tenant, originalNumeric],
    );
    await db.query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
       VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)`,
      [exportId, tenant, originalNumeric],
    );
    await db.query(
      `INSERT INTO workspaces(id,name,slug) VALUES
       ($1,'Synthetic original collaboration',$1),
       ($2,'Synthetic legacy reused login',$2),
       ($3,'Synthetic unrelated foreign workspace',$3)`,
      [numericWorkspace, legacyWorkspace, foreignWorkspace],
    );
    await db.query(
      `INSERT INTO workspace_members(workspace_id,user_id,github_user_id,github_login,role)
       VALUES($1,$2,$3,$2,'owner'),
             ($4,$5,NULL,$5,'owner'),
             ($6,$7,$8,$7,'owner')`,
      [
        numericWorkspace,
        oldLogin,
        originalNumeric,
        legacyWorkspace,
        tenant,
        foreignWorkspace,
        foreignTenant,
        foreignNumeric,
      ],
    );
    await db.query(
      `INSERT INTO projects(id,workspace_id,name) VALUES
       ($1,$2,'Synthetic original workspace project'),
       ($3,$4,'Synthetic foreign workspace project')`,
      [projectId, numericWorkspace, foreignProjectId, foreignWorkspace],
    );
    await db.query(
      `INSERT INTO workspace_memberships(id,tenant_id,user_id,role)
       VALUES($1,$2,$3,'owner')`,
      [membershipId, tenant, oldLogin],
    );
    await db.query(
      `INSERT INTO review_policies(id,tenant_id,scope,scope_id,name)
       VALUES($1,$2,'organization',$2,'Private review policy')`,
      [policyId, tenant],
    );
    await db.query(
      `INSERT INTO workspace_member_audit_events(
         id,workspace_id,event_type,actor_github_user_id,actor_login,
         subject_github_user_id,subject_login,role
       ) VALUES($1,$2,'workspace_member.upsert',$3,$4,$3,$4,'owner'),
               ($5,$2,'workspace_member.upsert',$6,$7,$3,$4,'member')`,
      [
        memberAuditIds[0],
        numericWorkspace,
        originalNumeric,
        oldLogin,
        memberAuditIds[1],
        foreignNumeric,
        foreignTenant,
      ],
    );
    await db.query(
      `INSERT INTO review_policy_audit_events(
         id,tenant_id,policy_id,action,scope,scope_id,actor_github_user_id,actor_login,after_policy
       ) VALUES($1,$2,$3,'create','organization',$2,$4,$5,'{}'::jsonb),
               ($6,$2,$3,'create','organization',$2,$7,$8,'{}'::jsonb)`,
      [
        policyAuditIds[0],
        tenant,
        policyId,
        originalNumeric,
        oldLogin,
        policyAuditIds[1],
        foreignNumeric,
        foreignTenant,
      ],
    );

    expect(await assessHistoricalUserWorkspaceCandidates(db, authority)).toEqual({
      status: "collaboration-candidates-not-customer-ownership",
      releaseDecision: "NO_GO",
      reviewedUnlinkedClasses: 7,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      allWorkspaceMembersConsented: false,
      thirdPartyDisclosureRightsVerified: false,
      orphanedWorkspaceAndAuditRowsUnresolved: true,
      competingOrUnboundInstallationIdentity: false,
      candidateCounts: {
        workspacesWithNumericMember: 1,
        workspacesWithUnboundLoginMember: 1,
        projectsInNumericallyJoinedWorkspaces: 1,
        numericWorkspaceMemberships: 1,
        unboundLoginWorkspaceMemberships: 1,
        auditEventsActedByNumericUser: 1,
        auditEventsAboutNumericUser: 2,
        billingSeatMembershipsWithLogin: 1,
        reviewPoliciesWithLogin: 1,
        policyAuditEventsActedByNumericUser: 1,
        policyAuditEventsWithLoginButOtherNumericActor: 1,
      },
    });

    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [competingInstallationId, gitInstallation(), tenant, foreignNumeric],
    );
    expect(await assessHistoricalUserWorkspaceCandidates(db, authority)).toMatchObject({
      competingOrUnboundInstallationIdentity: true,
      customerDeliveryAllowed: false,
      allWorkspaceMembersConsented: false,
    });
    expect(
      await assessHistoricalUserWorkspaceCandidates(db, {
        exportId,
        verifiedGitHubUserId: foreignNumeric,
      }),
    ).toBeNull();
  });

  it("does not scan private collaboration candidates under an active hold or destructive erasure", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    const holdId = randomUUID();
    const eraseId = randomUUID();
    try {
      await db.query(
        `INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id,active)
         VALUES($1,$2,'synthetic','Original user design rights hold','user',$2,TRUE)`,
        [holdId, tenant],
      );
      expect(await assessHistoricalUserWorkspaceCandidates(db, authority)).toBeNull();
      await db.query("UPDATE legal_holds SET active=FALSE WHERE id=$1", [holdId]);
      await db.query(
        `INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run)
         VALUES($1,$2,'synthetic','user',$2,'running',FALSE)`,
        [eraseId, tenant],
      );
      expect(await assessHistoricalUserWorkspaceCandidates(db, authority)).toBeNull();
      await db.query("UPDATE erasure_requests SET status='preview',dry_run=TRUE WHERE id=$1", [eraseId]);
      expect(await assessHistoricalUserWorkspaceCandidates(db, authority)).toMatchObject({
        originalUserOwnershipVerified: false,
        customerDeliveryAllowed: false,
      });
    } finally {
      await db.query("DELETE FROM erasure_requests WHERE id=$1", [eraseId]);
      await db.query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    }
  });

  it("denies 101+ review policies instead of silently truncating the historical scope", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO review_policies(id,tenant_id,scope,scope_id,name)
       SELECT gen_random_uuid()::text,$1,'organization',$1,'synthetic-overflow-policy'
         FROM generate_series(1,100)`,
      [tenant],
    );
    expect(await assessHistoricalUserWorkspaceCandidates(db, authority)).toBeNull();
  });
});
