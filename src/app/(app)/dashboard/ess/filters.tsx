"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { NativeSelect } from "@/components/form";
import { cn } from "@/lib/utils";

/** Updates one dashboard query parameter (employee / period) and re-renders the server page. */
function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    start(() => router.push(`${pathname}?${next}`, { scroll: false }));
  };
  return { set, pending };
}

export function DashboardFilters({
  employees, selectedEmployeeId, period, periodLabels,
}: {
  employees: { id: string; fullName: string; employeeCode: string; deviceUserId: string | null }[];
  selectedEmployeeId: string | null;
  period: string;
  periodLabels: { current: string; previous: string };
}) {
  const { set, pending } = useParamSetter();
  return (
    <div className={cn("flex flex-wrap gap-2 transition-opacity", pending && "opacity-60")}>
      {employees.length > 0 && (
        <NativeSelect
          aria-label="Employee"
          className="h-8 w-56 text-xs"
          value={selectedEmployeeId ?? ""}
          onChange={(e) => set("employee", e.target.value)}
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName} ({e.deviceUserId ?? e.employeeCode})
            </option>
          ))}
        </NativeSelect>
      )}
      <NativeSelect aria-label="Metric" className="h-8 w-40 text-xs" defaultValue="worked">
        <option value="worked">Total worked hours</option>
      </NativeSelect>
      <NativeSelect aria-label="Period" className="h-8 w-40 text-xs" value={period} onChange={(e) => set("period", e.target.value)}>
        <option value="current">Current month ({periodLabels.current})</option>
        <option value="previous">Previous month ({periodLabels.previous})</option>
      </NativeSelect>
    </div>
  );
}
