import { isAdminAuthenticated } from "@/lib/auth";
import { appendRecords, readAllRecords, removeRecord, updateRecord } from "@/lib/github";
import { deleteTelegramMessage, recordFromTelegram, sleep, uploadToTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
    const isExport = url.searchParams.get("export") === "true";
    let items = await readAllRecords();

    // Export all records backup
    if (isExport) {
      return Response.json({
        vault: "manage-image",
        exportedAt: new Date().toISOString(),
        total: items.length,
        items,
      });
    }

    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const type = (url.searchParams.get("type") ?? "").toLowerCase();
    const tag = (url.searchParams.get("tag") ?? "").trim().toLowerCase();
    const album = (url.searchParams.get("folder") ?? "").trim();
    const dateFrom = url.searchParams.get("from");
    const dateTo = url.searchParams.get("to");

    if (query) items = items.filter((item) => item.filename.toLowerCase().includes(query));
    if (type) items = items.filter((item) => item.mimeType.toLowerCase().includes(type));
    if (tag) items = items.filter((item) => (item.tags ?? []).some((t) => t.toLowerCase() === tag));
    if (album) {
      items = items.filter((item) => item.album === album);
    } else {
      items = items.filter((item) => !item.album?.trim());
    }
    if (dateFrom) items = items.filter((item) => item.createdAt.slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter((item) => item.createdAt.slice(0, 10) <= dateTo);

    items = sortRecords(items, url.searchParams.get("sort") ?? "newest");
    const start = (page - 1) * limit;
    return Response.json({
      items: items.slice(start, start + limit),
      page,
      limit,
      total: items.length,
      hasNextPage: start + limit < items.length,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không thể tải metadata.");
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  try {
    const body = (await request.json()) as { id?: string; tags?: string[]; album?: string };
    if (!body.id) return jsonError("Thiếu id ảnh.", 400);

    const updated = await updateRecord(body.id, {
      ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
      ...(typeof body.album === "string" ? { album: body.album } : {}),
    });

    if (!updated) return jsonError("Không tìm thấy ảnh.", 404);
    return Response.json({ ok: true, item: updated });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Cập nhật metadata thất bại.");
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);

  const contentType = request.headers.get("content-type") || "";

  // 1. Upload via image URL
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as { url?: string; filename?: string; album?: string };
      if (!body.url || typeof body.url !== "string") {
        return jsonError("Vui lòng cung cấp URL ảnh hợp lệ.", 400);
      }

      const fetchRes = await fetch(body.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!fetchRes.ok) {
        return jsonError(`Không thể tải ảnh từ URL (${fetchRes.status}): ${fetchRes.statusText}`, 400);
      }

      const mimeType = fetchRes.headers.get("content-type") || "image/jpeg";
      if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
        return jsonError(`URL không phải là file ảnh hoặc video hợp lệ (định dạng: ${mimeType}).`, 400);
      }

      const arrayBuf = await fetchRes.arrayBuffer();
      if (arrayBuf.byteLength > MAX_FILE_SIZE) {
        return jsonError("Kích thước file vượt quá 50 MB.", 413);
      }

      let filename = body.filename?.trim();
      if (!filename) {
        try {
          const parsedUrl = new URL(body.url);
          filename = parsedUrl.pathname.split("/").pop()?.split("?")[0];
        } catch {
          filename = `url_media_${Date.now()}`;
        }
      }
      if (!filename || !filename.includes(".")) {
        const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg").split(";")[0] || "jpg";
        filename = `${filename || `url_media_${Date.now()}`}.${ext}`;
      }

      const file = new File([arrayBuf], filename, { type: mimeType });
      const telegram = await uploadToTelegram(file);
      const record = {
        ...recordFromTelegram({ id: `img_${crypto.randomUUID()}`, file, ...telegram }),
        ...(typeof body.album === "string" && body.album.trim() ? { album: body.album.trim() } : {}),
      };

      await appendRecords([record]);
      return Response.json({ items: [record], errors: [] });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Upload từ URL thất bại.", 500);
    }
  }

  // 2. Upload via multipart/form-data
  const form = await request.formData();
  const album = String(form.get("album") ?? "").trim();
  const isFastUpload = form.get("fast") === "true";
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (!files.length) return jsonError("Không có file.", 400);
  if (files.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
    return jsonError("Chỉ chấp nhận file ảnh hoặc video.", 400);
  }
  if (files.some((file) => file.size > MAX_FILE_SIZE)) return jsonError("Mỗi file tối đa 50 MB.", 413);

  // Process files sequentially with 900ms delay to respect Telegram's 1 msg/sec per-chat rate limit
  const DELAY_BETWEEN_FILES_MS = isFastUpload ? 0 : 900;
  const records = [];
  const errors: Array<{ filename: string; error: string }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (i > 0 && DELAY_BETWEEN_FILES_MS > 0) {
      await sleep(DELAY_BETWEEN_FILES_MS);
    }
    try {
      const telegram = await uploadToTelegram(file);
      records.push({
        ...recordFromTelegram({ id: `img_${crypto.randomUUID()}`, file, ...telegram }),
        ...(album ? { album } : {}),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Upload thất bại.";
      console.error(`[Upload Error] File "${file.name}":`, msg);
      errors.push({
        filename: file.name,
        error: msg,
      });
    }
  }

  if (records.length) {
    try {
      await appendRecords(records);
    } catch (error) {
      console.error("[GitHub Shard Error]:", error);
      return jsonError(
        `Telegram đã nhận ảnh nhưng GitHub chưa lưu metadata: ${error instanceof Error ? error.message : "lỗi không xác định"}`,
        502
      );
    }
  }

  const isCompleteFailure = errors.length > 0 && records.length === 0;
  return Response.json(
    {
      items: records,
      errors,
      error: isCompleteFailure ? errors[0]?.error || "Upload thất bại." : undefined,
    },
    { status: isCompleteFailure ? 502 : 200 }
  );
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  try {
    const body = (await request.json()) as { id?: unknown; ids?: unknown };
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((item): item is string => typeof item === "string")
      : typeof body.id === "string"
      ? [body.id]
      : [];

    if (!ids.length) return jsonError("Thiếu id hoặc danh sách ids cần xóa.", 400);

    const allRecords = await readAllRecords();
    const recordsToDelete = allRecords.filter((item) => ids.includes(item.id));
    if (!recordsToDelete.length) return jsonError("Không tìm thấy ảnh cần xóa.", 404);

    const errors: Array<{ id: string; error: string }> = [];
    for (const record of recordsToDelete) {
      try {
        await deleteTelegramMessage(record.telegramMessageId);
      } catch (err) {
        console.error(`Không thể xóa message Telegram #${record.telegramMessageId}:`, err);
      }

      try {
        await removeRecord(record.id);
      } catch (err) {
        errors.push({ id: record.id, error: err instanceof Error ? err.message : "Lỗi xóa metadata" });
      }
    }

    return Response.json({
      ok: true,
      deletedCount: recordsToDelete.length - errors.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không thể xóa ảnh.");
  }
}
