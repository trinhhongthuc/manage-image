import { isAdminAuthenticated } from "@/lib/auth";
import { appendFolder, readAllRecords, readFolders, removeFolders, removeRecord } from "@/lib/github";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  try {
    const [folders, records] = await Promise.all([readFolders(), readAllRecords()]);
    const folderSet = new Set(folders);
    records.forEach((record) => {
      if (record.album?.trim()) folderSet.add(record.album.trim());
    });
    return Response.json({ folders: Array.from(folderSet).sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không thể tải folder.");
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  try {
    const body = (await request.json()) as { name?: unknown; parent?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parent = typeof body.parent === "string" ? body.parent.trim() : "";
    if (!name) return jsonError("Tên folder không được để trống.", 400);
    if (name.length > 80) return jsonError("Tên folder tối đa 80 ký tự.", 400);
    if (name.includes("/")) return jsonError("Tên folder không được chứa ký tự '/'.", 400);
    if (parent.includes("//") || parent.startsWith("/") || parent.endsWith("/")) {
      return jsonError("Đường dẫn folder không hợp lệ.", 400);
    }
    const folder = await appendFolder(parent ? `${parent}/${name}` : name);
    return Response.json({ ok: true, folder });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không thể tạo folder.");
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return jsonError("Chưa đăng nhập.", 401);
  try {
    const body = (await request.json()) as { folders?: unknown };
    const targets = Array.isArray(body.folders)
      ? body.folders.filter(
          (folder): folder is string =>
            typeof folder === "string" && folder.trim().length > 0,
        )
      : [];
    if (!targets.length) return jsonError("Thiếu folder cần xóa.", 400);

    const records = await readAllRecords();
    const recordsToRemove = records.filter((record) => {
      const album = record.album?.trim();
      return Boolean(
        album &&
          targets.some(
            (target) => album === target || album.startsWith(`${target}/`),
          ),
      );
    });
    const removedFolders = await removeFolders(targets);
    for (const record of recordsToRemove) await removeRecord(record.id);
    return Response.json({ ok: true, deletedFolders: removedFolders.length, deletedImages: recordsToRemove.length });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không thể xóa folder.");
  }
}
