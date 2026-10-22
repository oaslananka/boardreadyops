# Ambiguous runner artifact upload finalization

**Status:** operator-only evidence collection; no automated reconciliation, forced retry, file deletion, or production rollout is authorized by this document. Related: [#1215](https://github.com/oaslananka/boardreadyops/issues/1215), [#1216](https://github.com/oaslananka/boardreadyops/pull/1216), and the [durable unlink contract](../security/artifact-hold-unlink-coordination.md).

## Failure boundary

The upload route first streams validated bytes to a unique temporary file, hard-links the file at its final path, and then calls `boardreadyops_complete_artifact_upload` through PostgreSQL. The database may **commit** the `artifacts` row and mark the capability `uploaded` even if the transport drops its response. HTTP 503 does not prove rollback. Retrying with the consumed capability returns a conflict (`409`), not permission to overwrite or delete the object.

A rejected `completeUpload` call must therefore preserve the linked bytes and avoid `failUpload`: deleting the path can destroy a **durably recorded** artifact. Preserving bytes alone does not solve the reverse case—where the DB really rolled back and a file is unreferenced. Such files remain **unreconciled**, not automatically safe for deletion. This code path does not create a durable incident/quarantine row or implement self-healing.

## Read-only operator examination

1. Record a bounded incident ID and the **artifact ID** from the authenticated request/audit context. Verify the installation, repository, release run, attempt and expected storage driver against authoritative database records. Do not disclose bearer capability tokens, `upload_token_digest`, local absolute paths, artifact content or personal information in tickets/logs.
2. On an authorized, **read-only** PostgreSQL connection, inspect the exact artifact ID (parameter `$1`, not interpolated user text). Example query:

   ```sql
   select c.artifact_id, c.run_id, c.execution_attempt_id,
          c.status as capability_status, c.declared_bytes,
          c.expected_sha256, c.uploaded_at,
          a.id is not null as artifact_recorded,
          a.bytes as recorded_bytes, a.sha256 as recorded_sha256,
          a.run_id = c.run_id as run_matches,
          a.storage_path = c.storage_path as path_matches
   from runner_artifact_upload_capabilities c
   left join artifacts a on a.id = c.artifact_id
   where c.artifact_id = $1;
   ```

   The capability row may have been removed by terminal-record retention. If it is missing, separately inspect the artifact row **and its full tenant/run ownership** before interpreting absence.
3. With separate filesystem authorization and an ownership-verified, canonical path, inspect **metadata only**: regular-file type, symlink boundaries, file size and SHA-256 digest. Compare with the `artifacts` and capability records, not untrusted request path components. No action here requires reading or exporting artifact contents outside the authorized host. The filesystem may have been changed by another actor: a successful check is only a point-in-time observation.
4. Examine the append-only audit, active legal holds, outstanding unlink fences/deletion jobs (when the newer schema is deployed), retention obligations and all worker versions. Do not claim that a legacy unfenced worker obeys the new protocol. Preserve evidence of any mismatch and escalate to the designated storage/security operator.

## Decision matrix (observation only)

| Evidence | Interpretation | Safe immediate action |
| --- | --- | --- |
| `uploaded`, authoritative artifact row, matching ownership, digest and physical file | Completion probably committed despite the lost response | Retain file and metadata; document evidence, do not force replay |
| `uploading` or no artifact row, physical file present | Incomplete or rolled-back completion; potential unreferenced bytes | Quarantine operationally, investigate transaction and audit evidence; **no auto-unlink** |
| `expired`, `failed`, `revoked`, or missing capability, physical file present | Possibly expired or cleaned up after an interrupted attempt | Verify all tenant/run retention and legal-hold evidence; **no auto-unlink** |
| Artifact row exists but physical file is missing or has mismatched bytes/digest | Possible integrity breach or concurrent destructive operation | Escalate, preserve metadata and audit, prevent unsafe publication; do not invent a successful upload |
| Conflicting ownership, path or worker evidence | Unsafe to reconcile | Stop manual changes and escalate; do not delete or reassign |

This is **not** a repair API. Any later manual resolution must have authenticated, auditable owner/security approval and a separately tested recovery procedure that accounts for legal holds and old workers. Never fix an orphan by blindly deleting a path, deleting an `artifacts` row, clearing a fence, or replaying a consumed token. The unrelated #1023 billing and #1080 worker cutovers remain on independent Draft/HOLD gates.
