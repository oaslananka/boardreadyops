import type { CanvasAnchor, SnapshotArtifact } from "./snapshots.js";

export type VerifiedObjectPositionDelta = {
  /** A matching object reported by KiCad DRC in both revisions, not a full PCB object inventory. */
  sourceUuid: string;
  sheetOrLayer: string;
  status: "position-moved" | "position-unchanged";
  baseMm: { x: number; y: number };
  headMm: { x: number; y: number };
};

type SourcePosition = {
  sourceUuid: string;
  sheetOrLayer: string;
  x: number;
  y: number;
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const POSITION_TOLERANCE_MM = 0.000001;

function sourcePosition(snapshot: SnapshotArtifact, anchor: CanvasAnchor): SourcePosition | undefined {
  if (
    snapshot.kind !== "pcb_layer" ||
    snapshot.format !== "svg" ||
    !snapshot.name.startsWith("kicad_native_") ||
    anchor.kind !== "finding" ||
    anchor.layer !== snapshot.sheetOrLayer.split(" / ").at(-1) ||
    anchor.metadata?.provenance !== "kicad-json-object-position"
  )
    return undefined;
  const uuid = anchor.metadata.sourceUuid;
  const x = anchor.metadata.sourceXmm;
  const y = anchor.metadata.sourceYmm;
  if (
    typeof uuid !== "string" ||
    !UUID.test(uuid) ||
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  )
    return undefined;
  return { sourceUuid: uuid.toLowerCase(), sheetOrLayer: snapshot.sheetOrLayer, x, y };
}

/**
 * Position-only delta for exact KiCad source UUIDs observed in *both* revisions.
 *
 * Native snapshots can contain only DRC-reported objects, not every board object.
 * Missing/ambiguous IDs must never become "added" or "removed" claims.
 * Absolute source mm avoids inventing movement when a canvas outline changes.
 */
export function diffVerifiedObjectPositions(
  baseSnapshots: readonly SnapshotArtifact[],
  headSnapshots: readonly SnapshotArtifact[],
): VerifiedObjectPositionDelta[] {
  function collect(snapshots: readonly SnapshotArtifact[]): Map<string, SourcePosition | null> {
    const indexed = new Map<string, SourcePosition | null>();
    for (const snapshot of snapshots) {
      for (const anchor of snapshot.anchors) {
        const current = sourcePosition(snapshot, anchor);
        if (!current) continue;
        const key = JSON.stringify([current.sheetOrLayer, current.sourceUuid]);
        if (!indexed.has(key)) {
          indexed.set(key, current);
        } else {
          const previous = indexed.get(key);
          if (previous && (previous.x !== current.x || previous.y !== current.y)) indexed.set(key, null);
        }
      }
    }
    return indexed;
  }
  const base = collect(baseSnapshots);
  const head = collect(headSnapshots);
  const deltas: VerifiedObjectPositionDelta[] = [];
  for (const [key, before] of base) {
    const after = head.get(key);
    if (!before || !after) continue;
    const moved =
      Math.abs(before.x - after.x) > POSITION_TOLERANCE_MM || Math.abs(before.y - after.y) > POSITION_TOLERANCE_MM;
    deltas.push({
      sourceUuid: before.sourceUuid,
      sheetOrLayer: before.sheetOrLayer,
      status: moved ? "position-moved" : "position-unchanged",
      baseMm: { x: before.x, y: before.y },
      headMm: { x: after.x, y: after.y },
    });
  }
  const compare = (left: string, right: string): number => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  };
  return deltas.sort((a, b) => compare(a.sheetOrLayer, b.sheetOrLayer) || compare(a.sourceUuid, b.sourceUuid));
}
