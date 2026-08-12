"use client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RevenuePoint } from "@/lib/analytics";

export function TrendChart({ data }: { data: RevenuePoint[] }) {
  const shaped = data.map((p) => ({ ...p, day: p.day.slice(5) }));
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <ComposedChart data={shaped} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={6} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
          />
          <Tooltip formatter={(v, name) => [`${Number(v).toLocaleString("en-GB")} ₸`, name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="revenue" name="Revenue" fill="#d4d4d8" isAnimationActive={false} />
          <Line
            dataKey="movingAvg"
            name="7-day average"
            stroke="#18181b"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
