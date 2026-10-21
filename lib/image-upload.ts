import type { ImageRecord } from "@/lib/types";

const uploadApiUrl =
  process.env.IMAGE_UPLOAD_API_URL ?? "https://manage-image-be.onrender.com/upload";

type UploadApiResponse = {
  filename?: unknown;
  telegramMessageId?: unknown;
  telegramFileId?: unknown;
  url?: unknown;
  id?: unknown;
  mimeType?: unknown;
  size?: unknown;
  album?: unknown;
  createdAt?: unknown;
  items?: Array<{
    id?: unknown;
    filename?: unknown;
    telegramFileId?: unknown;
    telegramMessageId?: unknown;
    url?: unknown;
    size?: unknown;
    mimeType?: unknown;
    createdAt?: unknown;
    album?: unknown;
  }>;
  errors?: Array<{ filename: string; error: string }>;
  error?: unknown;
  message?: unknown;
};

/**
 * Upload toàn bộ danh sách files lên server NestJS trong 1 request duy nhất.
 * Server sẽ lưu tất cả files xuống đĩa trước, sau đó gửi Album lên Telegram.
 */
export async function uploadBulkToImageServer(
  files: File[],
  album?: string,
  isFast?: boolean,
): Promise<{ items: ImageRecord[]; errors: Array<{ filename: string; error: string }> }> {
  if (!files.length) {
    return { items: [], errors: [] };
  }

  const form = new FormData();
  if (album) form.append("album", album);
  if (isFast) form.append("fast", "true");

  for (const file of files) {
    form.append("files", file, file.name);
  }

  const response = await fetch(uploadApiUrl, {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  const responseText = await response.text();
  let payload: UploadApiResponse | undefined;

  try {
    payload = JSON.parse(responseText) as UploadApiResponse;
  } catch {
    if (!response.ok) {
      throw new Error(
        `Upload server thất bại (${response.status}): ${responseText || response.statusText}`,
      );
    }
    throw new Error("Upload server không trả về JSON hợp lệ.");
  }

  if (!response.ok && (!payload?.items || payload.items.length === 0)) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.message === "string"
          ? payload.message
          : `Upload server thất bại (${response.status}).`;
    throw new Error(message);
  }

  const rawItems = Array.isArray(payload?.items) && payload.items.length > 0
    ? payload.items
    : payload && payload.telegramFileId
      ? [payload]
      : [];

  const items: ImageRecord[] = [];
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const originalFile = files[i] || files.find((f) => f.name === item.filename);

    const telegramFileId =
      typeof item.telegramFileId === "string" ? item.telegramFileId : "";
    const telegramMessageId =
      typeof item.telegramMessageId === "number" && Number.isInteger(item.telegramMessageId)
        ? item.telegramMessageId
        : 0;

    let urlString = "";
    if (typeof item.url === "string" && item.url.trim()) {
      try {
        const parsedUrl = new URL(item.url);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
          urlString = parsedUrl.toString();
        }
      } catch {}
    }

    if (telegramFileId && telegramMessageId > 0 && urlString) {
      items.push({
        id: typeof item.id === "string" && item.id ? item.id : `img_${crypto.randomUUID()}`,
        filename:
          typeof item.filename === "string" && item.filename
            ? item.filename
            : originalFile?.name || `file_${i + 1}`,
        telegramFileId,
        telegramMessageId,
        url: urlString,
        size:
          typeof item.size === "number"
            ? item.size
            : originalFile?.size || 0,
        mimeType:
          typeof item.mimeType === "string"
            ? item.mimeType
            : originalFile?.type || "application/octet-stream",
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date().toISOString(),
        ...(album ? { album } : {}),
      });
    }
  }

  return { items, errors };
}

/**
 * Upload 1 file đơn lẻ (dành cho upload từ URL hoặc lẻ 1 file)
 */
export async function uploadToImageServer(
  file: File,
  album?: string,
): Promise<ImageRecord> {
  const result = await uploadBulkToImageServer([file], album);
  if (!result.items.length) {
    const errorMsg = result.errors[0]?.error || "Upload thất bại.";
    throw new Error(errorMsg);
  }
  return result.items[0];
}
