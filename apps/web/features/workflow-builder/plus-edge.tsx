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
  success?: boolean;
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
  const isSuccess = data?.success && !isFailed;
  const isPulse = data?.pulse && !isFailed && !isSuccess;
  const isActive = data?.active && !isFailed && !isSuccess;

  const strokeColor = isFailed
    ? "#ef4444"
    : isSuccess
      ? "#10b981"
      : isPulse
        ? "#8b5cf6"
        : isActive
          ? "#10b981"
          : "rgb(148 163 184)";

  const strokeWidth = isFailed || isPulse || isActive || isSuccess ? 2.6 : 1.6;
  const animation = isFailed
    ? "av-dash 0.5s linear infinite"
    : isSuccess
      ? "av-edge-success 0.6s ease-out forwards"
      : isPulse
        ? "av-dash 0.7s linear infinite"
        : isActive
          ? "av-edge-pulse 1.5s ease-in-out infinite"
          : undefined;

  const dashArray = isFailed ? "6 6" : isPulse ? "8 8" : isSuccess ? "24 24" : undefined;
  const filter = isFailed
    ? "drop-shadow(0 0 4px rgb(239 68 68 / 0.35))"
    : isSuccess
      ? "drop-shadow(0 0 4px rgb(16 185 129 / 0.35))"
      : isPulse
        ? "drop-shadow(0 0 5px rgb(139 92 246 / 0.35))"
        : isActive
          ? "drop-shadow(0 0 4px rgb(16 185 129 / 0.3))"
          : undefined;

  const particleColor = isPulse ? "#8b5cf6" : "#10b981";

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
          transition: "stroke 220ms ease, stroke-width 220ms ease, filter 220ms ease",
          ...style
        }}
      />

      {(isPulse || isActive) && (
        <>
          <circle r={isPulse ? 3.5 : 3} fill={particleColor} opacity="0.2">
            <animateMotion dur={isPulse ? "0.9s" : "1.3s"} repeatCount="indefinite" path={path} />
          </circle>
          <circle r={isPulse ? 2.2 : 1.8} fill={particleColor} opacity="0.95">
            <animateMotion dur={isPulse ? "0.9s" : "1.3s"} repeatCount="indefinite" path={path} />
          </circle>
        </>
      )}

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
              className={`mb-1 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide transition-all duration-200 ${
                isFailed
                  ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                  : isSuccess
                    ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : isPulse
                      ? "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
                      : "bg-elevated text-ink-muted"
              }`}
            >
              {data.label}
            </span>
          )}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-line bg-elevated text-ink-muted shadow-sm transition-all duration-200 hover:border-violet-500 hover:text-violet-600 hover:shadow-md"
            onClick={(e) => {
              e.stopPropagation();
              data?.onAdd?.(id);
            }}
            title="Add a step"
            aria-label="Add a step"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
