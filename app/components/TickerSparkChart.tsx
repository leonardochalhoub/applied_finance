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

export function TickerSparkChart({
  data,
  positive,
  height = 320,
}: {
  data: Point[];
  positive: boolean;
  height?: number;
}) {
  const color = positive ? "var(--gain)" : "var(--loss)";
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            stroke="var(--border)"
            minTickGap={48}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            stroke="var(--border)"
            width={56}
            tickFormatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--strong)",
            }}
            labelStyle={{ color: "var(--muted)", fontWeight: 600 }}
            formatter={(value: unknown) =>
              typeof value === "number" ? value.toFixed(2) : "—"
            }
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            fill="url(#fillGrad)"
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
