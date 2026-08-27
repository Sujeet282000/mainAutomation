"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "reactflow";
import { Plus } from "lucide-react";

export function PlusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data
}: EdgeProps<{
  onAdd?: (edgeId: string) => void;
  label?: string;
  active?: boolean;
  pulse?: boolean;
  failed?: boolean;
}>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16
  });

  const isFailed = data?.failed;
  const isPulse = data?.pulse && !isFailed;
  const isActive = data?.active && !isFailed;

  /* Edge color by state */
  const strokeColor = isFailed
    ? "#ef4444"
    : isPulse
      ? "#8b5cf6"
      : isActive
        ? "#10b981"
        : "rgb(148 163 184)";

  const strokeWidth = isFailed || isPulse || isActive ? 2.6 : 1.6;

  const animation = isFailed
    ? "av-dash 0.5s linear infinite"
    : isPulse
      ? "av-dash 0.7s linear infinite"
      : isActive
        ? "av-edge-pulse 1.5s ease-in-out infinite"
        : undefined;

  const dashArray = isFailed ? "6 6" : isPulse ? "8 8" : undefined;

  const filter = isFailed
    ? "drop-shadow(0 0 4px rgb(239 68 68 / 0.35))"
    : isPulse
      ? "drop-shadow(0 0 3px rgb(139 92 246 / 0.3))"
      : isActive
        ? "drop-shadow(0 0 3px rgb(16 185 129 / 0.3))"
        : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: dashArray,
          animation,
          filter,
          transition: "stroke 0.3s ease, stroke-width 0.3s ease, filter 0.3s ease",
          ...style
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all"
          }}
          className="nodrag nopan flex flex-col items-center"
        >
          {data?.label && (
            <span
              className={`mb-1 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                isFailed
                  ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                  : "bg-elevated text-ink-muted"
              }`}
            >
              {data.label}
            </span>
          )}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-line bg-elevated text-ink-muted shadow-sm hover:border-violet-500 hover:text-violet-600 hover:shadow-md transition-all duration-200"
            onClick={(e) => {
              e.stopPropagation();
              data?.onAdd?.(id);
            }}
            title="Add a step"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
