import { createHash } from "node:crypto";
import { readAllRecords, readFolders, readGitHubJson, writeGitHubJson } from "@/lib/github";
import type { ImageRecord } from "@/lib/types";
import { telegramRequest } from "@/lib/telegram";

export const TELEGRAM_STATE_PATH = "config/telegram-state.json";

const DEFAULT_STATE = { users: {} as Record<string, { currentAlbum?: string; updatedAt?: string; chatId?: string }> };

export type TelegramBotState = typeof DEFAULT_STATE;

function normalizeFolder(folder: string | null | undefined) {
  return typeof folder === "string" ? folder.trim() : "";
}

export async function getTelegramState(): Promise<TelegramBotState> {
  const { value } = await readGitHubJson<TelegramBotState>(TELEGRAM_STATE_PATH, DEFAULT_STATE);
  const nextState = value && typeof value === "object" ? value : DEFAULT_STATE;
  nextState.users ??= {};
  return nextState;
}

export function telegramUserKey(chatId: string | number, userId: string | number) {
  return `${String(chatId)}:${String(userId)}`;
}

export async function getAvailableFolders() {
  const [folders, records] = await Promise.all([readFolders(), readAllRecords()]);
  const seen = new Set<string>();
  for (const folder of folders) {
    const normalized = normalizeFolder(folder);
    if (normalized) seen.add(normalized);
  }
  for (const record of records) {
    const normalized = normalizeFolder(record.album);
    if (normalized) seen.add(normalized);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

async function ensureFolderExists(folder: string) {
  const folders = await getAvailableFolders();
  return folders.includes(folder);
}

export async function getSelectedFolder(chatId: string | number, userId: string | number) {
  const state = await getTelegramState();
  const key = telegramUserKey(chatId, userId);
  const direct = state.users[key] ?? state.users[String(userId)] ?? state.users[`${String(userId)}:${String(chatId)}`];
  const folder = normalizeFolder(direct?.currentAlbum);
  if (!folder) return null;
  return (await ensureFolderExists(folder)) ? folder : null;
}

export async function saveSelectedFolder(chatId: string | number, userId: string | number, folder: string) {
  const selected = normalizeFolder(folder);
  if (!selected) throw new Error("Folder không hợp lệ.");
  const folders = await getAvailableFolders();
  if (!folders.includes(selected)) {
    throw new Error("Folder không còn tồn tại trong GitHub metadata.");
  }

  const state = await getTelegramState();
  const key = telegramUserKey(chatId, userId);
  state.users[key] = {
    chatId: String(chatId),
    currentAlbum: selected,
    updatedAt: new Date().toISOString(),
  };
  const existing = await readGitHubJson<TelegramBotState>(TELEGRAM_STATE_PATH, DEFAULT_STATE);
  await writeGitHubJson(
    TELEGRAM_STATE_PATH,
    { ...state, users: { ...state.users } },
    `chore(telegram): update folder for ${key}`,
    existing.sha,
  );

  return selected;
}

export function isTelegramImageDocument(document: { mime_type?: string } | undefined) {
  const mimeType = (document?.mime_type ?? "").toLowerCase();
  return mimeType.startsWith("image/");
}

type TelegramImageMedia = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
};

type TelegramImageMessage = {
  message_id: number;
  photo?: TelegramImageMedia[];
  document?: TelegramImageMedia;
};

function telegramImageRecordId(fileUniqueId: string) {
  const bytes = createHash("sha256").update(fileUniqueId).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return `img_${uuid}`;
}

export function buildImageRecordFromMessage(message: TelegramImageMessage, selectedFolder: string): ImageRecord {
  const photo = message.photo?.at(-1);
  const document = message.document;
  const media = photo ?? document;
  if (!media?.file_id || !media.file_unique_id) {
    throw new Error("Telegram image is missing its file identifiers.");
  }
  const fileName = document?.file_name?.trim() || `telegram_${media.file_unique_id}.jpg`;
  const mimeType = document?.mime_type || "image/jpeg";

  return {
    id: telegramImageRecordId(media.file_unique_id),
    filename: fileName,
    telegramFileId: media.file_id,
    telegramFileUniqueId: media.file_unique_id,
    telegramMessageId: message.message_id,
    size: Number(media?.file_size ?? 0),
    mimeType,
    createdAt: new Date().toISOString(),
    album: selectedFolder,
  };
}

export async function sendTelegramText(chatId: string | number, text: string, replyMarkup?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    chat_id: String(chatId),
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };
  return telegramRequest<{ ok: boolean; result?: unknown }>("sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function editTelegramText(chatId: string | number, messageId: number, text: string) {
  return telegramRequest<{ ok: boolean }>("editMessageText", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: String(chatId),
      message_id: messageId,
      text,
    }),
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text: string) {
  return telegramRequest<{ ok: boolean }>("answerCallbackQuery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export function buildFolderKeyboard(folders: string[]) {
  return {
    inline_keyboard: folders.map((folder, index) => [{ text: `📁 ${folder}`, callback_data: `select_folder:${index}` }]),
  };
}

export async function buildSelectFolderMessage() {
  const folders = await getAvailableFolders();
  if (!folders.length) {
    return {
      text: "📁 No folders are available yet.\n\nCreate or sync metadata in GitHub before selecting a folder.",
      replyMarkup: undefined,
    };
  }
  return {
    text: "📁 Select a destination folder",
    replyMarkup: buildFolderKeyboard(folders),
  };
}

export function canUserAccess(userId?: number | string) {
  const allowed = process.env.TELEGRAM_ALLOWED_USER_ID;
  if (!allowed || allowed === "") return true;
  if (!userId && userId !== 0) return false;
  return String(userId) === String(allowed);
}
