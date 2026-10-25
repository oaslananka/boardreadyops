"use client";

import type { CanvasAnchor, SnapshotArtifact } from "@boardreadyops/contracts";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { DemoComment, DemoFinding } from "../../lib/demo-data.js";

export interface ReviewCanvasProps {
  headSnapshots: SnapshotArtifact[];
  baseSnapshots?: SnapshotArtifact[];
  /** Use a shorter preview before the finding list on narrow run-inspection screens. */
  compactMobile?: boolean;
  /** Hide optional inspection chrome only in the initial Overview preview on small screens. */
  previewMobileControls?: boolean;
  /** Start on the first actual PCB layer when used as a review overview teaser. */
  preferPcbLayer?: boolean;
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

/** Position an anchor on the rendered image after object-fit:contain letterboxing. */
export function positionContainedImageAnchor(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } | undefined {
  if (
    [x, y, canvasWidth, canvasHeight, imageWidth, imageHeight].some((n) => !Number.isFinite(n)) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  )
    return undefined;
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const fittedWidth = imageWidth * scale;
  const fittedHeight = imageHeight * scale;
  return {
    x: ((canvasWidth - fittedWidth) / 2 + x * fittedWidth) / canvasWidth,
    y: ((canvasHeight - fittedHeight) / 2 + y * fittedHeight) / canvasHeight,
  };
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

/** Group native DRC references to the same physical object and image point. */
export function groupNativeSourceAnchors(anchors: readonly CanvasAnchor[]): Map<string, CanvasAnchor[]> {
  const grouped = new Map<string, CanvasAnchor[]>();
  for (const anchor of anchors) {
    const key = nativeAnchorKey(anchor);
    if (!key) continue;
    const group = grouped.get(key);
    if (group) group.push(anchor);
    else grouped.set(key, [anchor]);
  }
  return grouped;
}

/** A repeated click cycles through the distinct rule findings on one source object. */
export function nextSourceFindingFingerprint(group: readonly CanvasAnchor[], selected?: string): string | undefined {
  const options = [
    ...new Set(
      group
        .map((anchor) => anchor.metadata?.fingerprint)
        .filter((fingerprint): fingerprint is string => typeof fingerprint === "string" && fingerprint.length > 0),
    ),
  ];
  if (!options.length) return undefined;
  return options[(options.indexOf(selected ?? "") + 1) % options.length];
}

function nativeAnchorKey(anchor: CanvasAnchor): string | undefined {
  const sourceUuid = anchor.metadata?.sourceUuid;
  if (
    anchor.kind !== "finding" ||
    anchor.metadata?.provenance !== "kicad-json-object-position" ||
    typeof sourceUuid !== "string" ||
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y)
  )
    return undefined;
  return [sourceUuid, anchor.layer ?? "", anchor.x.toFixed(8), anchor.y.toFixed(8)].join(":");
}

interface CanvasMarkersProps {
  sheetAnchors: CanvasAnchor[];
  relevantFindings: DemoFinding[];
  comments: DemoComment[];
  markerCanvas?: { canvasWidth: number; canvasHeight: number; imageWidth: number; imageHeight: number } | undefined;
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
}

function CanvasMarkersLayer({
  sheetAnchors,
  relevantFindings,
  comments,
  markerCanvas,
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
}: Readonly<CanvasMarkersProps>) {
  const markerPosition = (anchor: CanvasAnchor) =>
    markerCanvas
      ? positionContainedImageAnchor(
          anchor.x,
          anchor.y,
          markerCanvas.canvasWidth,
          markerCanvas.canvasHeight,
          markerCanvas.imageWidth,
          markerCanvas.imageHeight,
        )
      : undefined;
  const sourceGroups = groupNativeSourceAnchors(sheetAnchors);
  return (
    <div className="pointer-events-none absolute inset-0">
      {sheetAnchors.map((anchor) => {
        if (anchor.kind === "finding" && anchor.metadata?.fingerprint) {
          const fp = String(anchor.metadata.fingerprint);
          const isSelected = fp === selectedFindingFingerprint;
          const sev = String(anchor.metadata.severity ?? "warning");
          const position = markerPosition(anchor);
          const key = nativeAnchorKey(anchor);
          const group = key ? sourceGroups.get(key) : undefined;
          if (group && group.length > 1 && group[0]?.id !== anchor.id) return null;
          const nextFp = nextSourceFindingFingerprint(group ?? [anchor], selectedFindingFingerprint) ?? fp;
          // Until the real image viewport is measured, native markers are not positioned.
          if (anchor.metadata.provenance === "kicad-json-object-position" && !position) return null;
          return (
            <button
              type="button"
              key={anchor.id}
              aria-label={
                group && group.length > 1
                  ? (anchor.targetRef ?? "KiCad source object") +
                    ", " +
                    group.length +
                    " source findings; click to cycle"
                  : undefined
              }
              className={`${markerBase} ${markerSeverityClass(sev)} pointer-events-auto ${isSelected ? "ring-2 ring-primary" : ""}`}
              style={{ left: `${(position?.x ?? anchor.x) * 100}%`, top: `${(position?.y ?? anchor.y) * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectFinding?.(nextFp);
              }}
              title={
                anchor.metadata.provenance === "kicad-json-object-position"
                  ? `KiCad-reported source object position (not the precise violation): ${anchor.metadata.ruleId}\n${anchor.metadata.message}`
                  : `Finding: ${anchor.metadata.ruleId}\n${anchor.metadata.message}`
              }
            >
              {anchor.targetRef} {group && group.length > 1 ? <span>({group.length})</span> : null}
            </button>
          );
        }

        if (anchor.kind === "component" && anchor.targetRef) {
          const compFinding = relevantFindings.find((f) => f.component === anchor.targetRef);
          if (compFinding) {
            const isSelected = compFinding.fingerprint === selectedFindingFingerprint;
            const position = markerPosition(anchor);
            return (
              <button
                type="button"
                key={anchor.id}
                className={`${markerBase} ${markerSeverityClass(compFinding.severity)} pointer-events-auto ${isSelected ? "ring-2 ring-primary" : ""}`}
                style={{ left: `${(position?.x ?? anchor.x) * 100}%`, top: `${(position?.y ?? anchor.y) * 100}%` }}
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

interface SplitViewportProps extends Omit<CanvasMarkersProps, "markerCanvas"> {
  baseSrc: string;
  headSrc: string;
  imageWidth?: number | undefined;
  imageHeight?: number | undefined;
}

/**
 * Each split pane contains its own object-fit viewport. The head marker coordinates
 * must be fitted to that pane, never the full canvas or the base revision.
 */
export function SplitViewport(props: Readonly<SplitViewportProps>) {
  const {
    baseSrc,
    headSrc,
    imageWidth,
    imageHeight,
    sheetAnchors,
    relevantFindings,
    comments,
    selectedFindingFingerprint,
    onSelectFinding,
    onSelectComment,
  } = props;
  const headPaneRef = useRef<HTMLDivElement | null>(null);
  const [headPaneSize, setHeadPaneSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const pane = headPaneRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = pane.clientWidth;
      const height = pane.clientHeight;
      setHeadPaneSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const markerCanvas =
    imageWidth && imageHeight && headPaneSize.width && headPaneSize.height
      ? { canvasWidth: headPaneSize.width, canvasHeight: headPaneSize.height, imageWidth, imageHeight }
      : undefined;

  return (
    <div className="grid h-full min-w-0 grid-cols-2 gap-2">
      <div className="relative min-w-0 overflow-hidden rounded-md border border-border bg-muted">
        <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-sm bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
          Base Revision
        </span>
        {baseSrc ? (
          // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
          <img src={baseSrc} alt="Base Revision Snapshot" className="size-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No base snapshot</div>
        )}
      </div>

      <div className="relative min-w-0 overflow-hidden rounded-md border border-border bg-muted">
        <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-sm bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
          Head Revision
        </span>
        <section ref={headPaneRef} className="relative size-full" aria-label="Head revision source markers">
          {headSrc ? (
            // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
            <img src={headSrc} alt="Head Revision Snapshot" className="size-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No head snapshot
            </div>
          )}
          {headSrc ? (
            <CanvasMarkersLayer
              sheetAnchors={sheetAnchors}
              relevantFindings={relevantFindings}
              comments={comments}
              markerCanvas={markerCanvas}
              selectedFindingFingerprint={selectedFindingFingerprint}
              onSelectFinding={onSelectFinding}
              onSelectComment={onSelectComment}
            />
          ) : null}
        </section>
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
  markerCanvas,
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
  markerCanvas?: { canvasWidth: number; canvasHeight: number; imageWidth: number; imageHeight: number } | undefined;
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
        sheetAnchors={viewMode === "base" ? [] : sheetAnchors}
        relevantFindings={relevantFindings}
        comments={comments}
        markerCanvas={markerCanvas}
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
  previewMobileControls = false,
  preferPcbLayer = false,
  findings = [],
  comments = [],
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
  onAddCommentAtPoint,
}: Readonly<ReviewCanvasProps>) {
  const [selectedSheetOrLayer, setSelectedSheetOrLayer] = useState<string>(
    () =>
      (preferPcbLayer ? headSnapshots.find((snapshot) => snapshot.kind === "pcb_layer") : undefined)?.sheetOrLayer ??
      headSnapshots[0]?.sheetOrLayer ??
      "Main",
  );
  const [viewMode, setViewMode] = useState<ViewMode>("head");
  const [opacity, setOpacity] = useState<number>(0.5);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      setCanvasSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
  const dimensions = currentHeadSnapshot ? svgViewBox(currentHeadSnapshot) : undefined;
  const imageWidth = dimensions?.[2] ?? currentHeadSnapshot?.width;
  const imageHeight = dimensions?.[3] ?? currentHeadSnapshot?.height;
  const markerCanvas =
    imageWidth && imageHeight && canvasSize.width && canvasSize.height
      ? { canvasWidth: canvasSize.width, canvasHeight: canvasSize.height, imageWidth, imageHeight }
      : undefined;

  // Differing SVG viewBox origins and scales cannot be overlaid faithfully.
  const comparable = comparableReviewSnapshots(currentBaseSnapshot, currentHeadSnapshot);
  const effectiveViewMode =
    !baseSrc || (!comparable && (viewMode === "overlay" || viewMode === "diff" || viewMode === "split"))
      ? "head"
      : viewMode;

  const modeButtonClass = (active: boolean) =>
    `shrink-0 rounded-sm px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <section
        className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3"
        aria-label="Canvas instruments"
      >
        <div className="flex min-w-0 max-w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <label htmlFor="sheet-select" className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground">
            Layer / Sheet:
          </label>
          <select
            id="sheet-select"
            value={selectedSheetOrLayer}
            onChange={(e) => setSelectedSheetOrLayer(e.currentTarget.value)}
            className="w-full min-w-0 max-w-full rounded-sm border border-border bg-background px-2 py-1 text-sm text-foreground sm:w-auto"
          >
            {availableSheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <fieldset
            className={`${previewMobileControls ? "hidden sm:flex" : "flex"} w-full min-w-0 flex-nowrap gap-1 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0`}
            aria-label="Revision comparison modes"
          >
            <button
              type="button"
              className={modeButtonClass(effectiveViewMode === "overlay")}
              aria-pressed={effectiveViewMode === "overlay"}
              disabled={!comparable}
              onClick={() => setViewMode("overlay")}
              title="Overlay with opacity slider"
            >
              Overlay
            </button>
            <button
              type="button"
              className={modeButtonClass(effectiveViewMode === "split")}
              aria-pressed={effectiveViewMode === "split"}
              disabled={!comparable}
              onClick={() => setViewMode("split")}
              title="Side-by-side comparison"
            >
              Split
            </button>
            <button
              type="button"
              className={modeButtonClass(effectiveViewMode === "diff")}
              aria-pressed={effectiveViewMode === "diff"}
              disabled={!comparable}
              onClick={() => setViewMode("diff")}
              title="Difference highlight"
            >
              Visual Diff
            </button>
            <button
              type="button"
              className={modeButtonClass(effectiveViewMode === "head")}
              aria-pressed={effectiveViewMode === "head"}
              onClick={() => setViewMode("head")}
              title="Head revision only"
            >
              Head Only
            </button>
            <button
              type="button"
              className={modeButtonClass(effectiveViewMode === "base")}
              aria-pressed={effectiveViewMode === "base"}
              disabled={!baseSrc}
              onClick={() => setViewMode("base")}
              title="Base revision only"
            >
              Base Only
            </button>
          </fieldset>
        </div>

        <div
          className={`${previewMobileControls ? "hidden sm:flex" : "flex"} min-w-0 flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3`}
        >
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
            <SplitViewport
              baseSrc={baseSrc}
              headSrc={headSrc}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              sheetAnchors={sheetAnchors}
              relevantFindings={relevantFindings}
              comments={comments}
              selectedFindingFingerprint={selectedFindingFingerprint}
              onSelectFinding={onSelectFinding}
              onSelectComment={onSelectComment}
            />
          ) : (
            <StackedLayersView
              viewMode={effectiveViewMode}
              baseSrc={baseSrc}
              headSrc={headSrc}
              opacity={opacity}
              sheetAnchors={sheetAnchors}
              relevantFindings={relevantFindings}
              comments={comments}
              markerCanvas={markerCanvas}
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
