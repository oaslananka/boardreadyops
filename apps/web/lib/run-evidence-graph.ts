import {
  buildReleaseEvidenceGraph,
  type ReleaseEvidenceGraph,
  type ReleaseEvidenceTrace,
  traceReleaseEvidence,
} from "@boardreadyops/cloud-core/evidence-graph";
import type { RunDetail } from "./run-dashboard.js";

export type RunEvidenceGraphInvestigation = {
  graph: ReleaseEvidenceGraph;
  trace: ReleaseEvidenceTrace;
};

export type RunEvidenceGraphInput = Pick<
  RunDetail,
  | "artifacts"
  | "commitSha"
  | "completedAt"
  | "decision"
  | "id"
  | "productionBatches"
  | "ref"
  | "repository"
  | "repositoryId"
  | "reviewId"
  | "setupPreset"
  | "setupPresetVersion"
  | "setupRevision"
>;

function setupPolicy(run: RunEvidenceGraphInput) {
  if (!run.setupPreset) return undefined;
  const version = run.setupPresetVersion;
  const revision = run.setupRevision;
  return {
    id: [
      run.setupPreset,
      version === undefined ? undefined : `v${version}`,
      revision === undefined ? undefined : `r${revision}`,
    ]
      .filter(Boolean)
      .join(":"),
    label: [
      run.setupPreset,
      version === undefined ? undefined : `v${version}`,
      revision === undefined ? undefined : `revision ${revision}`,
    ]
      .filter(Boolean)
      .join(" · "),
    source: "repository setup",
    ...(version === undefined ? {} : { version }),
  };
}

/**
 * Adapts the existing run investigation read model into the storage-neutral Evidence Graph.
 *
 * The run dashboard deliberately does not load review approval/waiver history today, so those
 * relationships remain `missing` rather than being inferred from the release decision. This is
 * the important boundary for #451: absence of loaded evidence is represented explicitly instead
 * of silently becoming proof that no approval or waiver existed.
 */
export function buildRunEvidenceGraph(run: RunEvidenceGraphInput): RunEvidenceGraphInvestigation {
  const policy = setupPolicy(run);
  const graph = buildReleaseEvidenceGraph({
    release: {
      id: run.id,
      repositoryId: run.repositoryId,
      repository: run.repository,
      commitSha: run.commitSha,
      ref: run.ref,
      ...(run.decision ? { decision: run.decision } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    },
    evidence: run.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      name: artifact.name,
      sha256: artifact.sha256,
      uploadedAt: artifact.uploadedAt,
    })),
    ...(run.reviewId
      ? {
          review: {
            id: run.reviewId,
            ...(policy ? { policy } : {}),
          },
        }
      : {}),
    productionBatches: run.productionBatches.map((batch) => ({
      id: batch.id,
      externalBatchId: batch.externalBatchId,
      manufacturer: batch.manufacturer,
      manufacturedOn: batch.manufacturedOn,
      sourceSha256: batch.sourceSha256,
      importedAt: batch.importedAt,
    })),
  });

  return { graph, trace: traceReleaseEvidence(graph) };
}
