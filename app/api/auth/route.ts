import { sessionCookie, sessionValue } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured)
    return Response.json(
      { error: "ADMIN_PASSWORD chưa được cấu hình." },
      { status: 503 },
    );
  const body = (await request.json()) as { password?: unknown };
  if (body.password !== configured)
    return Response.json({ error: "Mật khẩu không đúng." }, { status: 401 });
  const cookieStore = await cookies();
  cookieStore.set(sessionCookie(sessionValue(configured)));
  return Response.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete("manage-image-session");
  return Response.json({ ok: true });
}
