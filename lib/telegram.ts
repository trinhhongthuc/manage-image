import type { ImageRecord } from "@/lib/types";

const apiBase = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

function requireConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Thiếu cấu hình Telegram.");
  return { chatId };
}

async function telegram<T>(method: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}/${method}`, { ...init, cache: "no-store" });
  const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(payload.description ?? `Telegram ${method} thất bại.`);
  }
  return payload.result;
}

type TelegramMessage = {
  message_id: number;
  document?: { file_id: string; file_unique_id: string; file_size?: number; mime_type?: string };
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
};

type TelegramFile = { file_path: string };

export async function uploadToTelegram(file: File) {
  const { chatId } = requireConfig();
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("document", file, file.name);
  const message = await telegram<TelegramMessage>("sendDocument", { method: "POST", body: form });
  const document = message.document;
  if (!document) throw new Error("Telegram không trả về document metadata.");
  return { message, document };
}

export async function deleteTelegramMessage(messageId: number) {
  const { chatId } = requireConfig();
  await telegram<boolean>("deleteMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
}

export async function telegramFileUrl(fileId: string) {
  const file = await telegram<TelegramFile>("getFile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
}

export function recordFromTelegram(input: {
  id: string;
  file: File;
  message: TelegramMessage;
  document: { file_id: string; file_unique_id: string; file_size?: number; mime_type?: string };
}): ImageRecord {
  return {
    id: input.id,
    filename: input.file.name,
    telegramFileId: input.document.file_id,
    telegramFileUniqueId: input.document.file_unique_id,
    telegramMessageId: input.message.message_id,
    size: input.document.file_size ?? input.file.size,
    mimeType: input.document.mime_type ?? input.file.type,
    createdAt: new Date().toISOString(),
  };
}
