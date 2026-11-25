import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { toId } from "@/lib/form";

/**
 * Serves a student's photo to their own School Admin only. Row-Level
 * Security returns nothing for another school's student, so guessing ids
 * gives a 404.
 */
export async function GET(_req: Request, ctx: RouteContext<"/school/students/[id]/photo">) {
  const user = await requireSchoolAdmin();
  const studentId = toId((await ctx.params).id);
  if (!studentId) return new Response("Not found", { status: 404 });
  const photo = await schoolDb(user, (tx) =>
    tx.studentPhoto.findUnique({ where: { studentId }, select: { data: true, contentType: true } }),
  );
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      // The URL carries a version (?v=...), so the browser may keep it; never shared caches.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
