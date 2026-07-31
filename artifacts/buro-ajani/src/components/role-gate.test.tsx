import { render,screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach,describe,expect,it,vi } from "vitest";

const state = vi.hoisted(() => ({ role: "agent" }));

vi.mock("@/components/workspace-user", () => ({
  useWorkspaceUser: () => ({ user: { role: state.role } }),
}));
vi.mock("@/components/access-denied", () => ({
  AccessDenied: () => <div>access-denied</div>,
}));

import { RoleGate } from "@/components/role-gate";

const protectedContent = <div>protected-content</div>;
const renderGate = (allowedRoles: readonly ("super_admin" | "administrateur" | "agent" | "lecture_seule")[], children: ReactNode = protectedContent) =>
  render(<RoleGate allowedRoles={allowedRoles}>{children}</RoleGate>);

describe("RoleGate", () => {
  beforeEach(() => { state.role = "agent"; });

  it("renders protected content for an allowed role", () => {
    state.role = "administrateur";
    renderGate(["super_admin", "administrateur"]);
    expect(screen.getByText("protected-content")).toBeInTheDocument();
  });

  it.each(["agent", "lecture_seule"])("denies the %s role on administrator routes", (role) => {
    state.role = role;
    renderGate(["super_admin", "administrateur"]);
    expect(screen.getByText("access-denied")).toBeInTheDocument();
  });

  it("denies administrators on super-admin routes", () => {
    state.role = "administrateur";
    renderGate(["super_admin"]);
    expect(screen.getByText("access-denied")).toBeInTheDocument();
  });
});