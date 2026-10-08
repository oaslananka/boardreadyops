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

type GraphBuildState = {
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  missing: MissingEvidenceRelationship[];
};

type ReleaseInput = ReleaseEvidenceGraphInput["release"];
type ReviewInput = NonNullable<ReleaseEvidenceGraphInput["review"]>;
type EvidenceInput = NonNullable<ReleaseEvidenceGraphInput["evidence"]>[number];
type ProductionBatchInput = NonNullable<ReleaseEvidenceGraphInput["productionBatches"]>[number];

function addMissing(
  state: GraphBuildState,
  from: string,
  relationship: EvidenceGraphRelationship,
  expectedKind: EvidenceGraphNodeKind,
  reason: string,
): void {
  state.missing.push({ from, relationship, expectedKind, reason });
}

function releaseIdentityAttributes(release: ReleaseInput): Readonly<Record<string, EvidenceGraphValue>> {
  return {
    repository: release.repository,
    commitSha: release.commitSha,
    ...(release.ref ? { ref: release.ref } : {}),
  };
}

function addReleaseAndSource(state: GraphBuildState, release: ReleaseInput): string {
  const releaseId = stableNodeId("release", release.id);
  const sourceId = stableNodeId("source", `${release.repositoryId}:${release.commitSha}`);
  const identity = releaseIdentityAttributes(release);

  state.nodes.push(
    {
      id: releaseId,
      kind: "release",
      label: release.id,
      ...(release.completedAt ? { occurredAt: release.completedAt } : {}),
      attributes: {
        ...identity,
        ...(release.decision ? { decision: release.decision } : {}),
      },
    },
    {
      id: sourceId,
      kind: "source",
      label: release.commitSha,
      attributes: identity,
    },
  );
  addEdge(state.edges, releaseId, sourceId, "derived_from");
  return releaseId;
}

function addEvidenceNode(state: GraphBuildState, releaseId: string, item: EvidenceInput): void {
  const nodeId = stableNodeId("evidence", item.id);
  state.nodes.push({
    id: nodeId,
    kind: "evidence",
    label: item.name,
    ...(item.uploadedAt ? { occurredAt: item.uploadedAt } : {}),
    integrity: { sha256: item.sha256 },
    attributes: { kind: item.kind },
  });
  addEdge(state.edges, releaseId, nodeId, "supported_by");
}

function addEvidence(state: GraphBuildState, releaseId: string, evidence: readonly EvidenceInput[]): void {
  if (evidence.length === 0) {
    addMissing(state, releaseId, "supported_by", "evidence", "No release evidence artifacts are linked to this run.");
    return;
  }
  for (const item of evidence) addEvidenceNode(state, releaseId, item);
}

function addPolicy(state: GraphBuildState, reviewId: string, review: ReviewInput): void {
  const policy = review.policy;
  if (!policy) {
    addMissing(
      state,
      reviewId,
      "governed_by",
      "policy",
      "The run dashboard has no persisted policy context for this review.",
    );
    return;
  }

  const policyId = stableNodeId("policy", policy.id);
  state.nodes.push({
    id: policyId,
    kind: "policy",
    label: policy.label,
    attributes: {
      ...(policy.source ? { source: policy.source } : {}),
      ...(policy.version === undefined ? {} : { version: policy.version }),
    },
  });
  addEdge(state.edges, reviewId, policyId, "governed_by");
}

function addApprovals(state: GraphBuildState, reviewId: string, review: ReviewInput): void {
  if (review.approvals === undefined) {
    addMissing(state, reviewId, "approved_by", "approval", "Approval evidence was not loaded for this investigation.");
    return;
  }

  for (const approval of review.approvals) {
    const approvalId = stableNodeId("approval", approval.id);
    state.nodes.push({
      id: approvalId,
      kind: "approval",
      label: `${approval.status} · ${approval.approverId}`,
      occurredAt: approval.occurredAt,
      ...(approval.evidenceDigest ? { integrity: { evidenceDigest: approval.evidenceDigest } } : {}),
      attributes: { approverId: approval.approverId, status: approval.status },
    });
    addEdge(state.edges, reviewId, approvalId, "approved_by");
  }
}

function addWaivers(state: GraphBuildState, reviewId: string, review: ReviewInput): void {
  if (review.waivers === undefined) {
    addMissing(
      state,
      reviewId,
      "waived_by",
      "waiver",
      "Waiver/decision history was not loaded for this investigation.",
    );
    return;
  }

  for (const waiver of review.waivers) {
    const waiverId = stableNodeId("waiver", waiver.id);
    state.nodes.push({
      id: waiverId,
      kind: "waiver",
      label: `${waiver.disposition} · ${waiver.owner}`,
      occurredAt: waiver.occurredAt,
      ...(waiver.evidenceDigest ? { integrity: { evidenceDigest: waiver.evidenceDigest } } : {}),
      attributes: { owner: waiver.owner, disposition: waiver.disposition },
    });
    addEdge(state.edges, reviewId, waiverId, "waived_by");
  }
}

function addReview(state: GraphBuildState, releaseId: string, review: ReviewInput | undefined): void {
  if (!review) {
    addMissing(state, releaseId, "reviewed_in", "review", "No linked review context is available for this release.");
    return;
  }

  const reviewId = stableNodeId("review", review.id);
  state.nodes.push({
    id: reviewId,
    kind: "review",
    label: review.id,
    ...(review.evidenceDigest ? { integrity: { evidenceDigest: review.evidenceDigest } } : {}),
  });
  addEdge(state.edges, releaseId, reviewId, "reviewed_in");
  addPolicy(state, reviewId, review);
  addApprovals(state, reviewId, review);
  addWaivers(state, reviewId, review);
}

function addProductionBatch(state: GraphBuildState, releaseId: string, batch: ProductionBatchInput): void {
  const batchId = stableNodeId("production_batch", batch.id);
  state.nodes.push({
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
  addEdge(state.edges, releaseId, batchId, "produced");
}

function addProduction(state: GraphBuildState, releaseId: string, batches: readonly ProductionBatchInput[]): void {
  if (batches.length === 0) {
    addMissing(
      state,
      releaseId,
      "produced",
      "production_batch",
      "No production outcomes are linked to this release yet.",
    );
    return;
  }
  for (const batch of batches) addProductionBatch(state, releaseId, batch);
}

export function buildReleaseEvidenceGraph(input: ReleaseEvidenceGraphInput): ReleaseEvidenceGraph {
  const state: GraphBuildState = { nodes: [], edges: [], missing: [] };
  const releaseId = addReleaseAndSource(state, input.release);

  addEvidence(state, releaseId, input.evidence ?? []);
  addReview(state, releaseId, input.review);
  addProduction(state, releaseId, input.productionBatches ?? []);

  // Node identity is an integrity boundary: duplicated artifact/batch/approval IDs
  // cannot be silently coalesced into whichever record the traversal sees last.
  const nodeIds = new Set<string>();
  for (const node of state.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate evidence graph node identity: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  return {
    version: 1,
    rootReleaseId: releaseId,
    nodes: state.nodes,
    edges: state.edges,
    missing: state.missing,
  };
}

const relationshipKinds: Readonly<
  Record<EvidenceGraphRelationship, readonly [EvidenceGraphNodeKind, EvidenceGraphNodeKind]>
> = {
  approved_by: ["review", "approval"],
  derived_from: ["release", "source"],
  governed_by: ["review", "policy"],
  produced: ["release", "production_batch"],
  reviewed_in: ["release", "review"],
  supported_by: ["release", "evidence"],
  waived_by: ["review", "waiver"],
};

export function traceReleaseEvidence(graph: ReleaseEvidenceGraph): ReleaseEvidenceTrace {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  if (nodesById.size !== graph.nodes.length) {
    throw new Error("Evidence graph contains duplicate node identities.");
  }
  if (!nodesById.has(graph.rootReleaseId)) {
    throw new Error("Evidence graph root release node is missing.");
  }
  if (nodesById.get(graph.rootReleaseId)?.kind !== "release") {
    throw new Error("Evidence graph root does not identify a release node.");
  }
  const edgesBySource = new Map<string, EvidenceGraphEdge[]>();
  for (const edge of graph.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) {
      throw new Error("Evidence graph edge references an unknown node.");
    }
    const kinds = relationshipKinds[edge.relationship];
    if (!kinds || from.kind !== kinds[0] || to.kind !== kinds[1]) {
      throw new Error("Evidence graph edge relationship conflicts with node kinds.");
    }
    const outgoing = edgesBySource.get(edge.from) ?? [];
    outgoing.push(edge);
    edgesBySource.set(edge.from, outgoing);
  }
  for (const missing of graph.missing) {
    const from = nodesById.get(missing.from);
    if (!from) {
      throw new Error("Evidence graph missing-evidence record references an unknown node.");
    }
    const kinds = relationshipKinds[missing.relationship];
    if (!kinds || from.kind !== kinds[0] || missing.expectedKind !== kinds[1]) {
      throw new Error("Evidence graph missing-evidence relationship conflicts with node kinds.");
    }
  }
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

  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor];
    if (!current) continue;
    for (const edge of edgesBySource.get(current) ?? []) {
      if (!backwardRelationships.has(edge.relationship)) continue;
      if (backwardIds.has(edge.to)) continue;
      backwardIds.add(edge.to);
      pending.push(edge.to);
    }
  }

  const forwardIds = new Set(
    (edgesBySource.get(graph.rootReleaseId) ?? [])
      .filter((edge) => edge.relationship === "produced")
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
