'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatHour, formatNumber } from '../lib/format.js';

// Colours validated (dataviz validator, dark mode, on gray-800) for CVD separation and contrast.
export const SERIES_COLORS = { browser: '#3987e5', server: '#d95926', count: '#3987e5' };

const tooltipStyle = { backgroundColor: '#111827', border: '1px solid #4b5563', borderRadius: 6 };

// series: [{ key, label }]. Stacked bars per hour, plus a table view for screen readers.
export default function HourlyChart({ data, series, title }) {
  const multiDay = data.length > 24;
  const rows = data.map((d) => ({ ...d, label: formatHour(d.hour, multiDay) }));

  return (
    <figure>
      <figcaption className="mb-3 text-lg font-bold">{title}</figcaption>
      <div className="h-64" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -12 }} barCategoryGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis dataKey="label" stroke="#9ca3af" tick={{ fontSize: 12 }} minTickGap={24} />
            <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: '#f3f4f6' }}
              itemStyle={{ color: '#e5e7eb' }}
              cursor={{ fill: 'rgba(156, 163, 175, 0.12)' }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ color: '#e5e7eb', fontSize: 13 }} />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="a"
                fill={SERIES_COLORS[s.key]}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm text-gray-300">
        <summary className="focus-ring cursor-pointer rounded">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-400">
                <th scope="col" className="py-1 pr-4 font-semibold">Hour</th>
                {series.map((s) => <th key={s.key} scope="col" className="py-1 pr-4 font-semibold">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.hour} className="border-t border-gray-700">
                  <td className="py-1 pr-4">{r.label}</td>
                  {series.map((s) => <td key={s.key} className="py-1 pr-4 tabular-nums">{formatNumber(r[s.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
