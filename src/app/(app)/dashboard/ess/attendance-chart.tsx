"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DAY_STATUSES, type DayStatus } from "@/core/attendance/day-status";
import { formatHoursMinutes } from "@/core/attendance/month-calendar";

export type ChartDay = { date: string; label: string; status: DayStatus | null; workedMinutes: number | null; signIn: string | null; signOut: string | null };

/** Days without worked time get a short fixed bar so their status colour is still visible. */
const MARKER_MINUTES = 83;

const LEGEND_ORDER: DayStatus[] = ["PRESENT", "LATE", "EARLY", "HALF_DAY", "ABSENT", "SHORT_DAY", "ABSENT_SHORT_TIME", "LEAVE", "SCHEDULED", "MISSING", "OFF", "NOT_SYNCED"];

export function AttendanceLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
      {LEGEND_ORDER.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm" style={{ background: DAY_STATUSES[s].color }} />
          {DAY_STATUSES[s].label}
        </li>
      ))}
    </ul>
  );
}

export function AttendanceFlagChart({ days }: { days: ChartDay[] }) {
  const data = days.map((d) => ({
    ...d,
    value: d.status === null ? 0 : d.workedMinutes && d.workedMinutes > 0 ? d.workedMinutes : MARKER_MINUTES,
  }));
  const max = Math.max(MARKER_MINUTES * 2, ...data.map((d) => d.value));
  // Whole-hour gridlines: every hour up to 12 h, every 2 h beyond.
  const step = max > 12 * 60 ? 120 : 60;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 4 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            interval={0}
            angle={-45}
            textAnchor="end"
            height={48}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--muted-foreground)"
          />
          <YAxis
            ticks={ticks}
            domain={[0, top]}
            tickFormatter={(v: number) => formatHoursMinutes(v)}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--muted-foreground)"
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              if (!d) return null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <p className="font-medium">{d.date}</p>
                  <p>{d.status ? DAY_STATUSES[d.status].label : "Not employed"}</p>
                  {d.status === "MISSING" && d.signIn ? (
                    <p>Only punch: {d.signIn} (sign-in or sign-out missing)</p>
                  ) : (
                    <>
                      {d.signIn && <p>Sign in: {d.signIn}</p>}
                      {d.signIn && <p>Sign out: {d.signOut ?? "not yet"}</p>}
                    </>
                  )}
                  {d.workedMinutes != null && <p>Worked {formatHoursMinutes(d.workedMinutes)} h</p>}
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.status ? DAY_STATUSES[d.status].color : "transparent"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
