"use client";

import { ResponsiveContainer, Treemap } from "recharts";

import type { SectorRow } from "@/lib/data";
import { cellColor, fmtPctSigned, returnIntensity } from "@/lib/format";

type TreemapNode = {
  name: string;
  size: number;
  return_ytd: number;
  vol: number;
};

export function SectorTreemap({ sectors }: { sectors: SectorRow[] }) {
  const data: TreemapNode[] = sectors.map((s) => ({
    name: s.sector_b3,
    size: Math.max(1, s.member_count),
    return_ytd: s.return_ytd_mean,
    vol: s.vol_annual_mean,
  }));

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer>
        <Treemap
          data={data}
          dataKey="size"
          stroke="var(--bg-base)"
          fill="var(--bg-subtle)"
          isAnimationActive={false}
          content={<TreemapCell />}
        />
      </ResponsiveContainer>
    </div>
  );
}

type CellProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  return_ytd?: number;
};

function TreemapCell(props: CellProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, return_ytd } = props;
  if (width < 1 || height < 1) return null;
  const showText = width > 70 && height > 30;
  const showPct = width > 60 && height > 50;
  const bg = cellColor(return_ytd);
  // White text on saturated cells; lighter elsewhere. Always with subtle shadow.
  const strong = (returnIntensity(return_ytd) ?? 0) > 0.25;
  const textColor = strong ? "#ffffff" : "rgba(243,244,246,0.95)";
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={bg} stroke="var(--bg-base)" />
      {showText && name ? (
        <text
          x={x + 10}
          y={y + 20}
          fill={textColor}
          fontSize={12}
          fontWeight={600}
          style={{
            pointerEvents: "none",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          }}
        >
          {name.length > 24 ? `${name.slice(0, 22)}…` : name}
        </text>
      ) : null}
      {showPct && return_ytd != null ? (
        <text
          x={x + 10}
          y={y + 40}
          fill={textColor}
          fontSize={15}
          fontWeight={700}
          style={{
            pointerEvents: "none",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtPctSigned(return_ytd)}
        </text>
      ) : null}
    </g>
  );
}
