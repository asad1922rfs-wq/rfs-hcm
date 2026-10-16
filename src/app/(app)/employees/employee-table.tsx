"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize, StatusBadge } from "@/components/common";
import { initials } from "@/lib/utils";
import { DeleteEmployeesDialog } from "./delete-dialog";

export type EmployeeTableRow = {
  id: string; employeeCode: string; fullName: string; department: string | null; designation: string | null;
  joined: string; employmentType: string; status: string;
};

export function EmployeeTable({ rows, canDelete, selfId }: { rows: EmployeeTableRow[]; canDelete: boolean; selfId: string | null }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = rows.filter((r) => r.id !== selfId);
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const allChecked = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      {canDelete && chosen.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
          <span><strong>{chosen.length}</strong> selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          <DeleteEmployeesDialog
            employees={chosen}
            onDone={() => setSelected(new Set())}
            trigger={<Button size="sm" variant="destructive"><Trash2 className="size-4" /> Delete selected</Button>}
          />
        </div>
      )}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(selectable.map((r) => r.id)))}
                  />
                </TableHead>
              )}
              <TableHead>Employee</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead className="hidden lg:table-cell">Designation</TableHead>
              <TableHead className="hidden lg:table-cell">Joined</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id} data-state={selected.has(e.id) ? "selected" : undefined}>
                {canDelete && (
                  <TableCell>
                    {e.id !== selfId && <input type="checkbox" aria-label={`Select ${e.fullName}`} checked={selected.has(e.id)} onChange={() => toggle(e.id)} />}
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/employees/${e.id}`} className="flex items-center gap-3">
                    <Avatar className="size-8"><AvatarFallback className="text-xs">{initials(e.fullName)}</AvatarFallback></Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-medium hover:underline">{e.fullName}</span>
                      <span className="block text-xs text-muted-foreground">{e.employeeCode}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">{e.department ?? "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">{e.designation ?? "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">{e.joined}</TableCell>
                <TableCell className="hidden sm:table-cell">{humanize(e.employmentType)}</TableCell>
                <TableCell><StatusBadge status={e.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
