export type EvidenceGraphNodeKind =
  | "approval"
  | "evidence"
  | "policy"
  | "production_batch"
  | "release"
  | "review"
  | "source"
  | "waiver";

export type EvidenceGraphRelationship =
  | "approved_by"
  | "derived_from"
  | "governed_by"
  | "produced"
  | "reviewed_in"
  | "supported_by"
  | "waived_by";

export type EvidenceGraphValue = boolean | number | string | null;

export type EvidenceGraphNode = {
  id: string;
  kind: EvidenceGraphNodeKind;
  label: string;
  occurredAt?: string | undefined;
  integrity?: {
    sha256?: string | undefined;
    evidenceDigest?: string | undefined;
  };
  attributes?: Readonly<Record<string, EvidenceGraphValue>> | undefined;
};

export type EvidenceGraphEdge = {
  from: string;
  to: string;
  relationship: EvidenceGraphRelationship;
};

export type MissingEvidenceRelationship = {
  from: string;
  relationship: EvidenceGraphRelationship;
  expectedKind: EvidenceGraphNodeKind;
  reason: string;
};

export type ReleaseEvidenceGraph = {
  version: 1;
  rootReleaseId: string;
  nodes: readonly EvidenceGraphNode[];
  edges: readonly EvidenceGraphEdge[];
  missing: readonly MissingEvidenceRelationship[];
};

export type ReleaseEvidenceGraphInput = {
  release: {
    id: string;
    repositoryId: string;
    repository: string;
    commitSha: string;
    ref?: string | undefined;
    decision?: string | undefined;
    completedAt?: string | undefined;
  };
  evidence?: readonly {
    id: string;
    kind: string;
    name: string;
    sha256: string;
    uploadedAt?: string | undefined;
  }[];
  review?:
    | {
        id: string;
        evidenceDigest?: string | undefined;
        policy?:
          | {
              id: string;
              label: string;
              source?: string | undefined;
              version?: number | undefined;
            }
          | undefined;
        approvals?:
          | readonly {
              id: string;
              approverId: string;
              status: string;
              occurredAt: string;
              evidenceDigest?: string | undefined;
            }[]
          | undefined;
        waivers?:
          | readonly {
              id: string;
              owner: string;
              disposition: string;
              occurredAt: string;
              evidenceDigest?: string | undefined;
            }[]
          | undefined;
      }
    | undefined;
  productionBatches?: readonly {
    id: string;
    externalBatchId: string;
    manufacturer: string;
    manufacturedOn: string;
    sourceSha256: string;
    importedAt?: string | undefined;
  }[];
};

export type ReleaseEvidenceTrace = {
  backward: readonly EvidenceGraphNode[];
  forward: readonly EvidenceGraphNode[];
  missing: readonly MissingEvidenceRelationship[];
};

function stableNodeId(kind: EvidenceGraphNodeKind, identity: string): string {
  return `${kind}:${identity}`;
}

function addEdge(edges: EvidenceGraphEdge[], from: string, to: string, relationship: EvidenceGraphRelationship): void {
  edges.push({ from, to, relationship });
}

export function buildReleaseEvidenceGraph(input: ReleaseEvidenceGraphInput): ReleaseEvidenceGraph {
  const nodes: EvidenceGraphNode[] = [];
  const edges: EvidenceGraphEdge[] = [];
  const missing: MissingEvidenceRelationship[] = [];

  const releaseId = stableNodeId("release", input.release.id);
  const sourceId = stableNodeId("source", `${input.release.repositoryId}:${input.release.commitSha}`);

  nodes.push(
    {
      id: releaseId,
      kind: "release",
      label: input.release.id,
      ...(input.release.completedAt ? { occurredAt: input.release.completedAt } : {}),
      attributes: {
        repository: input.release.repository,
        commitSha: input.release.commitSha,
        ...(input.release.ref ? { ref: input.release.ref } : {}),
        ...(input.release.decision ? { decision: input.release.decision } : {}),
      },
    },
    {
      id: sourceId,
      kind: "source",
      label: input.release.commitSha,
      attributes: {
        repository: input.release.repository,
        commitSha: input.release.commitSha,
        ...(input.release.ref ? { ref: input.release.ref } : {}),
      },
    },
  );
  addEdge(edges, releaseId, sourceId, "derived_from");

  const evidence = input.evidence ?? [];
  if (evidence.length === 0) {
    missing.push({
      from: releaseId,
      relationship: "supported_by",
      expectedKind: "evidence",
      reason: "No release evidence artifacts are linked to this run.",
    });
  } else {
    for (const item of evidence) {
      const nodeId = stableNodeId("evidence", item.id);
      nodes.push({
        id: nodeId,
        kind: "evidence",
        label: item.name,
        ...(item.uploadedAt ? { occurredAt: item.uploadedAt } : {}),
        integrity: { sha256: item.sha256 },
        attributes: { kind: item.kind },
      });
      addEdge(edges, releaseId, nodeId, "supported_by");
    }
  }

  if (!input.review) {
    missing.push({
      from: releaseId,
      relationship: "reviewed_in",
      expectedKind: "review",
      reason: "No linked review context is available for this release.",
    });
  } else {
    const reviewId = stableNodeId("review", input.review.id);
    nodes.push({
      id: reviewId,
      kind: "review",
      label: input.review.id,
      ...(input.review.evidenceDigest ? { integrity: { evidenceDigest: input.review.evidenceDigest } } : {}),
    });
    addEdge(edges, releaseId, reviewId, "reviewed_in");

    if (input.review.policy) {
      const policyId = stableNodeId("policy", input.review.policy.id);
      nodes.push({
        id: policyId,
        kind: "policy",
        label: input.review.policy.label,
        attributes: {
          ...(input.review.policy.source ? { source: input.review.policy.source } : {}),
          ...(input.review.policy.version === undefined ? {} : { version: input.review.policy.version }),
        },
      });
      addEdge(edges, reviewId, policyId, "governed_by");
    } else {
      missing.push({
        from: reviewId,
        relationship: "governed_by",
        expectedKind: "policy",
        reason: "The run dashboard has no persisted policy context for this review.",
      });
    }

    if (input.review.approvals === undefined) {
      missing.push({
        from: reviewId,
        relationship: "approved_by",
        expectedKind: "approval",
        reason: "Approval evidence was not loaded for this investigation.",
      });
    } else {
      for (const approval of input.review.approvals) {
        const approvalId = stableNodeId("approval", approval.id);
        nodes.push({
          id: approvalId,
          kind: "approval",
          label: `${approval.status} · ${approval.approverId}`,
          occurredAt: approval.occurredAt,
          ...(approval.evidenceDigest ? { integrity: { evidenceDigest: approval.evidenceDigest } } : {}),
          attributes: { approverId: approval.approverId, status: approval.status },
        });
        addEdge(edges, reviewId, approvalId, "approved_by");
      }
    }

    if (input.review.waivers === undefined) {
      missing.push({
        from: reviewId,
        relationship: "waived_by",
        expectedKind: "waiver",
        reason: "Waiver/decision history was not loaded for this investigation.",
      });
    } else {
      for (const waiver of input.review.waivers) {
        const waiverId = stableNodeId("waiver", waiver.id);
        nodes.push({
          id: waiverId,
          kind: "waiver",
          label: `${waiver.disposition} · ${waiver.owner}`,
          occurredAt: waiver.occurredAt,
          ...(waiver.evidenceDigest ? { integrity: { evidenceDigest: waiver.evidenceDigest } } : {}),
          attributes: { owner: waiver.owner, disposition: waiver.disposition },
        });
        addEdge(edges, reviewId, waiverId, "waived_by");
      }
    }
  }

  const productionBatches = input.productionBatches ?? [];
  if (productionBatches.length === 0) {
    missing.push({
      from: releaseId,
      relationship: "produced",
      expectedKind: "production_batch",
      reason: "No production outcomes are linked to this release yet.",
    });
  } else {
    for (const batch of productionBatches) {
      const batchId = stableNodeId("production_batch", batch.id);
      nodes.push({
        id: batchId,
        kind: "production_batch",
        label: `${batch.manufacturer} · ${batch.externalBatchId}`,
        occurredAt: batch.importedAt ?? batch.manufacturedOn,
        integrity: { sha256: batch.sourceSha256 },
        attributes: {
          externalBatchId: batch.externalBatchId,
          manufacturer: batch.manufacturer,
          manufacturedOn: batch.manufacturedOn,
        },
      });
      addEdge(edges, releaseId, batchId, "produced");
    }
  }

  return { version: 1, rootReleaseId: releaseId, nodes, edges, missing };
}

export function traceReleaseEvidence(graph: ReleaseEvidenceGraph): ReleaseEvidenceTrace {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const backwardRelationships = new Set<EvidenceGraphRelationship>([
    "approved_by",
    "derived_from",
    "governed_by",
    "reviewed_in",
    "supported_by",
    "waived_by",
  ]);

  const backwardIds = new Set<string>();
  const pending = [graph.rootReleaseId];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;

    for (const edge of graph.edges) {
      if (edge.from !== current || !backwardRelationships.has(edge.relationship)) continue;
      if (backwardIds.has(edge.to)) continue;
      backwardIds.add(edge.to);
      pending.push(edge.to);
    }
  }

  const forwardIds = new Set(
    graph.edges
      .filter((edge) => edge.from === graph.rootReleaseId && edge.relationship === "produced")
      .map((edge) => edge.to),
  );

  return {
    backward: [...backwardIds].flatMap((id) => {
      const node = nodesById.get(id);
      return node ? [node] : [];
    }),
    forward: [...forwardIds].flatMap((id) => {
      const node = nodesById.get(id);
      return node ? [node] : [];
    }),
    missing: graph.missing,
  };
}
