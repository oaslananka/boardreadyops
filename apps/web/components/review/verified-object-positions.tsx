import type { SnapshotArtifact } from "@boardreadyops/contracts";
import {
  diffVerifiedObjectPositions,
  type VerifiedObjectPositionDelta,
} from "@boardreadyops/contracts/verified-object-position-diff";

const previewCount = 5;

function mm(value: number): string {
  return String(Number(value.toFixed(6)));
}

function Movement({
  item,
  fingerprint,
  onInspectFinding,
}: Readonly<{
  item: VerifiedObjectPositionDelta;
  fingerprint?: string | undefined;
  onInspectFinding?: ((fingerprint: string) => void) | undefined;
}>) {
  return (
    <li className="min-w-0 rounded-md border border-border bg-background p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{item.sheetOrLayer}</span>
        <span className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">Position moved</span>
      </div>
      <code className="mt-1 block break-all text-[11px] text-muted-foreground" title="KiCad source object UUID">
        {item.sourceUuid}
      </code>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Base (mm)</dt>
          <dd className="mt-0.5 font-mono text-foreground">
            {mm(item.baseMm.x)}, {mm(item.baseMm.y)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Head (mm)</dt>
          <dd className="mt-0.5 font-mono text-foreground">
            {mm(item.headMm.x)}, {mm(item.headMm.y)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Displacement (mm)</dt>
          <dd className="mt-0.5 font-mono text-foreground">
            {mm(item.headMm.x - item.baseMm.x)}, {mm(item.headMm.y - item.baseMm.y)}
          </dd>
        </div>
      </dl>
      {fingerprint && onInspectFinding ? (
        <button
          type="button"
          onClick={() => onInspectFinding(fingerprint)}
          className="mt-3 min-h-10 rounded-md border border-primary/40 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Inspect linked DRC finding
        </button>
      ) : null}
    </li>
  );
}

/**
 * PR-native but partial: compare source coordinates of KiCad DRC-referenced
 * objects shared by both snapshots. Never claim a full PCB object inventory,
 * additions/removals, fault geometry, or a successful engineering verdict.
 */
export function VerifiedObjectPositions({
  baseSnapshots = [],
  headSnapshots,
  findingFingerprints = [],
  onInspectFinding,
}: Readonly<{
  baseSnapshots?: SnapshotArtifact[];
  headSnapshots: SnapshotArtifact[];
  findingFingerprints?: string[];
  onInspectFinding?: (fingerprint: string) => void;
}>) {
  const anyNative = [...baseSnapshots, ...headSnapshots].some((snapshot) => snapshot.name.startsWith("kicad_native_"));
  if (!anyNative) return null;

  const comparisons = diffVerifiedObjectPositions(baseSnapshots, headSnapshots);
  const moved = comparisons.filter((item) => item.status === "position-moved");
  const same = comparisons.length - moved.length;
  const allowedFingerprints = new Set(findingFingerprints);
  const linkedFinding = (item: VerifiedObjectPositionDelta): string | undefined => {
    for (const snapshot of headSnapshots) {
      if (
        snapshot.name.startsWith("kicad_native_") &&
        snapshot.kind === "pcb_layer" &&
        snapshot.format === "svg" &&
        snapshot.sheetOrLayer === item.sheetOrLayer
      ) {
        for (const anchor of snapshot.anchors) {
          const metadata = anchor.metadata;
          const fingerprint = metadata?.fingerprint;
          if (
            anchor.kind === "finding" &&
            anchor.layer === item.sheetOrLayer.split(" / ").at(-1) &&
            metadata?.provenance === "kicad-json-object-position" &&
            typeof metadata.sourceUuid === "string" &&
            metadata.sourceUuid.toLowerCase() === item.sourceUuid &&
            metadata.sourceXmm === item.headMm.x &&
            metadata.sourceYmm === item.headMm.y &&
            typeof fingerprint === "string" &&
            allowedFingerprints.has(fingerprint)
          ) {
            return fingerprint;
          }
        }
      }
    }
    return undefined;
  };
  const hasBoth =
    baseSnapshots.some((snapshot) => snapshot.name.startsWith("kicad_native_")) &&
    headSnapshots.some((snapshot) => snapshot.name.startsWith("kicad_native_"));

  return (
    <section
      aria-label="Source-verified PCB object movement"
      className="rounded-lg border border-border bg-card p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Source-verified object movement</h3>
        {comparisons.length ? (
          <span className="rounded-sm bg-muted px-2 py-1 text-xs font-semibold text-foreground">
            {moved.length} moved · {same} unchanged (observed)
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Only objects identified by the same KiCad source UUID in DRC-linked native snapshots from both revisions are
        compared using absolute board coordinates (mm). This is not a complete PCB inventory or a fabrication verdict.
      </p>
      {!hasBoth ? (
        <p
          className="mt-3 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
          role="status"
        >
          Position comparison unavailable: native KiCad evidence is required for both base and head revisions.
        </p>
      ) : comparisons.length === 0 ? (
        <p
          className="mt-3 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
          role="status"
        >
          No shared source-verified DRC objects could be compared. Missing markers do not establish that an object was
          added, removed, or unchanged.
        </p>
      ) : moved.length === 0 ? (
        <p
          className="mt-3 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
          role="status"
        >
          No movement observed among {same} matched source object(s). Unreferenced PCB objects were not assessed.
        </p>
      ) : (
        <>
          <ul className="mt-3 grid gap-2 lg:grid-cols-2" aria-label="Observed source object movements">
            {moved.slice(0, previewCount).map((item) => (
              <Movement
                key={`${item.sheetOrLayer}:${item.sourceUuid}`}
                item={item}
                fingerprint={linkedFinding(item)}
                onInspectFinding={onInspectFinding}
              />
            ))}
          </ul>
          {moved.length > previewCount ? (
            <details className="mt-2 rounded-md border border-border p-2">
              <summary className="cursor-pointer px-2 py-1 text-sm font-medium text-primary">
                Show {moved.length - previewCount} more observed movements
              </summary>
              <ul className="mt-2 grid gap-2 lg:grid-cols-2" aria-label="Additional source object movements">
                {moved.slice(previewCount).map((item) => (
                  <Movement
                    key={`${item.sheetOrLayer}:${item.sourceUuid}`}
                    item={item}
                    fingerprint={linkedFinding(item)}
                    onInspectFinding={onInspectFinding}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
