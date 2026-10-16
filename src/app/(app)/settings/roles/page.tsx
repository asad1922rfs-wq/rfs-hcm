import { requirePagePermission } from "@/server/auth/session";
import { listRoles } from "@/server/services/users";
import { PERMISSIONS } from "@/server/auth/permissions";
import { PageHeader } from "@/components/common";
import { RoleEditor, type PermissionRow } from "./role-editor";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requirePagePermission("role.manage", "all");
  const roles = await listRoles();
  const permissions: PermissionRow[] = Object.entries(PERMISSIONS).map(([key, def]) => ({ key, label: def.label, group: def.group, scopes: def.scopes }));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Roles & permissions"
        description="Permissions are enforced on the server for every request. Changes apply immediately to signed-in users."
      />
      <div className="grid gap-6">
        {roles.map((r) => (
          <RoleEditor
            key={r.id}
            readOnly={r.key === "SUPER_ADMIN"}
            permissions={permissions}
            role={{ id: r.id, name: r.name, description: r.description, permissions: r.permissions, isSystem: r.isSystem, userCount: r._count.users }}
          />
        ))}
      </div>
    </div>
  );
}
