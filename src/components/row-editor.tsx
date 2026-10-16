"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Column = { key: string; label: string; type?: string; placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] };

/**
 * Editable list of rows posted as repeated fields: `<prefix>.<key>` (read on the server with formRows()).
 */
export function RowEditor({
  prefix, columns, initial = [], addLabel, max = 10,
}: {
  prefix: string;
  columns: Column[];
  initial?: Record<string, string>[];
  addLabel: string;
  max?: number;
}) {
  const [rows, setRows] = useState(() => initial.map((r, i) => ({ id: i, values: r })));
  const [nextId, setNextId] = useState(initial.length);

  return (
    <div className="grid gap-3">
      {rows.map((row, index) => (
        <div key={row.id} className="grid items-end gap-3 sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))_auto]" style={{ "--cols": columns.length } as React.CSSProperties}>
          {columns.map((c) => (
            <div key={c.key} className="grid gap-1.5">
              <Label htmlFor={`${prefix}-${row.id}-${c.key}`} className={index > 0 ? "sm:sr-only" : undefined}>{c.label}</Label>
              <Input
                id={`${prefix}-${row.id}-${c.key}`}
                name={`${prefix}.${c.key}`}
                type={c.type ?? "text"}
                inputMode={c.inputMode}
                placeholder={c.placeholder}
                defaultValue={row.values[c.key] ?? ""}
                step={c.type === "number" ? "0.01" : undefined}
                min={c.type === "number" ? 0 : undefined}
              />
            </div>
          ))}
          <Button type="button" variant="ghost" size="icon" aria-label="Remove row" onClick={() => setRows((r) => r.filter((x) => x.id !== row.id))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      {rows.length < max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            setRows((r) => [...r, { id: nextId, values: {} }]);
            setNextId((n) => n + 1);
          }}
        >
          <Plus className="size-4" /> {addLabel}
        </Button>
      )}
    </div>
  );
}
