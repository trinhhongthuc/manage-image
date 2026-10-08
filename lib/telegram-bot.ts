import { appendRecords, readAllRecords, readFolders, readGitHubJson, writeGitHubJson } from "@/lib/github";
import { telegramRequest } from "@/lib/telegram";
import type { ImageRecord } from "@/lib/types";

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

export function isTelegramImageDocument(document: { mime_type?: string; file_name?: string } | undefined) {
  const mimeType = (document?.mime_type ?? "").toLowerCase();
  const fileName = (document?.file_name ?? "").toLowerCase();
  return mimeType.startsWith("image/") || /(png|jpe?g|gif|webp|bmp)$/i.test(fileName);
}

function fallbackFilename(message: { document?: { file_name?: string }; photo?: Array<{ file_id?: string }> }) {
  const documentName = message.document?.file_name?.trim();
  if (documentName && documentName.length > 0) return documentName;
  if (message.photo && message.photo.length > 0) return `telegram_photo_${Date.now()}.jpg`;
  return `telegram_image_${Date.now()}.jpg`;
}

export function buildImageRecordFromMessage(message: any, selectedFolder: string): ImageRecord {
  const photo = Array.isArray(message?.photo) && message.photo.length > 0 ? message.photo[message.photo.length - 1] : undefined;
  const document = message?.document;
  const media = photo ?? document;
  const fallbackName = fallbackFilename(message);
  const fileName = document?.file_name?.trim() || (photo ? `telegram_photo_${Date.now()}.jpg` : fallbackName);
  const mimeType = document?.mime_type || (fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const uniqueId = media?.file_unique_id || `${message.chat?.id ?? "chat"}-${message.message_id ?? Date.now()}`;

  return {
    id: `img_${crypto.randomUUID()}`,
    filename: fileName,
    telegramFileId: media?.file_id ?? "",
    telegramFileUniqueId: uniqueId,
    telegramMessageId: Number(message?.message_id ?? 0),
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

export async function ensureNoDuplicate(record: ImageRecord) {
  const items = await readAllRecords();
  return items.some((item) => item.telegramFileUniqueId === record.telegramFileUniqueId);
}
