"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; value: number };

export function TimeSeriesChart({
  data,
  yLabel,
  height = 280,
}: {
  data: Point[];
  yLabel?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid stroke="#E5E5E5" strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#A3A3A3" />
        <YAxis tick={{ fontSize: 11 }} stroke="#A3A3A3" width={64}
          label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 11 } : undefined}
        />
        <Tooltip
          contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E5E5", fontSize: 12 }}
        />
        <Line type="monotone" dataKey="value" stroke="#171717" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
