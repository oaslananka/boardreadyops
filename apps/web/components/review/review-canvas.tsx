"use client";

import type { CanvasAnchor, SnapshotArtifact } from "@boardreadyops/contracts";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { DemoComment, DemoFinding } from "../../lib/demo-data.js";

export interface ReviewCanvasProps {
  headSnapshots: SnapshotArtifact[];
  baseSnapshots?: SnapshotArtifact[];
  findings?: DemoFinding[];
  comments?: DemoComment[];
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
  onAddCommentAtPoint?: (point: { x: number; y: number; sheetOrLayer: string }) => void;
}

export type ViewMode = "head" | "base" | "overlay" | "diff" | "split";

function toImageSrc(content?: string): string {
  if (!content) return "";
  if (content.startsWith("data:") || content.startsWith("http://") || content.startsWith("https://")) {
    return content;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
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
    <div className="canvas-markers-layer">
      {sheetAnchors.map((anchor) => {
        if (anchor.kind === "finding" && anchor.metadata?.fingerprint) {
          const fp = String(anchor.metadata.fingerprint);
          const isSelected = fp === selectedFindingFingerprint;
          const sev = String(anchor.metadata.severity ?? "warning");

          return (
            <button
              type="button"
              key={anchor.id}
              className={`canvas-marker finding-marker severity-${sev} ${isSelected ? "selected" : ""}`}
              style={{
                left: `${anchor.x * 100}%`,
                top: `${anchor.y * 100}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectFinding?.(fp);
              }}
              title={`Finding: ${anchor.metadata.ruleId}\n${anchor.metadata.message}`}
            >
              <span className="marker-dot" />
              <span className="marker-label">{anchor.targetRef}</span>
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
                className={`canvas-marker finding-marker severity-${compFinding.severity} ${isSelected ? "selected" : ""}`}
                style={{
                  left: `${anchor.x * 100}%`,
                  top: `${anchor.y * 100}%`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFinding?.(compFinding.fingerprint);
                }}
                title={`Finding on ${anchor.targetRef}: ${compFinding.ruleId}`}
              >
                <span className="marker-dot" />
                <span className="marker-label">{anchor.targetRef}</span>
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
            className="canvas-marker comment-marker"
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
    <div className="split-viewport-grid">
      <div className="split-pane base-pane">
        <span className="pane-tag">Base Revision</span>
        {baseSrc ? (
          // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
          <img src={baseSrc} alt="Base Revision Snapshot" className="svg-render-img" />
        ) : (
          <div className="empty-pane-msg">No base snapshot</div>
        )}
      </div>

      <div className="split-pane head-pane">
        <span className="pane-tag">Head Revision</span>
        {headSrc ? (
          // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
          <img src={headSrc} alt="Head Revision Snapshot" className="svg-render-img" />
        ) : (
          <div className="empty-pane-msg">No head snapshot</div>
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
    <div className="canvas-layers-stack">
      {(viewMode === "overlay" || viewMode === "base" || viewMode === "diff") && baseSrc ? (
        // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
        <img
          src={baseSrc}
          alt="Base Revision Snapshot Layer"
          className="canvas-layer base-layer"
          style={{
            opacity: viewMode === "overlay" ? 1 - opacity : 1,
            filter: viewMode === "diff" ? "invert(1) grayscale(1)" : "none",
          }}
        />
      ) : null}

      {(viewMode === "overlay" || viewMode === "head" || viewMode === "diff") && headSrc ? (
        // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
        <img
          src={headSrc}
          alt="Head Revision Snapshot Layer"
          className="canvas-layer head-layer"
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
  findings = [],
  comments = [],
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
  onAddCommentAtPoint,
}: Readonly<ReviewCanvasProps>) {
  const [selectedSheetOrLayer, setSelectedSheetOrLayer] = useState<string>(headSnapshots[0]?.sheetOrLayer ?? "Main");
  const [viewMode, setViewMode] = useState<ViewMode>("overlay");
  const [opacity, setOpacity] = useState<number>(0.5);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentHeadSnapshot = headSnapshots.find((s) => s.sheetOrLayer === selectedSheetOrLayer) ?? headSnapshots[0];
  const currentBaseSnapshot = baseSnapshots.find((s) => s.sheetOrLayer === selectedSheetOrLayer) ?? baseSnapshots[0];

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

  return (
    <div className="review-canvas-container panel">
      <section className="canvas-toolbar" aria-label="Canvas instruments">
        <div className="toolbar-left">
          <label htmlFor="sheet-select" className="toolbar-label">
            Layer / Sheet:
          </label>
          <select
            id="sheet-select"
            value={selectedSheetOrLayer}
            onChange={(e) => setSelectedSheetOrLayer(e.currentTarget.value)}
            className="form-select canvas-sheet-select"
          >
            {availableSheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <div className="view-mode-tabs">
            <button
              type="button"
              className={`mode-btn ${viewMode === "overlay" ? "active" : ""}`}
              onClick={() => setViewMode("overlay")}
              title="Overlay with opacity slider"
            >
              Overlay
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === "split" ? "active" : ""}`}
              onClick={() => setViewMode("split")}
              title="Side-by-side comparison"
            >
              Split
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === "diff" ? "active" : ""}`}
              onClick={() => setViewMode("diff")}
              title="Difference highlight"
            >
              Visual Diff
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === "head" ? "active" : ""}`}
              onClick={() => setViewMode("head")}
              title="Head revision only"
            >
              Head Only
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === "base" ? "active" : ""}`}
              onClick={() => setViewMode("base")}
              title="Base revision only"
            >
              Base Only
            </button>
          </div>
        </div>

        <div className="toolbar-right">
          {viewMode === "overlay" ? (
            <div className="opacity-slider-wrap">
              <span className="slider-label">Base</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(Number.parseFloat(e.currentTarget.value))}
                className="opacity-slider"
                aria-label="Overlay blend: base vs. head snapshot opacity"
                title={`Head Opacity: ${Math.round(opacity * 100)}%`}
              />
              <span className="slider-label">Head ({Math.round(opacity * 100)}%)</span>
            </div>
          ) : null}

          <div className="zoom-controls">
            <button
              type="button"
              onClick={handleZoomOut}
              className="zoom-btn"
              aria-label="Zoom out"
              title="Zoom Out (-)"
            >
              −
            </button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={handleZoomIn} className="zoom-btn" aria-label="Zoom in" title="Zoom In (+)">
              +
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="zoom-btn reset-btn"
              aria-label="Reset zoom and pan"
              title="Reset View (0)"
            >
              ↺ Reset
            </button>
          </div>
        </div>
      </section>

      <section
        ref={containerRef}
        aria-label="Schematic and PCB Review Canvas"
        className={`canvas-viewport ${isDragging ? "dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div
          className="canvas-transform-wrapper"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {viewMode === "split" ? (
            <SplitViewport baseSrc={baseSrc} headSrc={headSrc} />
          ) : (
            <StackedLayersView
              viewMode={viewMode}
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
