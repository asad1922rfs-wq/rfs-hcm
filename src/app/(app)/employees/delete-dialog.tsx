"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deleteEmployeesAction } from "./actions";

/**
 * Permanent delete with typed confirmation: the employee code for one employee, "DELETE <n>" for several.
 */
export function DeleteEmployeesDialog({
  employees, trigger, redirectTo, onDone,
}: {
  employees: { id: string; fullName: string; employeeCode: string }[];
  trigger?: React.ReactNode;
  redirectTo?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const expected = employees.length === 1 ? employees[0]!.employeeCode : `DELETE ${employees.length}`;
  const matches = typed.trim().toUpperCase() === expected.toUpperCase();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline" className="text-destructive hover:text-destructive"><Trash2 className="size-4" /> Delete</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {employees.length === 1 ? employees[0]!.fullName : `${employees.length} employees`} permanently?</DialogTitle>
          <DialogDescription>
            This removes the profile, login, salary, bank details and attendance history and cannot be undone. Raw machine punches are kept.
            If the person has left the company, use <strong>Deactivate / exit</strong> instead to keep their records.
          </DialogDescription>
        </DialogHeader>
        {employees.length > 1 && (
          <ul className="max-h-40 overflow-y-auto rounded-md border p-2 text-sm">
            {employees.map((e) => <li key={e.id}>{e.fullName} <span className="text-muted-foreground">({e.employeeCode})</span></li>)}
          </ul>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-delete">Type <span className="font-mono font-semibold">{expected}</span> to confirm</Label>
          <Input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        <Button
          variant="destructive"
          disabled={!matches || pending}
          onClick={() =>
            start(async () => {
              const r = await deleteEmployeesAction(employees.map((e) => e.id), typed);
              if (!r.ok) return void toast.error(r.error);
              toast.success(`Deleted ${r.data?.deleted ?? 0} employee${r.data?.deleted === 1 ? "" : "s"}.`);
              setOpen(false);
              onDone?.();
              if (redirectTo) router.push(redirectTo);
              else router.refresh();
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" />} Delete permanently
        </Button>
      </DialogContent>
    </Dialog>
  );
}
