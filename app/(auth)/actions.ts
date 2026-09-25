"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@platform/auth";
import { prisma } from "@platform/db";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) redirect(`/login?error=${encodeURIComponent("Unknown demo user")}`);
  await createSession(user.id);
  redirect("/");
}

export async function signOutAction() {
  await destroySession();
  redirect("/login");
}
