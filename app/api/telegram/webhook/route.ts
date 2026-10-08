import { appendRecords, readAllRecords } from "@/lib/github";
import {
  answerCallbackQuery,
  buildImageRecordFromMessage,
  buildSelectFolderMessage,
  canUserAccess,
  editTelegramText,
  ensureNoDuplicate,
  getAvailableFolders,
  getSelectedFolder,
  isTelegramImageDocument,
  saveSelectedFolder,
  sendTelegramText,
} from "@/lib/telegram-bot";
import { telegramRequest } from "@/lib/telegram";

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, { status });
}

async function handleFolderSelection(callbackQuery: any) {
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

async function handleCommand(message: any) {
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

async function handleIncomingMedia(message: any) {
  const chatId = message.chat?.id;
  const userId = message.from?.id;
  if (!chatId || !userId) return;

  if (!canUserAccess(userId)) {
    await sendTelegramText(chatId, "🚫 Bạn không có quyền sử dụng bot này.");
    return;
  }

  const photo = Array.isArray(message.photo) && message.photo.length > 0 ? message.photo[message.photo.length - 1] : undefined;
  const document = message.document;
  const media = photo ?? document;
  if (!media) return;

  if (document && !isTelegramImageDocument(document)) return;

  const selectedFolder = await getSelectedFolder(chatId, userId);
  if (!selectedFolder) {
    await sendTelegramText(chatId, "📁 No folder selected yet. Please run /folders and choose a destination folder before sending images.");
    return;
  }

  const record = buildImageRecordFromMessage(message, selectedFolder);
  const alreadyExists = await ensureNoDuplicate(record);
  if (alreadyExists) {
    await sendTelegramText(chatId, `⚠️ This image has already been synced to GitHub.\n\n📁 ${selectedFolder}`);
    return;
  }

  try {
    await appendRecords([record]);
    await sendTelegramText(
      chatId,
      `✅ Image saved successfully!\n\n📁 Folder: ${selectedFolder}\n\n🖼 File: ${record.filename}`,
    );
  } catch (error) {
    console.error("[Telegram Sync Error]", error);
    await sendTelegramText(chatId, `❌ Unable to save image metadata to GitHub.\n\n${error instanceof Error ? error.message : "Unknown error"}`);
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
    const update = await request.json();
    if (!update || typeof update !== "object") return jsonResponse({ ok: true });

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
