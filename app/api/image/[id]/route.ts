import { isAdminAuthenticated } from "@/lib/auth";
import { findRecord } from "@/lib/github";
import { telegramFileUrl } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const { id } = await params;
  const record = await findRecord(id);
  if (!record) return Response.json({ error: "Không tìm thấy ảnh." }, { status: 404 });
  const response = await fetch(await telegramFileUrl(record.telegramFileId), { cache: "no-store" });
  if (!response.ok || !response.body) return Response.json({ error: "Telegram không còn phục vụ file." }, { status: 502 });
  return new Response(response.body, { headers: { "Content-Type": record.mimeType, "Cache-Control": "private, max-age=3600" } });
}
