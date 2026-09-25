import { prisma } from "../platform/db";
import { allPermissions } from "../platform/registry";

/**
 * Roles are data, permissions are code. The seed reconciles the code-declared
 * permission set into the database, then maps roles onto it.
 */
const ROLES: { key: string; description: string; permissions: string[] | "*" }[] = [
  { key: "admin", description: "Platform administrator", permissions: "*" },
  {
    key: "kyc_viewer",
    description: "Read-only access to the KYC queue",
    permissions: ["kyc.app.view"],
  },
  {
    key: "kyc_reviewer",
    description: "Reviews standard-risk KYC cases",
    permissions: ["kyc.app.view", "kyc.case.claim", "kyc.case.decide"],
  },
  {
    key: "kyc_senior_reviewer",
    description: "Reviews and approves high-risk KYC cases",
    permissions: ["kyc.app.view", "kyc.case.claim", "kyc.case.decide", "kyc.case.approve.high_risk"],
  },
  {
    key: "flags_editor",
    description: "Manages feature flags in dev and staging only",
    permissions: ["flags.app.view", "flags.flag.create", "flags.write.nonprod"],
  },
  {
    key: "flags_admin",
    description: "Manages feature flags in all environments including production",
    permissions: ["flags.app.view", "flags.flag.create", "flags.write.nonprod", "flags.write.prod"],
  },
  { key: "auditor", description: "Read-only access to the platform audit log", permissions: ["admin.audit.view"] },
];

const USERS: { email: string; name: string; roles: string[] }[] = [
  { email: "avery.admin@example.com", name: "Avery Admin", roles: ["admin"] },
  { email: "riley.reviewer@example.com", name: "Riley Reviewer", roles: ["kyc_reviewer"] },
  { email: "sam.senior@example.com", name: "Sam Senior", roles: ["kyc_senior_reviewer"] },
  { email: "quinn.viewer@example.com", name: "Quinn Viewer", roles: ["kyc_viewer", "auditor"] },
  { email: "eli.editor@example.com", name: "Eli Editor", roles: ["flags_editor"] },
  { email: "fran.flagadmin@example.com", name: "Fran FlagAdmin", roles: ["flags_admin"] },
];

export async function seedCore() {
  const declared = allPermissions();
  for (const p of declared) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { app: p.app },
      create: { key: p.key, app: p.app },
    });
  }

  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { key: r.key },
      update: { description: r.description },
      create: { key: r.key, description: r.description },
    });
    const keys = r.permissions === "*" ? declared.map((p) => p.key) : r.permissions;
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name },
      create: { email: u.email, name: u.name },
    });
    const roles = await prisma.role.findMany({ where: { key: { in: u.roles } } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.createMany({
      data: roles.map((r) => ({ userId: user.id, roleId: r.id })),
      skipDuplicates: true,
    });
  }
  console.log(`seeded ${declared.length} permissions, ${ROLES.length} roles, ${USERS.length} users`);
}
