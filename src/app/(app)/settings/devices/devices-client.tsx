"use client";

import { useActionState, useState, useTransition } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { createAgentAction, resyncAction, setAgentActiveAction } from "./actions";

export function CreateAgentDialog({ serverUrl }: { serverUrl: string }) {
  const [state, action] = useActionState(createAgentAction, null);
  const created = state?.ok ? state.data : undefined;
  const config = created
    ? JSON.stringify(
        { serverUrl, agentId: created.id, agentSecret: created.secret, listenPort: 8081, listenHost: "0.0.0.0", allowedSerials: [], timezoneHours: 5, dataDir: "data" },
        null,
        2,
      )
    : "";
  return (
    <Dialog>
      <DialogTrigger asChild><Button>Create sync agent</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{created ? "Agent created" : "Create sync agent"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Save this as agent/config.json on the office PC. The secret is shown only once."
              : "An agent runs on an always-on office PC on the same network as the attendance machine."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="grid gap-3">
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{config}</pre>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => navigator.clipboard.writeText(config).then(() => toast.success("Copied"))}
            >
              <Copy className="size-4" /> Copy config.json
            </Button>
          </div>
        ) : (
          <form action={action} className="grid gap-4">
            {state && !state.ok && <FormMessage state={state} />}
            <Field label="Name" name="name" defaultValue="Office PC" required />
            <SubmitButton>Create agent</SubmitButton>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AgentToggle({ agentId, isActive }: { agentId: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (isActive && !confirm("Revoke this agent? It will no longer be able to send attendance.")) return;
          const r = await setAgentActiveAction(agentId, !isActive);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      {isActive ? "Revoke" : "Enable"}
    </Button>
  );
}

export function SyncNowButton({ deviceId, disabled }: { deviceId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const r = await resyncAction(deviceId);
          if (r.ok) {
            toast.success(r.message);
            setDone(true);
          } else toast.error(r.error);
        })
      }
    >
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> {done ? "Requested" : "Sync now"}
    </Button>
  );
}
