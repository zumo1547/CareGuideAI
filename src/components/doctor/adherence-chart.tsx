"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface AdherencePoint {
  day: string;
  taken: number;
  missed: number;
}

interface AdherenceChartProps {
  data: AdherencePoint[];
}

export const AdherenceChart = ({ data }: AdherenceChartProps) => (
  <div className="h-72 w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="takenGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0891b2" stopOpacity={0.9} />
            <stop offset="95%" stopColor="#0891b2" stopOpacity={0.06} />
          </linearGradient>
          <linearGradient id="missedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#dc2626" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#dc2626" stopOpacity={0.08} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
        <XAxis dataKey="day" stroke="#0f172a" />
        <YAxis allowDecimals={false} stroke="#0f172a" />
        <Tooltip />
        <Area
          type="monotone"
          dataKey="taken"
          stroke="#0891b2"
          fillOpacity={1}
          fill="url(#takenGradient)"
        />
        <Area
          type="monotone"
          dataKey="missed"
          stroke="#dc2626"
          fillOpacity={1}
          fill="url(#missedGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);
