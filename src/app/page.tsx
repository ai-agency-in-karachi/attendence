import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";

/** The site root sends people to the right place. */
export default function Home() {
  return (
    <Suspense fallback={null}>
      <RedirectToHome />
    </Suspense>
  );
}

async function RedirectToHome(): Promise<null> {
  const user = await getCurrentUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
