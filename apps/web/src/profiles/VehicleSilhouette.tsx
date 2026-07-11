/**
 * Vehicle silhouette visualization (E06-T2).
 * Simple SVG that scales based on height/width/length to visualize
 * proportions and catch data entry errors.
 */

import React from 'react';

interface VehicleSilhouetteProps {
  height_m?: number;
  width_m?: number;
  length_m?: number;
}

export default function VehicleSilhouette({
  height_m = 2.0,
  width_m = 2.0,
  length_m = 5.0,
}: VehicleSilhouetteProps): React.ReactElement {
  // Normalize to a viewBox with reasonable scaling
  // We want the longest dimension to fit nicely
  const maxDim = Math.max(height_m, width_m, length_m);
  const scale = 50 / maxDim; // 50 units viewBox per meter

  const svgWidth = length_m * scale;
  const svgHeight = height_m * scale;
  const rectWidth = width_m * scale;
  const rectHeight = height_m * scale;

  // Center the rectangle horizontally
  const rectX = (svgWidth - rectWidth) / 2;
  const rectY = 0;

  return (
    <div className="flex justify-center items-center bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 min-h-32">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="max-w-full h-auto max-h-32 text-slate-800 dark:text-slate-100"
        data-testid="vehicle-silhouette"
      >
        {/* Vehicle body (rectangle) */}
        <rect
          x={rectX}
          y={rectY}
          width={rectWidth}
          height={rectHeight}
          fill="currentColor"
          opacity="0.3"
          stroke="currentColor"
          strokeWidth="1"
        />

        {/* Wheels (simplified) */}
        <circle cx={rectX + rectWidth * 0.25} cy={rectY + rectHeight} r={rectWidth * 0.08} fill="currentColor" />
        <circle cx={rectX + rectWidth * 0.75} cy={rectY + rectHeight} r={rectWidth * 0.08} fill="currentColor" />

        {/* Dimension text labels */}
        <text
          x={svgWidth / 2}
          y={svgHeight + 8}
          textAnchor="middle"
          fontSize="8"
          fill="currentColor"
          opacity="0.7"
        >
          {length_m.toFixed(1)} m
        </text>
        <text
          x={-8}
          y={svgHeight / 2}
          textAnchor="middle"
          fontSize="8"
          fill="currentColor"
          opacity="0.7"
          transform={`rotate(-90 -8 ${svgHeight / 2})`}
        >
          {height_m.toFixed(1)} m
        </text>
      </svg>
    </div>
  );
}
