import { appendTelegramRecord } from "@/lib/github";
import {
  answerCallbackQuery,
  buildImageRecordFromMessage,
  buildSelectFolderMessage,
  canUserAccess,
  editTelegramText,
  getAvailableFolders,
  getSelectedFolder,
  isTelegramImageDocument,
  saveSelectedFolder,
  sendTelegramText,
} from "@/lib/telegram-bot";

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

type TelegramWebhookMedia = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
};

type TelegramWebhookMessage = {
  message_id: number;
  chat: { id: number };
  from?: { id: number };
  text?: string;
  photo?: TelegramWebhookMedia[];
  document?: TelegramWebhookMedia;
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: { id: number };
  message?: TelegramWebhookMessage;
};

type TelegramWebhookUpdate = {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramWebhookMessage;
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, { status });
}

function logProcessingError(stage: string, error: unknown) {
  console.error(`[Telegram] ${stage}`, {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

async function handleFolderSelection(callbackQuery: TelegramCallbackQuery) {
  const { id, data, from, message } = callbackQuery ?? {};
  if (!message || !data) return;

  const chatId = message.chat?.id;
  const userId = from?.id;
  if (!chatId || !userId) return;

  if (!canUserAccess(userId)) {
    await sendTelegramText(chatId, "🚫 Bạn không có quyền sử dụng bot này.");
    return;
  }

  if (data.startsWith("action:")) {
    const action = data.slice("action:".length);
    if (action === "folders") {
      const folders = await getAvailableFolders();
      if (!folders.length) {
        await sendTelegramText(chatId, "📁 Hiện chưa có folder nào trong metadata. Hãy tạo hoặc đồng bộ metadata trước.");
        return;
      }
      const replyMarkup = {
        inline_keyboard: folders.map((folder, index) => [{ text: `📁 ${folder}`, callback_data: `select_folder:${index}` }]),
      };
      await answerCallbackQuery(id, "📁 Open folder selector");
      await sendTelegramText(chatId, "📁 Select a destination folder", replyMarkup);
      return;
    }

    if (action === "folder") {
      const folder = await getSelectedFolder(chatId, userId);
      const keyboard = {
        inline_keyboard: [[{ text: "🔄 Change folder", callback_data: "action:folders" }]],
      };
      await answerCallbackQuery(id, "📁 Showing current folder");
      await sendTelegramText(
        chatId,
        folder ? `📁 Current folder:\n\n${folder}` : "📁 No folder selected yet. Run /folders to choose one.",
        keyboard,
      );
      return;
    }
  }

  if (data.startsWith("select_folder:")) {
    const index = Number.parseInt(data.slice("select_folder:".length), 10);
    const folders = await getAvailableFolders();
    const folder = folders[index];
    if (!folder) {
      await answerCallbackQuery(id, "❌ Folder selection is no longer valid.");
      return;
    }

    try {
      await saveSelectedFolder(chatId, userId, folder);
      await answerCallbackQuery(id, `✅ Folder selected successfully!\n\n📁 ${folder}`);
      await editTelegramText(
        chatId,
        message.message_id,
        `✅ Folder selected successfully!\n\n📁 ${folder}\n\nYou can now send images directly to this chat.`,
      );
    } catch (error) {
      console.error("[Telegram Folder Selection Error]", error);
      await answerCallbackQuery(id, "❌ Không thể lưu folder đã chọn.");
    }
  }
}

async function handleCommand(message: TelegramWebhookMessage) {
  const chatId = message.chat?.id;
  const userId = message.from?.id;
  if (!chatId || !userId) return;

  if (!canUserAccess(userId)) {
    await sendTelegramText(chatId, "🚫 Bạn không có quyền sử dụng bot này.");
    return;
  }

  const text = String(message.text ?? "").trim();
  if (!text.startsWith("/")) return;

  if (text === "/start") {
    await sendTelegramText(
      chatId,
      "Welcome to Image Storage Bot!\n\nChoose an action:",
      {
        inline_keyboard: [
          [{ text: "📁 Select a folder", callback_data: "action:folders" }],
          [{ text: "📁 View current folder", callback_data: "action:folder" }],
          [{ text: "📁 View available folders", callback_data: "action:folders" }],
        ],
      },
    );
    return;
  }

  if (text === "/help") {
    await sendTelegramText(
      chatId,
      "Commands:\n\n/folders - View available folders\n/folder - Show current selected folder\n/folder <path> - Select a folder by path\n/help - Show this help\n\nWorkflow:\n1. Choose a folder\n2. Drag/drop or send images to this chat\n3. The bot syncs metadata to GitHub.",
    );
    return;
  }

  if (text === "/folders") {
    const info = await buildSelectFolderMessage();
    await sendTelegramText(chatId, info.text, info.replyMarkup ? info.replyMarkup : undefined);
    return;
  }

  if (text.startsWith("/folder")) {
    const arg = text.replace(/^\/folder\s*/i, "").trim();
    if (!arg) {
      const currentFolder = await getSelectedFolder(chatId, userId);
      const keyboard = {
        inline_keyboard: [[{ text: "🔄 Change folder", callback_data: "action:folders" }]],
      };
      await sendTelegramText(
        chatId,
        currentFolder ? `📁 Current folder:\n\n${currentFolder}` : "📁 No folder selected yet. Run /folders to choose one.",
        keyboard,
      );
      return;
    }

    const folders = await getAvailableFolders();
    if (!folders.includes(arg)) {
      await sendTelegramText(chatId, `❌ Folder "${arg}" does not exist in the GitHub metadata.\n\nPlease choose one from /folders.`);
      return;
    }

    await saveSelectedFolder(chatId, userId, arg);
    await sendTelegramText(chatId, `✅ Folder selected successfully!\n\n📁 ${arg}`);
    return;
  }
}

async function handleIncomingMedia(message: TelegramWebhookMessage) {
  const chatId = message.chat?.id;
  const userId = message.from?.id;
  if (!chatId || !userId) return;

  const photo = Array.isArray(message.photo) && message.photo.length > 0 ? message.photo.at(-1) : undefined;
  const document = message.document;
  const isImageDocument = Boolean(document && isTelegramImageDocument(document));
  console.info("[Telegram] Message contains image media", {
    containsPhoto: Boolean(photo),
    containsImageDocument: isImageDocument,
  });

  if (!photo && !isImageDocument) {
    console.info("[Telegram] Ignoring unsupported document or message");
    return;
  }

  console.info("[Telegram] Telegram user/chat ID", { userId, chatId });

  if (!canUserAccess(userId)) {
    await sendTelegramText(chatId, "🚫 Bạn không có quyền sử dụng bot này.");
    return;
  }

  let savedRecord: ReturnType<typeof buildImageRecordFromMessage> | undefined;
  let savedFolder: string | undefined;
  try {
    const media = photo ?? document;
    const fileUniqueId = media?.file_unique_id;
    if (typeof fileUniqueId !== "string" || !fileUniqueId) {
      throw new Error("Telegram image is missing file_unique_id.");
    }
    console.info("[Telegram] File unique ID", { fileUniqueId });

    const selectedFolder = await getSelectedFolder(chatId, userId);
    console.info("[Telegram] Current album", { album: selectedFolder });
    if (!selectedFolder) {
      await sendTelegramText(chatId, "❌ Please select a folder first using /folders.");
      return;
    }

    console.info("[Telegram] Reading GitHub metadata");
    const result = await appendTelegramRecord(fileUniqueId, () => {
      console.info("[Telegram] Creating metadata");
      const record = buildImageRecordFromMessage(message, selectedFolder);
      console.info("[GitHub] Updating metadata");
      return record;
    }, (existingCount, duplicate) => {
      console.info("[Telegram] Existing metadata count", { count: existingCount });
      console.info("[Telegram] Duplicate check", { duplicate });
    });
    if (!result.added) {
      await sendTelegramText(chatId, `⚠️ This image already exists in GitHub metadata.\n\n📁 Folder: ${selectedFolder}`);
      return;
    }

    const record = result.record;
    if (!record) throw new Error("GitHub metadata write succeeded without returning the record.");
    console.info("[GitHub] Update successful", { id: record.id, album: selectedFolder });
    savedRecord = record;
    savedFolder = selectedFolder;
  } catch (error) {
    logProcessingError("Image processing failed", error);
    try {
      await sendTelegramText(chatId, "❌ Failed to save image metadata.\n\nPlease try again.");
    } catch (notificationError) {
      logProcessingError("Failed to send image processing failure notification", notificationError);
    }
    return;
  }

  if (savedRecord && savedFolder) {
    try {
      await sendTelegramText(
        chatId,
        `✅ Image saved\n\n📁 Folder: ${savedFolder}\n🖼️ File: ${savedRecord.filename}`,
      );
      console.info("[Telegram] Image saved successfully", {
        fileUniqueId: savedRecord.telegramFileUniqueId,
        album: savedFolder,
        filename: savedRecord.filename,
      });
    } catch (error) {
      logProcessingError("Metadata saved but Telegram success notification failed", error);
    }
  }
}

export async function POST(request: Request) {
  const token = request.headers.get("x-telegram-bot-api-secret-token");
  if (!WEBHOOK_SECRET) {
    console.error("[Telegram Webhook] TELEGRAM_WEBHOOK_SECRET is not configured.");
    return jsonResponse({ ok: false, error: "Webhook secret is not configured." }, 500);
  }
  if (token !== WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  }

  try {
    console.info("[Telegram] Webhook received");
    const update = (await request.json()) as TelegramWebhookUpdate;
    if (!update || typeof update !== "object") return jsonResponse({ ok: true });

    console.info("[Telegram] Update type", {
      type: update.callback_query ? "callback_query" : update.message ? "message" : "unsupported",
    });
    if (update.callback_query) {
      await handleFolderSelection(update.callback_query);
      return jsonResponse({ ok: true });
    }

    if (update.message) {
      const text = typeof update.message.text === "string" ? update.message.text : "";
      if (text.startsWith("/")) {
        await handleCommand(update.message);
      } else if (update.message.photo || update.message.document) {
        await handleIncomingMedia(update.message);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("[Telegram Webhook Error]", error);
    return jsonResponse({ ok: false, error: "Invalid webhook payload." }, 400);
  }
}

export async function GET() {
  return jsonResponse({ ok: true, status: "telegram webhook ready" });
}
