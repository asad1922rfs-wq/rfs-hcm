"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, RefreshCw, Send, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/server/errors";
import { approveAction, markPaidAction, recalculateAction, rejectAction, submitAction } from "../actions";

type Props = {
  runId: string;
  status: string;
  canPrepare: boolean;
  canApprove: boolean;
  submittedByMe: boolean;
  warningsCount: number;
};

function ActionButton({ label, icon: Icon, run, confirmText, variant }: {
  label: string; icon: React.ComponentType<{ className?: string }>; run: () => Promise<ActionResult>; confirmText?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() => {
        if (confirmText && !confirm(confirmText)) return;
        start(async () => {
          const r = await run();
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />} {label}
    </Button>
  );
}

export function WorkflowBar({ runId, status, canPrepare, canApprove, submittedByMe, warningsCount }: Props) {
  const [note, setNote] = useState("");
  const [rejecting, startReject] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && canPrepare && (
        <>
          <ActionButton label="Recalculate" icon={RefreshCw} variant="outline" run={() => recalculateAction(runId)} />
          <ActionButton
            label="Submit to Finance"
            icon={Send}
            run={() => submitAction(runId)}
            confirmText={`Submit this payroll for approval?${warningsCount ? `\n\n${warningsCount} employee(s) have warnings — review them first.` : ""}`}
          />
        </>
      )}
      {status === "SUBMITTED" && canApprove && !submittedByMe && (
        <>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline"><Undo2 className="size-4" /> Send back</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send payroll back to HR</DialogTitle>
                <DialogDescription>It returns to draft so HR can correct it and submit again.</DialogDescription>
              </DialogHeader>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to change?" rows={4} />
              <Button
                disabled={rejecting || note.trim().length < 3}
                onClick={() =>
                  startReject(async () => {
                    const r = await rejectAction(runId, note);
                    if (r.ok) {
                      toast.success(r.message);
                      setOpen(false);
                    } else toast.error(r.error);
                  })
                }
              >
                {rejecting && <Loader2 className="size-4 animate-spin" />} Send back
              </Button>
            </DialogContent>
          </Dialog>
          <ActionButton
            label="Approve & lock"
            icon={CheckCircle2}
            run={() => approveAction(runId)}
            confirmText="Approve this payroll? It will be locked: later attendance or salary changes will not alter it."
          />
        </>
      )}
      {status === "SUBMITTED" && canApprove && submittedByMe && (
        <p className="text-sm text-muted-foreground">You submitted this payroll — another Finance user must approve it.</p>
      )}
      {status === "APPROVED" && canApprove && (
        <ActionButton label="Mark as paid" icon={Wallet} run={() => markPaidAction(runId)} confirmText="Confirm salaries for this month have been paid?" />
      )}
    </div>
  );
}
