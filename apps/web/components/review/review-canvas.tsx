"use client";

import type { CanvasAnchor, SnapshotArtifact } from "@boardreadyops/contracts";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { DemoComment, DemoFinding } from "../../lib/demo-data.js";

export interface ReviewCanvasProps {
  headSnapshots: SnapshotArtifact[];
  baseSnapshots?: SnapshotArtifact[];
  /** Use a shorter preview before the finding list on narrow run-inspection screens. */
  compactMobile?: boolean;
  findings?: DemoFinding[];
  comments?: DemoComment[];
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
  onAddCommentAtPoint?: (point: { x: number; y: number; sheetOrLayer: string }) => void;
}

export type ViewMode = "head" | "base" | "overlay" | "diff" | "split";

function svgViewBox(snapshot: SnapshotArtifact): number[] | undefined {
  if (snapshot.format !== "svg" || typeof snapshot.content !== "string") return undefined;
  const opening = /<svg\b[^>]*>/isu.exec(snapshot.content)?.[0];
  const values = opening
    ?.match(/\bviewBox\s*=\s*["']([^"']+)["']/iu)?.[1]
    ?.trim()
    .split(/\s+/u)
    .map(Number);
  return values?.length === 4 && values.every(Number.isFinite) ? values : undefined;
}

/** Visual subtraction requires the same image coordinate frame. */
export function comparableReviewSnapshots(base?: SnapshotArtifact, head?: SnapshotArtifact): boolean {
  if (
    !base ||
    !head ||
    base.kind !== head.kind ||
    base.format !== head.format ||
    base.sheetOrLayer !== head.sheetOrLayer
  )
    return false;
  const before = svgViewBox(base);
  const after = svgViewBox(head);
  if (before || after)
    return Boolean(before && after && before.every((value, i) => Math.abs(value - (after[i] ?? NaN)) < 0.000001));
  return base.width === head.width && base.height === head.height;
}

function toImageSrc(content?: string): string {
  if (!content) return "";
  if (content.startsWith("data:") || content.startsWith("http://") || content.startsWith("https://")) {
    return content;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
}

const markerBase =
  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background px-1.5 py-0.5 text-[10px] font-medium shadow";

function markerSeverityClass(severity: string): string {
  if (severity === "error" || severity === "critical") return "bg-danger text-white";
  return "bg-warning text-white";
}

interface CanvasMarkersProps {
  sheetAnchors: CanvasAnchor[];
  relevantFindings: DemoFinding[];
  comments: DemoComment[];
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
}

function CanvasMarkersLayer({
  sheetAnchors,
  relevantFindings,
  comments,
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
}: Readonly<CanvasMarkersProps>) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {sheetAnchors.map((anchor) => {
        if (anchor.kind === "finding" && anchor.metadata?.fingerprint) {
          const fp = String(anchor.metadata.fingerprint);
          const isSelected = fp === selectedFindingFingerprint;
          const sev = String(anchor.metadata.severity ?? "warning");

          return (
            <button
              type="button"
              key={anchor.id}
              className={`${markerBase} ${markerSeverityClass(sev)} pointer-events-auto ${isSelected ? "ring-2 ring-primary" : ""}`}
              style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectFinding?.(fp);
              }}
              title={`Finding: ${anchor.metadata.ruleId}\n${anchor.metadata.message}`}
            >
              {anchor.targetRef}
            </button>
          );
        }

        if (anchor.kind === "component" && anchor.targetRef) {
          const compFinding = relevantFindings.find((f) => f.component === anchor.targetRef);
          if (compFinding) {
            const isSelected = compFinding.fingerprint === selectedFindingFingerprint;
            return (
              <button
                type="button"
                key={anchor.id}
                className={`${markerBase} ${markerSeverityClass(compFinding.severity)} pointer-events-auto ${isSelected ? "ring-2 ring-primary" : ""}`}
                style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFinding?.(compFinding.fingerprint);
                }}
                title={`Finding on ${anchor.targetRef}: ${compFinding.ruleId}`}
              >
                {anchor.targetRef}
              </button>
            );
          }
        }

        return null;
      })}

      {comments
        .filter((c) => c.findingFingerprint)
        .map((comment) => (
          <button
            type="button"
            key={comment.id}
            className="pointer-events-auto absolute rounded-full bg-card px-1 text-sm shadow"
            onClick={(e) => {
              e.stopPropagation();
              onSelectComment?.(comment.id);
            }}
            title={`Comment by ${comment.authorId}: ${comment.content}`}
          >
            💬
          </button>
        ))}
    </div>
  );
}

function SplitViewport({ baseSrc, headSrc }: Readonly<{ baseSrc: string; headSrc: string }>) {
  return (
    <div className="grid h-full grid-cols-2 gap-2">
      <div className="relative overflow-hidden rounded-md border border-border bg-muted">
        <span className="absolute left-2 top-2 rounded-sm bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
          Base Revision
        </span>
        {baseSrc ? (
          // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
          <img src={baseSrc} alt="Base Revision Snapshot" className="size-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No base snapshot</div>
        )}
      </div>

      <div className="relative overflow-hidden rounded-md border border-border bg-muted">
        <span className="absolute left-2 top-2 rounded-sm bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
          Head Revision
        </span>
        {headSrc ? (
          // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
          <img src={headSrc} alt="Head Revision Snapshot" className="size-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No head snapshot</div>
        )}
      </div>
    </div>
  );
}

function StackedLayersView({
  viewMode,
  baseSrc,
  headSrc,
  opacity,
  sheetAnchors,
  relevantFindings,
  comments,
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
}: Readonly<{
  viewMode: ViewMode;
  baseSrc: string;
  headSrc: string;
  opacity: number;
  sheetAnchors: CanvasAnchor[];
  relevantFindings: DemoFinding[];
  comments: DemoComment[];
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
}>) {
  return (
    <div className="relative h-full w-full">
      {(viewMode === "overlay" || viewMode === "base" || viewMode === "diff") && baseSrc ? (
        // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
        <img
          src={baseSrc}
          alt="Base Revision Snapshot Layer"
          className="absolute inset-0 size-full object-contain"
          style={{
            opacity: viewMode === "overlay" ? 1 - opacity : 1,
            // Difference blending subtracts the original base pixels; inverting
            // those pixels falsely highlights geometry that has not changed.
            filter: "none",
          }}
        />
      ) : null}

      {(viewMode === "overlay" || viewMode === "head" || viewMode === "diff") && headSrc ? (
        // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
        <img
          src={headSrc}
          alt="Head Revision Snapshot Layer"
          className="absolute inset-0 size-full object-contain"
          style={{
            opacity: viewMode === "overlay" ? opacity : 1,
            mixBlendMode: viewMode === "diff" ? "difference" : "normal",
          }}
        />
      ) : null}

      <CanvasMarkersLayer
        sheetAnchors={sheetAnchors}
        relevantFindings={relevantFindings}
        comments={comments}
        selectedFindingFingerprint={selectedFindingFingerprint}
        onSelectFinding={onSelectFinding}
        onSelectComment={onSelectComment}
      />
    </div>
  );
}

export function ReviewCanvas({
  headSnapshots,
  baseSnapshots = [],
  compactMobile = false,
  findings = [],
  comments = [],
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
  onAddCommentAtPoint,
}: Readonly<ReviewCanvasProps>) {
  const [selectedSheetOrLayer, setSelectedSheetOrLayer] = useState<string>(headSnapshots[0]?.sheetOrLayer ?? "Main");
  const [viewMode, setViewMode] = useState<ViewMode>("head");
  const [opacity, setOpacity] = useState<number>(0.5);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Only a published finding anchor selects a sheet; never infer a location from a
  // rule message, source filename, or component label.
  useEffect(() => {
    if (!selectedFindingFingerprint) return;
    const linked = headSnapshots.find((snapshot) =>
      snapshot.anchors.some(
        (anchor) => anchor.kind === "finding" && anchor.metadata?.fingerprint === selectedFindingFingerprint,
      ),
    );
    if (linked) setSelectedSheetOrLayer(linked.sheetOrLayer);
  }, [selectedFindingFingerprint, headSnapshots]);

  // Never compare a head layer with an unrelated base layer just because it
  // happens to be first. An unmatched sheet has no defensible visual diff.
  const currentHeadSnapshot = headSnapshots.find((s) => s.sheetOrLayer === selectedSheetOrLayer);
  const currentBaseSnapshot = baseSnapshots.find((s) => s.sheetOrLayer === selectedSheetOrLayer);

  const availableSheets = Array.from(
    new Set([...headSnapshots.map((s) => s.sheetOrLayer), ...baseSnapshots.map((s) => s.sheetOrLayer)]),
  );

  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.25, 5));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.25, 0.2));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setHasMoved(false);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setHasMoved(true);
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (!hasMoved && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = (e.clientX - rect.left - pan.x) / (rect.width * zoom);
      const clickY = (e.clientY - rect.top - pan.y) / (rect.height * zoom);

      if (clickX >= 0 && clickX <= 1 && clickY >= 0 && clickY <= 1) {
        onAddCommentAtPoint?.({
          x: Math.round(clickX * 1000) / 1000,
          y: Math.round(clickY * 1000) / 1000,
          sheetOrLayer: selectedSheetOrLayer,
        });
      }
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z * 1.25, 5));
      } else if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(z / 1.25, 0.2));
      } else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === "ArrowLeft") {
        setPan((p) => ({ ...p, x: p.x + 20 }));
      } else if (e.key === "ArrowRight") {
        setPan((p) => ({ ...p, x: p.x - 20 }));
      } else if (e.key === "ArrowUp") {
        setPan((p) => ({ ...p, y: p.y + 20 }));
      } else if (e.key === "ArrowDown") {
        setPan((p) => ({ ...p, y: p.y - 20 }));
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const sheetAnchors = currentHeadSnapshot?.anchors ?? [];
  const relevantFindings = findings.filter(
    (f) => !f.sheet || f.sheet.toLowerCase() === selectedSheetOrLayer.toLowerCase(),
  );

  const baseSrc = toImageSrc(currentBaseSnapshot?.content);
  const headSrc = toImageSrc(currentHeadSnapshot?.content);

  // Differing SVG viewBox origins and scales cannot be overlaid faithfully.
  const comparable = comparableReviewSnapshots(currentBaseSnapshot, currentHeadSnapshot);
  const effectiveViewMode =
    !baseSrc || (!comparable && (viewMode === "overlay" || viewMode === "diff" || viewMode === "split"))
      ? "head"
      : viewMode;

  const modeButtonClass = (active: boolean) =>
    `rounded-sm px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <section className="flex flex-wrap items-center justify-between gap-3" aria-label="Canvas instruments">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <label htmlFor="sheet-select" className="text-xs text-muted-foreground">
            Layer / Sheet:
          </label>
          <select
            id="sheet-select"
            value={selectedSheetOrLayer}
            onChange={(e) => setSelectedSheetOrLayer(e.currentTarget.value)}
            className="min-w-0 max-w-full rounded-sm border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {availableSheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={modeButtonClass(viewMode === "overlay")}
              disabled={!comparable}
              onClick={() => setViewMode("overlay")}
              title="Overlay with opacity slider"
            >
              Overlay
            </button>
            <button
              type="button"
              className={modeButtonClass(viewMode === "split")}
              disabled={!comparable}
              onClick={() => setViewMode("split")}
              title="Side-by-side comparison"
            >
              Split
            </button>
            <button
              type="button"
              className={modeButtonClass(viewMode === "diff")}
              disabled={!comparable}
              onClick={() => setViewMode("diff")}
              title="Difference highlight"
            >
              Visual Diff
            </button>
            <button
              type="button"
              className={modeButtonClass(viewMode === "head")}
              onClick={() => setViewMode("head")}
              title="Head revision only"
            >
              Head Only
            </button>
            <button
              type="button"
              className={modeButtonClass(viewMode === "base")}
              disabled={!baseSrc}
              onClick={() => setViewMode("base")}
              title="Base revision only"
            >
              Base Only
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {effectiveViewMode === "overlay" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Base</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(Number.parseFloat(e.currentTarget.value))}
                aria-label="Overlay blend: base vs. head snapshot opacity"
                title={`Head Opacity: ${Math.round(opacity * 100)}%`}
              />
              <span>Head ({Math.round(opacity * 100)}%)</span>
            </div>
          ) : null}

          <div className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={handleZoomOut}
              className="rounded-sm border border-border px-2 py-1 hover:bg-accent"
              aria-label="Zoom out"
              title="Zoom Out (-)"
            >
              −
            </button>
            <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={handleZoomIn}
              className="rounded-sm border border-border px-2 py-1 hover:bg-accent"
              aria-label="Zoom in"
              title="Zoom In (+)"
            >
              +
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent"
              aria-label="Reset zoom and pan"
              title="Reset View (0)"
            >
              ↺ Reset
            </button>
          </div>
        </div>
      </section>

      {baseSrc && headSrc && !comparable ? (
        <p className="rounded-md border border-warning/40 bg-warning-surface p-2 text-xs text-warning" role="status">
          These revisions have different canvas coordinates or image dimensions. Visual comparison is unavailable;
          inspect each source revision separately.
        </p>
      ) : null}

      <section
        ref={containerRef}
        aria-label="Schematic and PCB Review Canvas"
        className={`relative ${compactMobile ? "h-[19rem]" : "h-[27rem]"} overflow-hidden rounded-md border border-border bg-muted md:h-[34rem] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {effectiveViewMode === "split" ? (
            <SplitViewport baseSrc={baseSrc} headSrc={headSrc} />
          ) : (
            <StackedLayersView
              viewMode={effectiveViewMode}
              baseSrc={baseSrc}
              headSrc={headSrc}
              opacity={opacity}
              sheetAnchors={sheetAnchors}
              relevantFindings={relevantFindings}
              comments={comments}
              selectedFindingFingerprint={selectedFindingFingerprint}
              onSelectFinding={onSelectFinding}
              onSelectComment={onSelectComment}
            />
          )}
        </div>
      </section>
    </div>
  );
}
