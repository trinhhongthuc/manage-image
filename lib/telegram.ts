import type { ImageRecord } from "@/lib/types";

const apiBase = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requireConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Thiếu cấu hình Telegram.");
  return { chatId };
}

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

async function telegram<T>(method: string, init?: RequestInit, retryCount = 0): Promise<T> {
  const response = await fetch(`${apiBase()}/${method}`, { ...init, cache: "no-store" });
  const payload = (await response.json()) as TelegramResponse<T>;

  // Handle group upgraded to supergroup with new chat_id
  if (payload.parameters?.migrate_to_chat_id) {
    const newChatId = String(payload.parameters.migrate_to_chat_id);
    console.warn(`[Telegram Migration] Group nâng cấp sang supergroup chat ID mới: ${newChatId}`);
    process.env.TELEGRAM_CHAT_ID = newChatId;
    if (retryCount < 2 && init?.body) {
      if (typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body);
          parsed.chat_id = newChatId;
          init.body = JSON.stringify(parsed);
        } catch {}
      } else if (typeof FormData !== "undefined" && init.body instanceof FormData) {
        init.body.set("chat_id", newChatId);
      }
      return telegram<T>(method, init, retryCount + 1);
    }
  }

  // Handle Telegram 429 Too Many Requests with adaptive backoff
  if (response.status === 429 || payload.error_code === 429) {
    const retryAfter = payload.parameters?.retry_after ?? 1;
    if (retryCount < 3) {
      console.warn(
        `[Telegram 429] Vượt ngưỡng rate limit. Tạm dừng ${retryAfter}s theo yêu cầu Telegram (thử lại ${retryCount + 1}/3)...`
      );
      await sleep(retryAfter * 1000 + 250);
      return telegram<T>(method, init, retryCount + 1);
    }
    throw new Error(`Telegram giới hạn tần suất (429): Vui lòng thử lại sau ${retryAfter} giây.`);
  }

  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(payload.description ?? `Telegram ${method} thất bại.`);
  }
  return payload.result;
}

type TelegramMedia = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
};

type TelegramMessage = {
  message_id: number;
  document?: TelegramMedia;
  video?: TelegramMedia;
  animation?: TelegramMedia;
  audio?: TelegramMedia;
  photo?: TelegramMedia[];
};

type TelegramFile = { file_path: string };

export async function uploadToTelegram(file: File) {
  const { chatId } = requireConfig();
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("document", file, file.name);
  const message = await telegram<TelegramMessage>("sendDocument", { method: "POST", body: form });
  const media =
    message.document ??
    message.video ??
    message.animation ??
    message.audio ??
    (Array.isArray(message.photo) && message.photo.length > 0
      ? message.photo[message.photo.length - 1]
      : undefined);
  if (!media) {
    console.error("[Telegram Upload Missing Media]:", JSON.stringify(message));
    throw new Error("Telegram không trả về document/video metadata.");
  }
  return { message, document: media };
}

export async function deleteTelegramMessage(messageId: number) {
  const { chatId } = requireConfig();
  await telegram<boolean>("deleteMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
}

const filePathCache = new Map<string, { url: string; expiresAt: number }>();

export async function telegramFileUrl(fileId: string) {
  const cached = filePathCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  const file = await telegram<TelegramFile>("getFile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  // Cache for 50 minutes (Telegram file_path is valid for at least 1 hour)
  filePathCache.set(fileId, { url, expiresAt: Date.now() + 50 * 60 * 1000 });
  return url;
}

function guessMimeType(filename: string, fallback?: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    default:
      return fallback && fallback !== "application/octet-stream"
        ? fallback
        : "application/octet-stream";
  }
}

export function recordFromTelegram(input: {
  id: string;
  file: File;
  message: TelegramMessage;
  document: TelegramMedia;
}): ImageRecord {
  const rawMime = input.document.mime_type || input.file.type;
  const resolvedMime =
    rawMime && rawMime !== "application/octet-stream"
      ? rawMime
      : guessMimeType(input.file.name, rawMime);

  return {
    id: input.id,
    filename: input.file.name,
    telegramFileId: input.document.file_id,
    telegramFileUniqueId: input.document.file_unique_id,
    telegramMessageId: input.message.message_id,
    width: input.document.width,
    height: input.document.height,
    size: input.document.file_size ?? input.file.size,
    mimeType: resolvedMime,
    createdAt: new Date().toISOString(),
  };
}
