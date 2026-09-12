import { isAdminAuthenticated } from "@/lib/auth";
import { appendRecords, readAllRecords, removeRecord } from "@/lib/github";
import { deleteTelegramMessage, recordFromTelegram, uploadToTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

function sortRecords(items: Awaited<ReturnType<typeof readAllRecords>>, sort: string) {
  return [...items].sort((a, b) => {
    if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
    if (sort === "name") return a.filename.localeCompare(b.filename);
    if (sort === "size") return b.size - a.size;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const type = (url.searchParams.get("type") ?? "").toLowerCase();
    let items = await readAllRecords();
    if (query) items = items.filter((item) => item.filename.toLowerCase().includes(query));
    if (type) items = items.filter((item) => item.mimeType.toLowerCase().includes(type));
    items = sortRecords(items, url.searchParams.get("sort") ?? "newest");
    const start = (page - 1) * limit;
    return Response.json({ items: items.slice(start, start + limit), page, limit, total: items.length, hasNextPage: start + limit < items.length });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không thể tải metadata.");
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (!files.length) return jsonError("Không có file.", 400);
  if (files.some((file) => !file.type.startsWith("image/"))) return jsonError("Chỉ chấp nhận file ảnh.", 400);
  if (files.some((file) => file.size > MAX_FILE_SIZE)) return jsonError("Mỗi ảnh tối đa 50 MB.", 413);

  const records = [];
  const errors: Array<{ filename: string; error: string }> = [];
  for (const file of files) {
    try {
      const telegram = await uploadToTelegram(file);
      records.push(recordFromTelegram({ id: `img_${crypto.randomUUID()}`, file, ...telegram }));
    } catch (error) {
      errors.push({ filename: file.name, error: error instanceof Error ? error.message : "Upload thất bại." });
    }
  }
  if (records.length) {
    try {
      await appendRecords(records);
    } catch (error) {
      return jsonError(`Telegram đã nhận ảnh nhưng GitHub chưa lưu metadata: ${error instanceof Error ? error.message : "lỗi không xác định"}`, 502);
    }
  }
  return Response.json({ items: records, errors }, { status: errors.length && !records.length ? 502 : 200 });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  try {
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id !== "string") return jsonError("Thiếu id.", 400);
    const record = (await readAllRecords()).find((item) => item.id === body.id);
    if (!record) return jsonError("Không tìm thấy ảnh.", 404);
    await deleteTelegramMessage(record.telegramMessageId);
    await removeRecord(record.id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không thể xóa ảnh.");
  }
}
