import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/constants";

export default async function AppHomePage() {
  const session = await requireSession();
  redirect(ROLE_HOME[session.profile.role]);
}
