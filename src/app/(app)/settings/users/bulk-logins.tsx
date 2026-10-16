"use client";

import { useState, useTransition } from "react";
import { Download, Loader2, Printer, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BulkLogin } from "@/server/services/users";
import { bulkCreateLoginsAction } from "../actions";

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function printSlips(rows: BulkLogin[], appUrl: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return toast.error("Allow pop-ups to print.");
  w.document.write(`<!doctype html><html><head><title>RFS HCM login slips</title><style>
    body{font-family:Arial,sans-serif;margin:24px;color:#111} .slip{border:1px dashed #888;padding:12px 16px;margin:0 0 12px;break-inside:avoid}
    h1{font-size:16px} .k{color:#555;font-size:12px} .v{font-size:15px;font-family:Consolas,monospace}
  </style></head><body><h1>RFS HCM — temporary login details (confidential)</h1>
  ${rows.map((r) => `<div class="slip"><strong>${escape(r.fullName)}</strong> (${escape(r.employeeCode)})<br>
    <span class="k">Sign in at</span> <span class="v">${escape(appUrl)}</span><br>
    <span class="k">Employee ID</span> <span class="v">${escape(r.login)}</span> &nbsp; <span class="k">Temporary password</span> <span class="v">${escape(r.temporaryPassword)}</span><br>
    <span class="k">You will be asked to choose your own password at first sign-in.</span></div>`).join("")}
  </body></html>`);
  w.document.close();
  w.print();
}

function downloadCsv(rows: BulkLogin[]) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = ["Employee ID,Name,Login,Email,Role,Temporary password", ...rows.map((r) => [r.employeeCode, r.fullName, r.login, r.email ?? "", r.role, r.temporaryPassword].map(q).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "rfs-hcm-temporary-logins.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkLoginsDialog({ count, appUrl }: { count: number; appUrl: string }) {
  const [rows, setRows] = useState<BulkLogin[] | null>(null);
  const [pending, start] = useTransition();
  if (count === 0 && !rows) return null;

  return (
    <Dialog onOpenChange={(open) => !open && setRows(null)}>
      <DialogTrigger asChild>
        <Button variant="outline"><Users className="size-4" /> Create logins for {count} employee{count === 1 ? "" : "s"}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{rows ? `${rows.length} logins created` : "Create logins in bulk"}</DialogTitle>
          <DialogDescription>
            {rows
              ? "These temporary passwords are shown only now. Print the slips or download the list, hand them out privately, then delete the file."
              : "Each active employee without a login gets one: sign-in with Employee ID (or email), a random temporary password that must be changed at first sign-in, and the Manager role if they have direct reports, otherwise Employee."}
          </DialogDescription>
        </DialogHeader>
        {rows ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => printSlips(rows, appUrl)}><Printer className="size-4" /> Print slips</Button>
              <Button variant="outline" onClick={() => downloadCsv(rows)}><Download className="size-4" /> Download CSV</Button>
            </div>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Employee</TableHead><TableHead>Login</TableHead><TableHead>Role</TableHead><TableHead>Temporary password</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.employeeCode}>
                      <TableCell>{r.fullName}</TableCell>
                      <TableCell className="font-mono text-xs">{r.login}{r.email ? <span className="block text-muted-foreground">{r.email}</span> : null}</TableCell>
                      <TableCell>{r.role}</TableCell>
                      <TableCell className="font-mono">{r.temporaryPassword}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <Button
            className="w-fit"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await bulkCreateLoginsAction();
                if (r.ok && r.data) setRows(r.data);
                else if (!r.ok) toast.error(r.error);
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Create {count} logins
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
