import { requirePagePermission } from "@/server/auth/session";
import { listDevicesAndAgents, ONLINE_WINDOW_MS } from "@/server/services/devices";
import { appUrl } from "@/lib/env";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { formatDateTime } from "@/lib/format";
import { RecordDialog } from "../record-dialog";
import { updateDeviceAction } from "./actions";
import { AgentToggle, CreateAgentDialog, SyncNowButton } from "./devices-client";

export const metadata = { title: "Biometric devices" };
export const dynamic = "force-dynamic";

function Status({ lastSeenAt, active = true }: { lastSeenAt: Date | null; active?: boolean }) {
  if (!active) return <Badge variant="outline">Disabled</Badge>;
  if (!lastSeenAt) return <Badge variant="outline">Never connected</Badge>;
  const online = Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
  return online ? <Badge className="bg-success text-white">Online</Badge> : <Badge variant="destructive">Offline</Badge>;
}

export default async function DevicesPage() {
  await requirePagePermission("device.manage", "all");
  const { agents, devices, commands } = await listDevicesAndAgents();

  return (
    <>
      <PageHeader
        title="Biometric devices"
        description="ZKTeco machines push attendance (ADMS) to a sync agent on the office network, which forwards it here over HTTPS."
        actions={<CreateAgentDialog serverUrl={appUrl()} />}
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sync agents</CardTitle>
            <CardDescription>Programs running in the office. Each has its own secret and can be revoked.</CardDescription>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <EmptyState title="No sync agent yet" description="Create one, then install it on an always-on office PC (see agent/README.md)." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Last contact</TableHead>
                    <TableHead className="hidden md:table-cell">Waiting to send</TableHead><TableHead className="hidden lg:table-cell">Version</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <span className="block font-medium">{a.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{a.id}</span>
                      </TableCell>
                      <TableCell><Status lastSeenAt={a.lastSeenAt} active={a.isActive} /></TableCell>
                      <TableCell className="hidden md:table-cell">{formatDateTime(a.lastSeenAt)}</TableCell>
                      <TableCell className="hidden md:table-cell tabular-nums">{a.outboxCount ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">{a.version ?? "—"}</TableCell>
                      <TableCell className="text-right"><AgentToggle agentId={a.id} isActive={a.isActive} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attendance machines</CardTitle>
            <CardDescription>Machines appear here automatically the first time they connect to an agent.</CardDescription>
          </CardHeader>
          <CardContent>
            {devices.length === 0 ? (
              <EmptyState
                title="No machine connected yet"
                description="On the MB460: Menu → Comm → Cloud Server Settings → Server Mode ADMS, Server Address = the agent PC's IP, Port 8081, HTTPS off."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Last contact</TableHead>
                    <TableHead className="hidden md:table-cell">Last punch</TableHead><TableHead className="hidden lg:table-cell">Agent</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <span className="block font-medium">{d.name ?? d.model ?? "ZKTeco device"}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {d.serialNumber}{d.firmware ? ` · ${d.firmware}` : ""}{d.pushVersion ? ` · push ${d.pushVersion}` : ""}
                        </span>
                      </TableCell>
                      <TableCell><Status lastSeenAt={d.lastSeenAt} active={d.isActive} /></TableCell>
                      <TableCell className="hidden md:table-cell">{formatDateTime(d.lastSeenAt)}</TableCell>
                      <TableCell className="hidden md:table-cell">{formatDateTime(d.lastPunchAt)}</TableCell>
                      <TableCell className="hidden lg:table-cell">{d.agent?.name ?? "—"}</TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap text-right">
                        <SyncNowButton deviceId={d.id} disabled={!d.isActive} />
                        <RecordDialog
                          title="Device settings"
                          description="A disabled device's punches are ignored."
                          trigger="Edit"
                          triggerVariant="ghost"
                          action={updateDeviceAction.bind(null, d.id)}
                          fields={[
                            { kind: "text", name: "name", label: "Name", defaultValue: d.name ?? "", hint: "e.g. Main entrance" },
                            { kind: "checkbox", name: "isActive", label: "Accept punches from this device", defaultChecked: d.isActive },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {commands.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Recent sync requests</CardTitle></CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {commands.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2">
                    <span>{formatDateTime(c.createdAt)} · {c.deviceSerial}</span>
                    <span className="text-muted-foreground">{c.status}{c.result ? ` · ${c.result}` : ""}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
