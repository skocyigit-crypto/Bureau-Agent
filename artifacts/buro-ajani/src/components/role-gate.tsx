import { AccessDenied } from "@/components/access-denied";
import { useWorkspaceUser,type UserRole } from "@/components/workspace-user";
import type { ReactNode } from "react";

export function RoleGate({
  allowedRoles,
  children,
}: {
  allowedRoles: readonly UserRole[];
  children: ReactNode;
}) {
  const { user } = useWorkspaceUser();

  if (!allowedRoles.includes(user.role)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}