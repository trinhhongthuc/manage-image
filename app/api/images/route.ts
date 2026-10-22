import { isAdminAuthenticated } from "@/lib/auth";
import {
  appendRecords,
  readAllRecords,
  removeRecord,
  updateRecord,
} from "@/lib/github";
import { uploadToImageServer, uploadBulkToImageServer } from "@/lib/image-upload";
import {
  deleteTelegramMessage,
  recordFromTelegram,
  sleep,
  uploadToTelegram,
} from "@/lib/telegram";
import type { ImageRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const imageMetadataApiUrl =
  process.env.IMAGE_METADATA_API_URL ??
  "https://manage-image-be.onrender.com/upload";

function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

function isImageRecord(value: unknown): value is ImageRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.trim().length > 0 &&
    typeof record.filename === "string" &&
    record.filename.trim().length > 0 &&
    typeof record.telegramFileId === "string" &&
    record.telegramFileId.trim().length > 0 &&
    typeof record.telegramFileUniqueId === "string" &&
    record.telegramFileUniqueId.trim().length > 0 &&
    typeof record.telegramMessageId === "number" &&
    Number.isInteger(record.telegramMessageId) &&
    record.telegramMessageId > 0 &&
    typeof record.size === "number" &&
    Number.isFinite(record.size) &&
    record.size >= 0 &&
    typeof record.mimeType === "string" &&
    record.mimeType.trim().length > 0 &&
    typeof record.createdAt === "string" &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    (record.album === undefined || typeof record.album === "string") &&
    (record.url === undefined || typeof record.url === "string") &&
    (record.width === undefined ||
      (typeof record.width === "number" && Number.isFinite(record.width))) &&
    (record.height === undefined ||
      (typeof record.height === "number" && Number.isFinite(record.height))) &&
    (record.tags === undefined ||
      (Array.isArray(record.tags) &&
        record.tags.every((tag) => typeof tag === "string")))
  );
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

  const operation = new URL(request.url).searchParams.get("operation");
  if (operation === "upload-telegram") {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const uploadIds = form
      .getAll("uploadIds")
      .filter((value): value is string => typeof value === "string");
    const album = String(form.get("album") ?? "").trim();

    if (!files.length) return jsonError("Không có file.", 400);
    if (files.length > 20) return jsonError("Mỗi request tối đa 20 file.", 400);
    if (
      uploadIds.length !== files.length ||
      uploadIds.some((id) => !id.trim()) ||
      new Set(uploadIds).size !== uploadIds.length
    ) {
      return jsonError("Danh sách uploadIds không hợp lệ.", 400);
    }
    if (
      files.some(
        (file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"),
      )
    ) {
      return jsonError("Chỉ chấp nhận file ảnh hoặc video.", 400);
    }
    if (files.some((file) => file.size > MAX_FILE_SIZE)) {
      return jsonError("Mỗi file tối đa 50 MB.", 413);
    }

    const items: Array<{ uploadId: string; record: ImageRecord }> = [];
    const errors: Array<{ uploadId: string; filename: string; error: string }> = [];

    for (let i = 0; i < files.length; i++) {
      if (i > 0) await sleep(900);
      const file = files[i];
      const uploadId = uploadIds[i];

      try {
        const telegram = await uploadToTelegram(file);
        const record = recordFromTelegram({
          id: `img_${crypto.randomUUID()}`,
          file,
          ...telegram,
        });
        items.push({
          uploadId,
          record: {
            ...record,
            ...(album ? { album } : {}),
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload thất bại.";
        console.error(`[Upload Error] File "${file.name}":`, message);
        errors.push({ uploadId, filename: file.name, error: message });
      }
    }

    return Response.json({ items, errors });
  }

  if (operation === "save-metadata") {
    let body: { items?: unknown };
    try {
      body = (await request.json()) as { items?: unknown };
    } catch {
      return jsonError("Metadata không phải JSON hợp lệ.", 400);
    }
    if (
      !Array.isArray(body.items) ||
      body.items.length === 0 ||
      body.items.length > 20 ||
      !body.items.every(isImageRecord)
    ) {
      return jsonError("Danh sách metadata không hợp lệ (yêu cầu 1-20 ảnh).", 400);
    }

    const records: ImageRecord[] = body.items.map((value) => {
      const record = value as Record<string, unknown>;
      return {
        id: record.id as string,
        filename: record.filename as string,
        telegramFileId: record.telegramFileId as string,
        telegramFileUniqueId: record.telegramFileUniqueId as string,
        telegramMessageId: record.telegramMessageId as number,
        size: record.size as number,
        mimeType: record.mimeType as string,
        createdAt: record.createdAt as string,
        ...(typeof record.album === "string" ? { album: record.album } : {album: "Bi/SX"}),
        ...(typeof record.url === "string" ? { url: record.url } : {}),
        ...(typeof record.width === "number" ? { width: record.width } : {}),
        ...(typeof record.height === "number" ? { height: record.height } : {}),
        ...(Array.isArray(record.tags) ? { tags: record.tags as string[] } : {}),
      };
    });

    const requestId = crypto.randomUUID();
    try {
      console.info("[Metadata Server] Forwarding metadata", {
        requestId,
        endpoint: imageMetadataApiUrl,
        itemCount: records.length,
      });

      const response = await fetch(imageMetadataApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: records }),
        cache: "no-store",
      });
      console.info("[Metadata Server] Response received", {
        requestId,
        status: response.status,
        contentType: response.headers.get("content-type"),
      });

      const responseText = await response.text();
      let result: unknown;
      try {
        result = JSON.parse(responseText);
      } catch {
        if (!response.ok) {
          console.error("[Metadata Server Error] Non-JSON error response", {
            requestId,
            status: response.status,
          });
          return Response.json(
            {
              error: `Metadata server thất bại (${response.status}).`,
              upstreamStatus: response.status,
              requestId,
            },
            { status: 502 },
          );
        }
        result = undefined;
      }

      if (!response.ok) {
        const message =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : result &&
                typeof result === "object" &&
                "message" in result &&
                typeof result.message === "string"
              ? result.message
            : `Metadata server thất bại (${response.status}).`;
        console.error("[Metadata Server Error]", { requestId, message });
        return Response.json(
          { error: message, upstreamStatus: response.status, requestId },
          { status: 502 },
        );
      }

      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        result.ok === false
      ) {
        console.error(
          "[Metadata Server Error] Server returned ok:false with successful HTTP status",
          { requestId, upstreamStatus: response.status },
        );
        return Response.json(
          {
            error: "Metadata server báo lưu metadata thất bại.",
            upstreamStatus: response.status,
            requestId,
          },
          { status: 502 },
        );
      }

      try {
        await appendRecords(records);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "lỗi không xác định";
        console.error("[GitHub Shard Error] Metadata server upload succeeded", {
          requestId,
          message,
        });
        return Response.json(
          {
            error: `Metadata server đã lưu nhưng không thể lưu vào gallery: ${message}`,
            requestId,
          },
          { status: 502 },
        );
      }

      return Response.json({
        ok: true,
        items: records,
        upstreamStatus: response.status,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "lỗi không xác định";
      console.error("[Metadata Server] Request failed before receiving response", {
        requestId,
        endpoint: imageMetadataApiUrl,
        message,
      });
      return Response.json(
        {
          error: `Không thể kết nối metadata server: ${message}`,
          requestId,
        },
        { status: 502 },
      );
    }
  }

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
      const album =
        typeof body.album === "string" ? body.album.trim() : undefined;
      const record = await uploadToImageServer(file, album);

      await appendRecords([record]);
      return Response.json({ items: [record], errors: [] });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Upload từ URL thất bại.", 500);
    }
  }

  // 2. Upload via multipart/form-data
  const form = await request.formData();
  const album = String(form.get("album") ?? "").trim();
  const uploadMode = form.get("uploadMode") === "direct" ? "direct" : "server";
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (!files.length) return jsonError("Không có file.", 400);
  if (files.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
    return jsonError("Chỉ chấp nhận file ảnh hoặc video.", 400);
  }
  if (files.some((file) => file.size > MAX_FILE_SIZE)) return jsonError("Mỗi file tối đa 50 MB.", 413);

  if (uploadMode === "direct") {
    const records: ImageRecord[] = [];
    const errors: Array<{ filename: string; error: string }> = [];

    for (let i = 0; i < files.length; i++) {
      if (i > 0) await sleep(900);
      const file = files[i];

      try {
        const telegram = await uploadToTelegram(file);
        records.push({
          ...recordFromTelegram({
            id: `img_${crypto.randomUUID()}`,
            file,
            ...telegram,
          }),
          ...(album ? { album } : {}),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload thất bại.";
        console.error(`[Upload Error] File "${file.name}":`, message);
        errors.push({ filename: file.name, error: message });
      }
    }

    if (records.length) {
      try {
        await appendRecords(records);
      } catch (error) {
        console.error("[GitHub Shard Error]:", error);
        return jsonError(
          `Telegram đã nhận ảnh nhưng GitHub chưa lưu metadata: ${error instanceof Error ? error.message : "lỗi không xác định"}`,
          502,
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
      { status: isCompleteFailure ? 502 : 200 },
    );
  }

  // Gửi toàn bộ danh sách files sang server NestJS trong 1 request duy nhất
  // Server sẽ lưu hết xuống đĩa trước, sau đó gửi Album lên Telegram
  const { items: records, errors } = await uploadBulkToImageServer(
    files,
    album || undefined,
  );

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
