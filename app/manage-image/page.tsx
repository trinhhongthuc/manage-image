"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ImagePage, ImageRecord } from "@/lib/types";
import { ManageHeader, UploadDropzone, UploadQueueBanner } from "./components";

const TAB_SESSION_KEY = "manage-image-tab-session";

const emptyPage: ImagePage = {
  items: [],
  page: 1,
  limit: 50,
  total: 0,
  hasNextPage: false,
};
type UploadItem = {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "success" | "failed";
  error?: string;
};

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function displayFolderName(folder: string) {
  return folder.split("/").pop() ?? folder;
}

export default function ManageImagePage() {
  const [data, setData] = useState<ImagePage>(emptyPage);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isUploadingUrl, setIsUploadingUrl] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Filters
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [type, setType] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState("");

  // Selected image for Lightbox
  const [selected, setSelected] = useState<ImageRecord | null>(null);

  // Grid row columns: 1, 2, 4, 8
  const [columns, setColumns] = useState<1 | 2 | 4 | 8>(4);
  const [viewMode, setViewMode] = useState<"list" | "thumbnail" | "icon">(
    "list",
  );
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);

  // Selection mode & batch delete
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [showConfirmDeleteSelected, setShowConfirmDeleteSelected] =
    useState(false);
  const [showConfirmDeleteAll, setShowConfirmDeleteAll] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pagination limit: 50, 100, 200, 500
  const [limit, setLimit] = useState<number>(50);

  // Theme: dark / light
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Dashboard & backup modal
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Lightbox pro tools
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const loadRequestRef = useRef(0);
  const filmstripContainerRef = useRef<HTMLDivElement | null>(null);
  const [isSlideshow, setIsSlideshow] = useState<boolean>(false);
  const [showFilmstrip, setShowFilmstrip] = useState<boolean>(true);
  const [showCopyMenu, setShowCopyMenu] = useState<boolean>(false);
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");
  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 2600);
  }

  function openFolder(folder: string) {
    setSelectedIds(new Set());
    setSelectedFolders(new Set());
    setIsSelectMode(false);
    setData(emptyPage);
    setCurrentFolder(folder);

    const url = new URL(window.location.href);
    if (folder) url.searchParams.set("folder", folder);
    else url.searchParams.delete("folder");
    window.history.pushState({}, "", url);
  }

  function toggleSelectFolder(folder: string) {
    setSelectedFolders((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || isCreatingFolder) return;
    if (name.includes("/")) {
      setFolderError("Tên folder không được chứa ký tự '/'.");
      return;
    }

    setIsCreatingFolder(true);
    setFolderError("");
    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent: currentFolder }),
      });
      const result = (await response.json()) as {
        folder?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Không thể tạo thư mục.");
      }
      const savedFolder = result.folder ?? name;
      setFolders((current) =>
        current.some((folder) => folder.toLowerCase() === savedFolder.toLowerCase())
          ? current
          : [...current, savedFolder].sort((a, b) => a.localeCompare(b)),
      );
      setFolderName("");
      setShowFolderModal(false);
      showToast(`✓ Đã tạo thư mục “${savedFolder}”`);
    } catch (reason) {
      setFolderError(
        reason instanceof Error ? reason.message : "Không thể tạo thư mục.",
      );
    } finally {
      setIsCreatingFolder(false);
    }
  }

  // Load theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem("vault_theme") as
      | "light"
      | "dark"
      | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    fetch("/api/folders", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { folders?: unknown };
        if (Array.isArray(result.folders)) {
          setFolders(result.folders.filter((folder): folder is string => typeof folder === "string"));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function syncFolderFromUrl() {
      setCurrentFolder(
        new URLSearchParams(window.location.search).get("folder") ?? "",
      );
    }

    syncFolderFromUrl();
    window.addEventListener("popstate", syncFolderFromUrl);
    return () => window.removeEventListener("popstate", syncFolderFromUrl);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("vault_theme", next);
  }

  // Back to Top scroll listener
  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > 320);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Ctrl + V Paste listener for instant clipboard uploading
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")
      ) {
        return;
      }
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (
          item.kind === "file" &&
          (item.type.startsWith("image/") || item.type.startsWith("video/"))
        ) {
          const blob = item.getAsFile();
          if (blob) {
            const ext =
              item.type.split("/")[1]?.replace("jpeg", "jpg") ||
              (item.type.startsWith("video/") ? "mp4" : "png");
            const timeStr = new Date()
              .toISOString()
              .replace(/[:.]/g, "-")
              .slice(0, 19);
            const file = new File([blob], `clipboard_${timeStr}.${ext}`, {
              type: item.type,
            });
            files.push(file);
          }
        }
      }
      if (files.length > 0) {
        addFiles(files);
        showToast(`✓ Đã nhận ${files.length} file từ Clipboard!`);
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  async function load(page = 1, currentLimit = limit) {
    setIsLoading(true);
    if (!sessionStorage.getItem(TAB_SESSION_KEY)) {
      window.location.href = "/";
      setIsLoading(false);
      return;
    }

    const params = new URLSearchParams({
      page: String(page),
      limit: String(currentLimit),
      sort,
    });
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    if (selectedTag) params.set("tag", selectedTag);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (currentFolder) params.set("folder", currentFolder);

    try {
      const requestId = ++loadRequestRef.current;
      const response = await fetch(`/api/images?${params}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.href = "/";
        return;
      }
      if (!response.ok) throw new Error("Không thể tải gallery.");
      const json = await response.json();
      if (requestId !== loadRequestRef.current) return;
      setData(json);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load(1, limit).catch((reason) =>
      setError(
        reason instanceof Error ? reason.message : "Không thể tải gallery.",
      ),
    );
  }, [sort, type, selectedTag, dateFrom, dateTo, currentFolder, limit]);

  // Lock body scroll when modals are open
  useEffect(() => {
    if (
      selected ||
      isUploadModalOpen ||
      showConfirmDeleteSelected ||
      showConfirmDeleteAll ||
      showShortcuts ||
      showDashboard
    ) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [
    selected,
    isUploadModalOpen,
    showConfirmDeleteSelected,
    showConfirmDeleteAll,
    showShortcuts,
    showDashboard,
  ]);

  const selectedIndex = selected
    ? data.items.findIndex((item) => item.id === selected.id)
    : -1;

  function handlePrev() {
    if (!data.items.length || selectedIndex === -1) return;
    const prevIndex =
      selectedIndex > 0 ? selectedIndex - 1 : data.items.length - 1;
    setSelected(data.items[prevIndex]);
    setZoom(1);
    setRotation(0);
  }

  function handleNext() {
    if (!data.items.length || selectedIndex === -1) return;
    const nextIndex =
      selectedIndex < data.items.length - 1 ? selectedIndex + 1 : 0;
    setSelected(data.items[nextIndex]);
    setZoom(1);
    setRotation(0);
  }

  // Slideshow timer
  useEffect(() => {
    if (!isSlideshow || !selected) return;
    const timer = setInterval(() => {
      handleNext();
    }, 3500);
    return () => clearInterval(timer);
  }, [isSlideshow, selected, selectedIndex, data.items]);

  // Scroll active filmstrip item to center when selected changes
  useEffect(() => {
    if (!selected || !showFilmstrip) return;
    const container = filmstripContainerRef.current;
    if (!container) return;
    const activeEl = container.querySelector(
      ".filmstrip-item.is-active",
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [selected?.id, showFilmstrip]);

  // Keyboard navigation & shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (showShortcuts && event.key === "Escape") {
        setShowShortcuts(false);
        return;
      }
      if (showDashboard && event.key === "Escape") {
        setShowDashboard(false);
        return;
      }
      if (!selected) {
        if (event.key === "?") setShowShortcuts((prev) => !prev);
        return;
      }

      if (event.key === "Escape") {
        setSelected(null);
        setIsSlideshow(false);
      } else if (event.key === "ArrowLeft") {
        handlePrev();
      } else if (event.key === "ArrowRight") {
        handleNext();
      } else if (event.key === " ") {
        event.preventDefault();
        setIsSlideshow((prev) => !prev);
      } else if (event.key === "+" || event.key === "=") {
        setZoom((z) => Math.min(3, Number((z + 0.5).toFixed(1))));
      } else if (event.key === "-") {
        setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))));
      } else if (event.key.toLowerCase() === "r") {
        setRotation((r) => (r + 90) % 360);
      } else if (event.key.toLowerCase() === "f") {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen();
        }
      } else if (event.key === "?") {
        setShowShortcuts((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected, selectedIndex, data.items, showShortcuts, showDashboard]);

  function addFiles(files: File[]) {
    const valid = files.filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (!valid.length) return;
    const newItems: UploadItem[] = valid.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      status: "pending",
    }));
    setUploads((current) => [...current, ...newItems]);
    setIsUploadModalOpen(true);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function removeUpload(id: string) {
    setUploads((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearCompleted() {
    setUploads((current) => {
      current
        .filter((item) => item.status === "success")
        .forEach((item) => URL.revokeObjectURL(item.preview));
      return current.filter((item) => item.status !== "success");
    });
  }

  function clearAll() {
    if (isUploading) return;
    uploads.forEach((item) => URL.revokeObjectURL(item.preview));
    setUploads([]);
    setIsUploadModalOpen(false);
  }

  // Preload adjacent high-res images in background for instantaneous (0ms) lightbox switching
  useEffect(() => {
    if (!selected || !data.items.length) return;
    const idx = data.items.findIndex((item) => item.id === selected.id);
    if (idx === -1) return;

    const urlsToPreload: string[] = [];
    if (idx + 1 < data.items.length)
      urlsToPreload.push(`/api/image/${data.items[idx + 1].id}`);
    if (idx - 1 >= 0)
      urlsToPreload.push(`/api/image/${data.items[idx - 1].id}`);

    for (const u of urlsToPreload) {
      const img = new Image();
      img.src = u;
    }
  }, [selected, data.items]);

  async function uploadFromUrl() {
    const cleanUrl = urlInput.trim();
    if (!cleanUrl || isUploadingUrl) return;
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      showToast("Vui lòng nhập link URL hợp lệ (bắt đầu bằng http/https)");
      return;
    }
    setIsUploadingUrl(true);
    try {
      showToast("Đang tải ảnh từ link URL lên Telegram...");
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cleanUrl,
          ...(currentFolder ? { album: currentFolder } : {}),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error ?? "Không thể tải ảnh từ URL");
      }
      setUrlInput("");
      setIsUploadModalOpen(false);
      showToast("✓ Đã lưu thành công ảnh từ URL với chất lượng gốc!");
      await load(1, limit);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Lỗi tải ảnh từ URL");
    } finally {
      setIsUploadingUrl(false);
    }
  }

  async function uploadAll(isFastUpload = false) {
    const pending = uploads.filter((item) => item.status === "pending");
    if (!pending.length || isUploading) return;
    setIsUploading(true);

    // Gom 5 ảnh trong cùng 1 request HTTP (server sẽ xử lý giãn cách 900ms để chống rate limit của Telegram)
    const BATCH_SIZE = isFastUpload ? pending.length : 5;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (i > 0 && !isFastUpload) {
        // Nghỉ 1000ms giữa các batch request để Telegram hồi phục hạn mức burst
        await new Promise((r) => setTimeout(r, 1000));
      }

      const batch = pending.slice(i, i + BATCH_SIZE);
      const batchIds = new Set(batch.map((b) => b.id));

      setUploads((current) =>
        current.map((item): UploadItem =>
          batchIds.has(item.id)
            ? { ...item, status: "uploading", error: undefined }
            : item,
        ),
      );

      const form = new FormData();
      if (currentFolder) form.append("album", currentFolder);
      if (isFastUpload) form.append("fast", "true");
      for (const item of batch) {
        // Giữ nguyên 100% chất lượng ảnh gốc, không nén
        form.append("files", item.file);
      }

      try {
        const response = await fetch("/api/images", {
          method: "POST",
          body: form,
        });
        const result = await response.json();

        if (!response.ok) {
          const serverErr =
            result.error ?? `Upload thất bại (${response.status})`;
          setUploads((current) =>
            current.map((item): UploadItem =>
              batchIds.has(item.id)
                ? { ...item, status: "failed", error: serverErr }
                : item,
            ),
          );
        } else {
          const failedMap = new Map(
            (result.errors ?? []).map(
              (err: { filename: string; error: string }) => [
                err.filename,
                err.error,
              ],
            ),
          );

          setUploads((current: UploadItem[]) =>
            current.map((item): UploadItem => {
              if (!batchIds.has(item.id)) return item;
              if (failedMap.has(item.file.name)) {
                return {
                  ...item,
                  status: "failed",
                  error: String(failedMap.get(item.file.name) || "Lỗi upload"),
                };
              }
              return { ...item, status: "success", error: undefined };
            }),
          );
        }
      } catch (reason) {
        const networkErr =
          reason instanceof Error ? reason.message : "Lỗi kết nối mạng";
        setUploads((current) =>
          current.map((item): UploadItem =>
            batchIds.has(item.id)
              ? { ...item, status: "failed", error: networkErr }
              : item,
          ),
        );
      }
    }

    setIsUploading(false);
    await load(1, limit);

    // Tự động dọn dẹp các ảnh đã tải thành công khỏi modal
    setUploads((current) => {
      const remainingFailed = current.filter(
        (item) => item.status === "failed",
      );
      const successful = current.filter((item) => item.status === "success");
      successful.forEach((item) => {
        if (item.preview) URL.revokeObjectURL(item.preview);
      });

      if (remainingFailed.length === 0) {
        setIsUploadModalOpen(false);
        showToast(
          "✓ Đã tải lên toàn bộ ảnh thành công với chất lượng gốc 100%!",
        );
        return [];
      } else {
        return remainingFailed;
      }
    });
  }

  async function deleteSingleImage(image: ImageRecord) {
    if (
      !window.confirm(
        `Xóa vĩnh viễn ảnh "${image.filename}" khỏi Telegram và thư viện?`,
      )
    )
      return;
    const response = await fetch("/api/images", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: image.id }),
    });
    if (!response.ok) {
      setError("Không thể xóa ảnh.");
      return;
    }

    if (data.items.length > 1 && selectedIndex !== -1) {
      const nextIdx =
        selectedIndex < data.items.length - 1
          ? selectedIndex + 1
          : selectedIndex - 1;
      if (nextIdx >= 0 && nextIdx < data.items.length) {
        setSelected(data.items[nextIdx]);
      } else {
        setSelected(null);
      }
    } else {
      setSelected(null);
    }

    showToast("✓ Đã xóa ảnh!");
    await load(data.page, limit);
  }

  // Delete selected images
  async function handleDeleteSelected() {
    if ((!selectedIds.size && !selectedFolders.size) || isDeleting) return;
    setIsDeleting(true);
    try {
      if (selectedFolders.size) {
        const folderResponse = await fetch("/api/folders", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folders: Array.from(selectedFolders) }),
        });
        if (!folderResponse.ok) {
          const result = await folderResponse.json();
          throw new Error(result.error ?? "Xóa folder thất bại.");
        }
      }
      if (selectedIds.size) {
        const response = await fetch("/api/images", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        });
        if (!response.ok) {
          const res = await response.json();
          throw new Error(res.error ?? "Xóa ảnh thất bại.");
        }
      }
      const totalSelected = selectedIds.size + selectedFolders.size;
      showToast(`✓ Đã xóa ${totalSelected} mục!`);
      if (selectedFolders.size) {
        setFolders((current) =>
          current.filter(
            (folder) =>
              !Array.from(selectedFolders).some(
                (target) =>
                  folder === target || folder.startsWith(`${target}/`),
              ),
          ),
        );
      }
      setSelectedIds(new Set());
      setSelectedFolders(new Set());
      setShowConfirmDeleteSelected(false);
      await load(data.page, limit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xóa ảnh thất bại.");
    } finally {
      setIsDeleting(false);
    }
  }

  // Delete all images in the repository
  async function handleDeleteAll() {
    if (!data.total || isDeleting) return;
    setIsDeleting(true);
    try {
      const allRes = await fetch(`/api/images?page=1&limit=500`, {
        cache: "no-store",
      });
      const allData = await allRes.json();
      const allIds = (allData.items ?? []).map((img: ImageRecord) => img.id);

      const response = await fetch("/api/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: allIds }),
      });
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error ?? "Xóa tất cả ảnh thất bại.");
      }
      showToast("✓ Đã xóa toàn bộ ảnh trong kho!");
      setSelectedIds(new Set());
      setShowConfirmDeleteAll(false);
      setIsSelectMode(false);
      await load(1, limit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xóa tất cả ảnh thất bại.");
    } finally {
      setIsDeleting(false);
    }
  }

  // Batch download selected images
  function handleDownloadSelected() {
    const itemsToDownload = data.items.filter((img) => selectedIds.has(img.id));
    if (!itemsToDownload.length) return;
    itemsToDownload.forEach((img, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `/api/image/${img.id}`;
        a.download = img.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 300);
    });
    showToast(`Đang tải xuống ${itemsToDownload.length} ảnh...`);
  }

  // 1-Click Metadata Export Backup
  async function handleExportBackup() {
    try {
      showToast("Đang tải dữ liệu sao lưu...");
      const res = await fetch("/api/images?export=true");
      if (!res.ok) throw new Error("Tải backup thất bại.");
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `manage-image-metadata-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast("✓ Đã tải file Backup Metadata JSON!");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Lỗi sao lưu");
    }
  }

  function handleCloseModal() {
    if (
      isUploading &&
      !window.confirm("Đang có ảnh đang tải lên. Bạn có chắc muốn đóng modal?")
    ) {
      return;
    }
    setIsUploadModalOpen(false);
  }

  function toggleSelectCard(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pendingCount = uploads.filter((u) => u.status === "pending").length;
  const uploadingCount = uploads.filter((u) => u.status === "uploading").length;
  const successCount = uploads.filter((u) => u.status === "success").length;
  const failedCount = uploads.filter((u) => u.status === "failed").length;
  const totalUploadSize = uploads.reduce((acc, cur) => acc + cur.file.size, 0);
  const progressPercent = uploads.length
    ? Math.round(((successCount + failedCount) / uploads.length) * 100)
    : 0;

  const totalPages = Math.max(1, Math.ceil(data.total / (data.limit || limit)));

  // Collect unique tags from currently loaded images for quick filter
  const allUniqueTags = Array.from(
    new Set(data.items.flatMap((item) => item.tags ?? [])),
  );
  const folderPrefix = currentFolder ? `${currentFolder}/` : "";
  const visibleFolders = folders.filter((folder) => {
    if (!folder.startsWith(folderPrefix)) return false;
    return !folder.slice(folderPrefix.length).includes("/");
  });
  const allVisibleSelected =
    data.items.length > 0 || visibleFolders.length > 0
      ? selectedIds.size === data.items.length &&
        visibleFolders.every((folder) => selectedFolders.has(folder))
      : false;
  const totalVaultSize = data.items.reduce(
    (acc, cur) => acc + (cur.size || 0),
    0,
  );

  return (
    <main
      className={`manage-page ${theme === "dark" ? "is-dark-theme" : ""} ${isSelectMode ? "is-select-mode" : ""}`}
    >
      <div className="manage-container">
        <ManageHeader
          theme={theme}
          hasUploads={uploads.length > 0}
          uploadCount={uploads.length}
          onToggleTheme={toggleTheme}
          onShowDashboard={() => setShowDashboard(true)}
          onShowShortcuts={() => setShowShortcuts(true)}
          onShowUploads={() => setIsUploadModalOpen(true)}
          onLogout={() =>
            fetch("/api/auth", { method: "DELETE" }).then(() => {
              sessionStorage.removeItem(TAB_SESSION_KEY);
              window.location.href = "/";
            })
          }
        />

        {/* Dropzone with Ctrl+V notice */}
        <UploadDropzone
          dragging={dragging}
          onChange={handleChange}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        />

        {/* Queue Banner if modal is closed */}
        {uploads.length > 0 && !isUploadModalOpen && (
          <UploadQueueBanner
            count={uploads.length}
            pendingCount={pendingCount}
            successCount={successCount}
            failedCount={failedCount}
            onOpen={() => setIsUploadModalOpen(true)}
          />
        )}

        {/* Gallery Section */}
        <section className="gallery-section">
          {/* Filters, Grid Column Switcher & Select Mode Toggle */}
          <div className="gallery-filters" style={{ alignItems: "flex-end" }}>
            <input
              className="mobile-search-filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") load(1, limit);
              }}
              placeholder="Tìm theo tên file (Nhấn Enter)"
            />
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">Mọi định dạng</option>
              <option value="image">Tất cả hình ảnh</option>
              <option value="video">Tất cả video</option>
              <option value="jpeg">JPG / JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WEBP</option>
              <option value="gif">GIF</option>
              <option value="mp4">MP4 Video</option>
              <option value="webm">WebM Video</option>
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
              <option value="name">Tên file (A-Z)</option>
              <option value="size">Kích thước lớn nhất</option>
            </select>

            {/* Date Range Timeline Filter */}
            <input
              className="mobile-date-filter"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Từ ngày"
              style={{ maxWidth: "130px" }}
            />
            <input
              className="mobile-date-filter"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Đến ngày"
              style={{ maxWidth: "130px" }}
            />

            {(dateFrom || dateTo || selectedTag) && (
              <button
                type="button"
                className="cancel-upload-button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                  setSelectedTag("");
                }}
                title="Xóa bộ lọc ngày & tag"
              >
                ✕ Xóa lọc
              </button>
            )}

            <button
              className="save-upload-button"
              type="button"
              onClick={() => load(1, limit)}
            >
              Lọc
            </button>

            {/* Grid Column Selector */}
            <div
              className="manage-control-group mobile-grid-control"
              style={{ marginLeft: "auto" }}
            >
              <div className="segmented-control">
                <button
                  type="button"
                  className={columns === 1 ? "is-active" : ""}
                  onClick={() => setColumns(1)}
                  title="1 ảnh trên 1 hàng"
                >
                  1
                </button>
                <button
                  type="button"
                  className={columns === 2 ? "is-active" : ""}
                  onClick={() => setColumns(2)}
                  title="2 ảnh trên 1 hàng"
                >
                  2
                </button>
                <button
                  type="button"
                  className={`grid-option-wide ${columns === 4 ? "is-active" : ""}`}
                  onClick={() => setColumns(4)}
                  title="4 ảnh trên 1 hàng"
                >
                  4
                </button>
                <button
                  type="button"
                  className={`grid-option-wide ${columns === 8 ? "is-active" : ""}`}
                  onClick={() => setColumns(8)}
                  title="8 ảnh trên 1 hàng"
                >
                  8
                </button>
              </div>
            </div>

            <div className="view-menu-wrap">
              <button
                type="button"
                className={`view-menu-button ${isViewMenuOpen ? "is-active" : ""}`}
                aria-label="Chọn kiểu hiển thị"
                aria-expanded={isViewMenuOpen}
                onClick={() => setIsViewMenuOpen((open) => !open)}
              >
                <span className="view-list-icon" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </button>
              {isViewMenuOpen && (
                <div className="view-menu" role="menu">
                  {[
                    ["list", "List view"],
                    ["thumbnail", "Thumbnail view"],
                    ["icon", "Icon view"],
                  ].map(([mode, label]) => (
                    <button
                      type="button"
                      role="menuitem"
                      className={viewMode === mode ? "is-selected" : ""}
                      key={mode}
                      onClick={() => {
                        setViewMode(mode as "list" | "thumbnail" | "icon");
                        setIsViewMenuOpen(false);
                      }}
                    >
                      <span className="view-menu-check">
                        {viewMode === mode ? "✓" : ""}
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Select mode toggle */}
            <button
              type="button"
              className="cancel-upload-button"
              style={
                isSelectMode
                  ? {
                      background: "#1d5960",
                      color: "#fff",
                      borderColor: "#1d5960",
                    }
                  : undefined
              }
              onClick={() => {
                if (isSelectMode) {
                  setIsSelectMode(false);
                  setSelectedIds(new Set());
                } else {
                  setIsSelectMode(true);
                }
              }}
            >
              {isSelectMode ? "✕ Hủy chọn" : "✓ Chọn ảnh"}
            </button>
            <button
              type="button"
              className="add-folder-button mobile-add-folder"
              onClick={() => {
                setFolderError("");
                setShowFolderModal(true);
              }}
            >
              <span aria-hidden="true">＋</span> Add Folder
            </button>
          </div>

          {/* Quick Tag Pills Bar */}
          {allUniqueTags.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
                marginBottom: "16px",
                alignItems: "center",
              }}
            >
              <span
                style={{ fontSize: "11px", fontWeight: 600, color: "#637078" }}
              >
                Tags:
              </span>
              <button
                type="button"
                className={`tag-pill ${!selectedTag ? "is-active" : ""}`}
                onClick={() => setSelectedTag("")}
              >
                Tất cả
              </button>
              {allUniqueTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`tag-pill ${selectedTag === tag.toLowerCase() ? "is-active" : ""}`}
                  onClick={() =>
                    setSelectedTag(
                      selectedTag === tag.toLowerCase()
                        ? ""
                        : tag.toLowerCase(),
                    )
                  }
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}

          {/* Selection Action Bar */}
          {isSelectMode && (
            <div className="selection-bar">
              <span className="selection-info">
                Đã chọn: {selectedIds.size} ảnh, {selectedFolders.size} folder
              </span>
              <div className="selection-actions">
                <button
                  type="button"
                  className="selection-btn"
                  onClick={() => {
                    if (allVisibleSelected) {
                      setSelectedIds(new Set());
                      setSelectedFolders(new Set());
                    } else {
                      setSelectedIds(new Set(data.items.map((img) => img.id)));
                      setSelectedFolders(new Set(visibleFolders));
                    }
                  }}
                >
                  {allVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
                <button
                  type="button"
                  className="selection-btn download-btn"
                  disabled={selectedIds.size === 0}
                  onClick={handleDownloadSelected}
                  title="Tải về các ảnh đang chọn"
                >
                  ⤓ Tải về ({selectedIds.size})
                </button>
                <button
                  type="button"
                  className="selection-btn btn-danger"
                  disabled={selectedIds.size === 0 && selectedFolders.size === 0 || isDeleting}
                  onClick={() => setShowConfirmDeleteSelected(true)}
                >
                  Xóa mục đã chọn ({selectedIds.size + selectedFolders.size})
                </button>
                <button
                  type="button"
                  className="selection-btn btn-danger"
                  disabled={data.total === 0 || isDeleting}
                  onClick={() => setShowConfirmDeleteAll(true)}
                >
                  Xóa tất cả ({data.total})
                </button>
              </div>
            </div>
          )}

          <div className="section-heading">
            <div>
              <p className="login-kicker">GALLERY</p>
              <nav
                className="folder-breadcrumb desktop-folder-breadcrumb"
                aria-label="Folder navigation"
              >
                <button type="button" onClick={() => openFolder("")}>
                  All
                </button>
                {currentFolder.split("/").map((segment, index, parts) => {
                  const path = parts.slice(0, index + 1).join("/");
                  return (
                    <span className="folder-breadcrumb-segment" key={path}>
                      <span aria-hidden="true">›</span>
                      <button type="button" onClick={() => openFolder(path)}>
                        {segment}
                      </button>
                    </span>
                  );
                })}
              </nav>
              <h2>
                Ảnh: {data.total.toLocaleString()}
                {selectedTag && (
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "normal",
                      marginLeft: "8px",
                      color: "#1d5960",
                    }}
                  >
                    (Tag: #{selectedTag})
                  </span>
                )}
                {isSelectMode && selectedIds.size > 0 && (
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "normal",
                      marginLeft: "12px",
                      color: "#1d5960",
                    }}
                  >
                    (Đang chọn {selectedIds.size} ảnh)
                  </span>
                )}
              </h2>
            </div>

            {/* Items per page selector */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <select
                value={limit}
                onChange={(e) => {
                  const newLimit = Number(e.target.value);
                  setLimit(newLimit);
                  load(1, newLimit);
                }}
                style={{
                  height: "30px",
                  padding: "0 8px",
                  borderRadius: "3px",
                  border: "1px solid #c9d0cc",
                  background: "#fffdf9",
                  fontSize: "12px",
                  color: "#182a35",
                }}
              >
                <option value={50}>50 ảnh / trang</option>
                <option value={100}>100 ảnh / trang</option>
                <option value={200}>200 ảnh / trang</option>
                <option value={500}>500 ảnh / trang</option>
              </select>
              <span>
                Trang {data.page} / {totalPages}
              </span>
            </div>
          </div>

          <nav
            className="folder-breadcrumb mobile-folder-breadcrumb"
            aria-label="Folder navigation"
          >
            <button type="button" onClick={() => openFolder("")}>All</button>
            {currentFolder.split("/").map((segment, index, parts) => {
              const path = parts.slice(0, index + 1).join("/");
              return (
                <span className="folder-breadcrumb-segment" key={path}>
                  <span aria-hidden="true">›</span>
                  <button type="button" onClick={() => openFolder(path)}>
                    {segment}
                  </button>
                </span>
              );
            })}
          </nav>

          {error && (
            <p className="upload-error" role="alert">
              {error}
            </p>
          )}

          {isLoading && (
            <div className="gallery-loading" role="status" aria-live="polite">
              <span className="gallery-loading-spinner" aria-hidden="true" />
              Đang tải ảnh...
            </div>
          )}

          {!isLoading && data.items.length === 0 && visibleFolders.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "48px 16px",
                color: "#637078",
              }}
            >
              Chưa có ảnh nào phù hợp. Hãy thử thay đổi bộ lọc hoặc dán ảnh mới
              bằng <strong>Ctrl + V</strong>.
            </div>
          ) : !isLoading ? (
            /* Full edge-to-edge cover grid */
            <div className={`image-grid grid-${columns} view-${viewMode}`}>
              {(viewMode === "thumbnail" || viewMode === "icon") &&
                visibleFolders.map((folder) => (
                  <button
                    type="button"
                    className={`thumbnail-folder-card desktop-folder-view ${selectedFolders.has(folder) ? "is-selected" : ""}`}
                    key={`thumbnail-folder-${folder}`}
                    onClick={() => isSelectMode ? toggleSelectFolder(folder) : openFolder(folder)}
                    title={`Mở folder ${folder}`}
                  >
                    {isSelectMode && (
                      <span className="folder-selected-mark">
                        {selectedFolders.has(folder) ? "✓" : ""}
                      </span>
                    )}
                    <span className="thumbnail-folder-icon" aria-hidden="true" />
                    <span className="thumbnail-item-name">{displayFolderName(folder)}</span>
                    <span className="thumbnail-item-meta">09-23 09:17</span>
                  </button>
                ))}
              <div
                className={`folder-list-container ${viewMode === "list" ? "is-active" : ""}`}
              >
              {visibleFolders.map((folder) => (
                  <button
                    type="button"
                    className={`list-folder-row ${selectedFolders.has(folder) ? "is-selected" : ""}`}
                    key={`folder-${folder}`}
                    onClick={() => isSelectMode ? toggleSelectFolder(folder) : openFolder(folder)}
                    title={`Mở folder ${folder}`}
                  >
                    {isSelectMode && (
                      <span className="folder-selected-mark">
                        {selectedFolders.has(folder) ? "✓" : ""}
                      </span>
                    )}
                    <span className="list-folder-icon" aria-hidden="true" />
                    <span className="list-file-name">{displayFolderName(folder)}</span>
                    <span>--</span>
                    <span>-</span>
                  </button>
              ))}
              </div>
              {data.items.map((image) => {
                const isItemChecked = selectedIds.has(image.id);
                return (
                  <button
                    className={`image-card ${isSelectMode && isItemChecked ? "is-selected" : ""}`}
                    key={image.id}
                    type="button"
                    onClick={() => {
                      if (isSelectMode) {
                        toggleSelectCard(image.id);
                      } else {
                        setSelected(image);
                        setZoom(1);
                        setRotation(0);
                      }
                    }}
                    title={image.filename}
                  >
                    {isSelectMode && (
                      <div
                        className="image-selected-mark"
                        style={
                          isItemChecked
                            ? { background: "#1d5960", color: "#fff" }
                            : {
                                background: "rgba(255,253,249,0.9)",
                                color: "#c9d0cc",
                                border: "1px solid #c9d0cc",
                              }
                        }
                      >
                        {isItemChecked ? "✓" : ""}
                      </div>
                    )}
                    <div className="image-preview">
                      {image.mimeType?.startsWith("video/") ? (
                        <div className="video-card-thumb">
                          <video
                            src={`/api/image/${image.id}`}
                            preload="metadata"
                            muted
                            playsInline
                          />
                          <div className="video-play-badge">▶</div>
                        </div>
                      ) : (
                        <img
                          src={`/api/image/${image.id}`}
                          alt={image.filename}
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                    </div>
                    {viewMode === "list" && (
                      <>
                        <span className="list-file-name">{image.filename}</span>
                        <span className="list-file-date">
                          {new Date(image.createdAt).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="list-file-size">
                          {formatSize(image.size)}
                        </span>
                      </>
                    )}
                    {(viewMode === "thumbnail" || viewMode === "icon") && (
                      <span className="thumbnail-caption">
                        <span className="thumbnail-item-name">{image.filename}</span>
                        <span className="thumbnail-item-meta">
                          {new Date(image.createdAt).toLocaleDateString("vi-VN", {
                            month: "2-digit",
                            day: "2-digit",
                          })}{" "}
                          {new Date(image.createdAt).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="thumbnail-item-size">{formatSize(image.size)}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Pagination Controls */}
          {!isLoading && data.total > 0 && (
            <div className="pagination-container">
              <div style={{ fontSize: "12px", color: "#637078" }}>
                Hiển thị {(data.page - 1) * (data.limit || limit) + 1} -{" "}
                {Math.min(data.page * (data.limit || limit), data.total)} trong
                tổng số {data.total.toLocaleString()} ảnh
              </div>

              <div className="pagination-controls">
                <button
                  className="pagination-btn"
                  type="button"
                  disabled={data.page <= 1}
                  onClick={() => load(1, limit)}
                  title="Trang đầu tiên"
                >
                  «
                </button>
                <button
                  className="pagination-btn"
                  type="button"
                  disabled={data.page <= 1}
                  onClick={() => load(data.page - 1, limit)}
                  title="Trang trước"
                >
                  ‹ Trước
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(
                    (p) =>
                      p === 1 ||
                      p === totalPages ||
                      Math.abs(p - data.page) <= 2,
                  )
                  .reduce<(number | string)[]>((acc, p, index, arr) => {
                    if (
                      index > 0 &&
                      typeof arr[index - 1] === "number" &&
                      (p as number) - (arr[index - 1] as number) > 1
                    ) {
                      acc.push(`dots-${p}`);
                    }
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item) => {
                    if (typeof item === "string") {
                      return (
                        <span key={item} className="pagination-ellipsis">
                          …
                        </span>
                      );
                    }
                    return (
                      <button
                        key={item}
                        type="button"
                        className={`pagination-btn ${item === data.page ? "is-active" : ""}`}
                        onClick={() => load(item, limit)}
                      >
                        {item}
                      </button>
                    );
                  })}

                <button
                  className="pagination-btn"
                  type="button"
                  disabled={!data.hasNextPage || data.page >= totalPages}
                  onClick={() => load(data.page + 1, limit)}
                  title="Trang tiếp theo"
                >
                  Sau ›
                </button>
                <button
                  className="pagination-btn"
                  type="button"
                  disabled={data.page >= totalPages}
                  onClick={() => load(totalPages, limit)}
                  title="Trang cuối cùng"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Confirm Delete Selected Modal */}
      {showConfirmDeleteSelected && (
        <div
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => !isDeleting && setShowConfirmDeleteSelected(false)}
        >
          <div className="confirm-panel" onClick={(e) => e.stopPropagation()}>
            <p className="login-kicker">XÁC NHẬN XÓA MỤC ĐÃ CHỌN</p>
            <h2>
              Xóa {selectedIds.size + selectedFolders.size} mục đã chọn?
            </h2>
            <p style={{ marginTop: "12px" }}>
              Folder đã chọn sẽ xóa cả folder con và ảnh bên trong khỏi thư viện.
              Thao tác này không thể khôi phục.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "24px",
              }}
            >
              <button
                type="button"
                className="cancel-upload-button"
                disabled={isDeleting}
                onClick={() => setShowConfirmDeleteSelected(false)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="delete-button"
                disabled={isDeleting}
                onClick={handleDeleteSelected}
              >
                {isDeleting
                  ? "Đang xóa..."
                  : `Xác nhận xóa (${selectedIds.size + selectedFolders.size} mục)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete All Modal */}
      {showConfirmDeleteAll && (
        <div
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => !isDeleting && setShowConfirmDeleteAll(false)}
        >
          <div className="confirm-panel" onClick={(e) => e.stopPropagation()}>
            <p className="login-kicker" style={{ color: "#b6503e" }}>
              CẢNH BÁO NGUY HIỂM
            </p>
            <h2>XÓA TẤT CẢ ({data.total}) ẢNH TRONG KHO?</h2>
            <p
              style={{ marginTop: "12px", color: "#b6503e", fontWeight: "600" }}
            >
              Hành động này sẽ XÓA TOÀN BỘ tất cả ảnh trong kho lưu trữ khỏi
              Telegram và xóa sạch toàn bộ metadata trên GitHub. Không có cách
              nào để hoàn tác!
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "24px",
              }}
            >
              <button
                type="button"
                className="cancel-upload-button"
                disabled={isDeleting}
                onClick={() => setShowConfirmDeleteAll(false)}
              >
                Hủy bỏ (Giữ lại ảnh)
              </button>
              <button
                type="button"
                className="delete-button"
                disabled={isDeleting}
                onClick={handleDeleteAll}
                style={{ background: "#933d31" }}
              >
                {isDeleting ? "Đang xóa toàn bộ..." : "XÁC NHẬN XÓA TẤT CẢ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Preview Modal */}
      {isUploadModalOpen && (
        <div className="upload-modal" role="dialog" aria-modal="true">
          <div className="upload-modal-panel">
            <div className="upload-modal-header">
              <div>
                <p className="login-kicker">HÀNG ĐỢI TẢI LÊN</p>
                <h2>
                  {uploads.length} ảnh đã chọn ({formatSize(totalUploadSize)})
                </h2>
              </div>
              <button
                className="upload-modal-close"
                type="button"
                onClick={handleCloseModal}
                aria-label="Đóng"
              >
                ×
              </button>
            </div>

            {/* Rate Limit Protection Banner & URL Uploader */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                marginTop: "12px",
                padding: "10px 12px",
                borderRadius: "6px",
                background: "rgba(29, 89, 96, 0.06)",
                border: "1px solid rgba(29, 89, 96, 0.15)",
                fontSize: "12px",
                color: "#182a35",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "6px",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>🛡️</span> Giữ nguyên 100% chất lượng gốc • Gom 5
                  ảnh/request • Giãn cách 900ms chống Telegram Rate Limit (429)
                </span>
              </div>

              {/* Direct Web URL Ingestion */}
              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <input
                  type="url"
                  placeholder="Hoặc dán trực tiếp link URL ảnh từ Web (https://...)..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      uploadFromUrl();
                    }
                  }}
                  style={{
                    flex: 1,
                    height: "32px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #c9d0cc",
                    fontSize: "12px",
                    background: "#fff",
                  }}
                  disabled={isUploadingUrl || isUploading}
                />
                <button
                  type="button"
                  onClick={uploadFromUrl}
                  disabled={isUploadingUrl || !urlInput.trim() || isUploading}
                  className="save-upload-button"
                  style={{
                    height: "32px",
                    padding: "0 14px",
                    fontSize: "12px",
                  }}
                >
                  {isUploadingUrl ? "Đang tải URL..." : "Tải từ URL"}
                </button>
              </div>
            </div>

            <div className="upload-modal-stats">
              <div className="status-tags">
                {pendingCount > 0 && (
                  <span className="status-tag tag-pending">
                    Chờ tải: {pendingCount}
                  </span>
                )}
                {uploadingCount > 0 && (
                  <span className="status-tag tag-uploading">
                    Đang tải: {uploadingCount}
                  </span>
                )}
                {successCount > 0 && (
                  <span className="status-tag tag-success">
                    Thành công: {successCount}
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="status-tag tag-failed">
                    Thất bại: {failedCount}
                  </span>
                )}
              </div>
              {isUploading && (
                <div className="progress-container">
                  <div
                    className="progress-bar"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>

            <div className="upload-preview-grid">
              {uploads.map((item) => (
                <div className="upload-card" key={item.id}>
                  <div className="upload-card-thumb">
                    {item.file.type.startsWith("video/") ? (
                      <div className="video-card-thumb">
                        <video src={item.preview} muted preload="metadata" />
                        <div
                          className="video-play-badge"
                          style={{ width: "26px", height: "26px", fontSize: "11px" }}
                        >
                          ▶
                        </div>
                      </div>
                    ) : (
                      <img src={item.preview} alt={item.file.name} />
                    )}
                    {item.status !== "uploading" && (
                      <button
                        type="button"
                        className="upload-remove-button"
                        onClick={() => removeUpload(item.id)}
                        title="Bỏ file này"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="upload-card-info">
                    <span className="upload-filename" title={item.file.name}>
                      {item.file.name}
                    </span>
                    <span className="upload-filesize">
                      {formatSize(item.file.size)}
                    </span>
                    <div className={`upload-status-badge is-${item.status}`}>
                      {item.status === "pending" && "Chờ tải"}
                      {item.status === "uploading" && "Đang gửi Telegram..."}
                      {item.status === "success" && "✓ Đã tải lên"}
                      {item.status === "failed" && "✕ Lỗi tải lên"}
                    </div>
                    {item.error && (
                      <p className="upload-card-error" title={item.error}>
                        {item.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="upload-modal-footer">
              <div className="modal-left-actions">
                <label
                  htmlFor="modal-files-input"
                  className="cancel-upload-button"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  + Thêm ảnh / video
                </label>
                <input
                  id="modal-files-input"
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleChange}
                  className="visually-hidden"
                />

                {successCount > 0 && (
                  <button
                    type="button"
                    className="cancel-upload-button"
                    onClick={clearCompleted}
                  >
                    Dọn ảnh đã tải ({successCount})
                  </button>
                )}
                <button
                  type="button"
                  className="cancel-upload-button"
                  onClick={clearAll}
                  disabled={isUploading}
                >
                  Xóa hết
                </button>
              </div>

              <div className="modal-right-actions">
                <button
                  type="button"
                  className="cancel-upload-button"
                  onClick={handleCloseModal}
                >
                  Đóng
                </button>
                {pendingCount > 0 ? (
                  <div className="upload-start-actions">
                    <button
                      type="button"
                      className="save-upload-button"
                      onClick={() => uploadAll(false)}
                      disabled={isUploading}
                    >
                      {isUploading
                        ? "Đang tải lên..."
                        : `Bắt đầu tải lên (${pendingCount})`}
                    </button>
                    <button
                      type="button"
                      className="fast-upload-button"
                      onClick={() => uploadAll(true)}
                      disabled={isUploading}
                      title="Gửi nhanh, không chờ 900ms giữa các ảnh. Telegram có thể trả lỗi 409."
                    >
                      Tải nhanh
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="save-upload-button"
                    onClick={handleCloseModal}
                  >
                    Hoàn tất & Đóng
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pro Fullscreen Responsive Image Lightbox */}
      {selected && (
        <div
          className="fullscreen-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setSelected(null);
            setIsSlideshow(false);
          }}
        >
          {/* Top Bar */}
          <div
            className="lightbox-top-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lightbox-title-info">
              {selectedIndex !== -1 && (
                <span className="lightbox-counter">
                  {selectedIndex + 1} / {data.items.length}
                </span>
              )}
              <span
                className="lightbox-filename mobile-hidden"
                title={selected.filename}
              >
                {selected.filename}
              </span>
            </div>

            {/* Center Pro Tools: Zoom, Rotate, Slideshow, Fullscreen */}
            <div className="lightbox-center-controls">
              <button
                type="button"
                className={`mobile-hidden lightbox-icon-btn ${isSlideshow ? "is-active" : ""}`}
                onClick={() => setIsSlideshow(!isSlideshow)}
                title={
                  isSlideshow
                    ? "Tạm dừng trình chiếu (Phím Space)"
                    : "Tự động trình chiếu (Phím Space)"
                }
              >
                {isSlideshow ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                className="lightbox-icon-btn"
                onClick={() =>
                  setZoom((z) => Math.min(3, Number((z + 0.5).toFixed(1))))
                }
                title="Phóng to (+)"
              >
                +
              </button>
              <button
                type="button"
                className="lightbox-icon-btn"
                onClick={() =>
                  setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))
                }
                title="Thu nhỏ (-)"
              >
                -
              </button>
              {zoom > 1 && (
                <button
                  type="button"
                  className="lightbox-icon-btn mobile-hidden"
                  onClick={() => setZoom(1)}
                  title="Đặt lại kích thước chuẩn (100%)"
                  style={{
                    fontSize: "10px",
                    width: "auto",
                    padding: "0 6px",
                    borderRadius: "10px",
                  }}
                >
                  {Math.round(zoom * 100)}%
                </button>
              )}
              <button
                type="button"
                className="lightbox-icon-btn mobile-hidden"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                title="Xoay ảnh 90° (Phím R)"
              >
                ⟳
              </button>
              <button
                type="button"
                className={`lightbox-icon-btn ${showFilmstrip ? "is-active" : ""}`}
                onClick={() => setShowFilmstrip(!showFilmstrip)}
                title="Bật/Tắt dải ảnh xem nhanh"
              >
                ▦
              </button>
              <button
                type="button"
                className="lightbox-icon-btn"
                onClick={() => {
                  if (document.fullscreenElement) {
                    document.exitFullscreen();
                  } else {
                    document.documentElement.requestFullscreen();
                  }
                }}
                title="Toàn màn hình (Phím F)"
              >
                ⛶
              </button>
            </div>

            {/* Right Actions */}
            <div
              className="lightbox-top-actions"
              style={{ position: "relative" }}
            >
              <div className="mobile-hidden" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="lightbox-action-btn"
                  onClick={() => setShowCopyMenu(!showCopyMenu)}
                  title="Sao chép link hoặc mã nhúng ảnh"
                >
                  Sao chép ▾
                </button>

                {showCopyMenu && (
                  <div
                    className="copy-popover"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="copy-popover-item"
                      onClick={() => {
                        const fullUrl = `${window.location.origin}/api/image/${selected.id}`;
                        navigator.clipboard.writeText(fullUrl);
                        setShowCopyMenu(false);
                        showToast("✓ Đã sao chép link ảnh trực tiếp!");
                      }}
                    >
                      <span>Link trực tiếp (URL)</span>
                    </button>
                    <button
                      type="button"
                      className="copy-popover-item"
                      onClick={() => {
                        const fullUrl = `${window.location.origin}/api/image/${selected.id}`;
                        navigator.clipboard.writeText(
                          `![${selected.filename}](${fullUrl})`,
                        );
                        setShowCopyMenu(false);
                        showToast("✓ Đã sao chép mã Markdown!");
                      }}
                    >
                      <span>Mã Markdown</span>
                    </button>
                    <button
                      type="button"
                      className="copy-popover-item"
                      onClick={() => {
                        const fullUrl = `${window.location.origin}/api/image/${selected.id}`;
                        navigator.clipboard.writeText(
                          `<img src="${fullUrl}" alt="${selected.filename}" />`,
                        );
                        setShowCopyMenu(false);
                        showToast("✓ Đã sao chép thẻ HTML <img>!");
                      }}
                    >
                      <span>Thẻ HTML &lt;img&gt;</span>
                    </button>
                  </div>
                )}
              </div>

              <a
                href={`/api/image/${selected.id}`}
                download={selected.filename}
                className="lightbox-action-btn download-btn"
                title="Tải ảnh về máy"
              >
                Tải về
              </a>
              <button
                type="button"
                className="lightbox-action-btn btn-danger mobile-hidden"
                onClick={() => deleteSingleImage(selected)}
                title="Xóa ảnh khỏi kho"
              >
                Xóa ảnh
              </button>
              <button
                type="button"
                className="lightbox-close-btn"
                onClick={() => {
                  setSelected(null);
                  setIsSlideshow(false);
                }}
                aria-label="Đóng"
                title="Đóng (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Main Viewing Stage */}
          <div
            className="lightbox-stage"
            onClick={() => {
              setSelected(null);
              setIsSlideshow(false);
            }}
          >
            {data.items.length > 1 && (
              <button
                type="button"
                className="lightbox-nav-btn nav-prev"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                aria-label="Ảnh trước (Mũi tên trái)"
                title="Ảnh trước (←)"
              >
                ‹
              </button>
            )}

            <div
              className="lightbox-image-wrapper"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(event) => {
                const touch = event.touches[0];
                touchStart.current = touch
                  ? { x: touch.clientX, y: touch.clientY }
                  : null;
              }}
              onTouchEnd={(event) => {
                const start = touchStart.current;
                touchStart.current = null;
                const touch = event.changedTouches[0];
                if (!start || !touch) return;

                const deltaX = touch.clientX - start.x;
                const deltaY = touch.clientY - start.y;
                if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) {
                  return;
                }

                if (deltaX > 0) {
                  handlePrev();
                } else {
                  handleNext();
                }
              }}
              onDoubleClick={() =>
                !selected.mimeType?.startsWith("video/") &&
                setZoom((z) => (z > 1 ? 1 : 2))
              }
              style={{
                cursor:
                  selected.mimeType?.startsWith("video/")
                    ? "default"
                    : zoom > 1
                      ? "grab"
                      : "default",
              }}
            >
              {selected.mimeType?.startsWith("video/") ? (
                <video
                  key={selected.id}
                  src={`/api/image/${selected.id}`}
                  controls
                  autoPlay
                  playsInline
                  style={{
                    maxWidth: "92vw",
                    maxHeight: "82vh",
                    borderRadius: "8px",
                    boxShadow: "0 12px 48px rgba(0, 0, 0, 0.6)",
                    outline: "none",
                  }}
                />
              ) : (
                <img
                  src={`/api/image/${selected.id}`}
                  alt={selected.filename}
                  className="lightbox-full-img"
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transition:
                      zoom > 1 ? "transform 140ms ease" : "transform 200ms ease",
                  }}
                />
              )}
            </div>

            {data.items.length > 1 && (
              <button
                type="button"
                className="lightbox-nav-btn nav-next"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                aria-label="Ảnh tiếp theo (Mũi tên phải)"
                title="Ảnh tiếp theo (→)"
              >
                ›
              </button>
            )}
          </div>

          {/* Filmstrip: Quick Thumbnails Strip */}
          {showFilmstrip && data.items.length > 1 && (
            <div
              ref={filmstripContainerRef}
              className="filmstrip-container"
              onClick={(e) => e.stopPropagation()}
            >
              {data.items.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className={`filmstrip-item ${img.id === selected.id ? "is-active" : ""}`}
                  onClick={() => {
                    setSelected(img);
                    setZoom(1);
                    setRotation(0);
                  }}
                  title={img.filename}
                >
                  {img.mimeType?.startsWith("video/") ? (
                    <div className="filmstrip-video-thumb">
                      <video
                        src={`/api/image/${img.id}`}
                        muted
                        preload="metadata"
                      />
                      <span className="filmstrip-video-badge">▶</span>
                    </div>
                  ) : (
                    <img
                      src={`/api/image/${img.id}`}
                      alt={img.filename}
                      loading="lazy"
                    />
                  )}
                </button>
              ))}
            </div>
          )}

        </div>
      )}

      {/* Vault Dashboard & Backup Modal */}
      {showDashboard && (
        <div
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowDashboard(false)}
        >
          <div
            className="confirm-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "520px" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <p className="login-kicker" style={{ margin: 0 }}>
                HỆ THỐNG LƯU TRỮ VAULT
              </p>
              <button
                type="button"
                className="lightbox-close-btn"
                style={{ color: "#182a35", background: "rgba(24,42,53,0.08)" }}
                onClick={() => setShowDashboard(false)}
              >
                ✕
              </button>
            </div>
            <h2 style={{ marginTop: "10px" }}>Thống kê kho ảnh</h2>

            <div className="dashboard-stats-grid">
              <div className="dashboard-stat-card">
                <div className="dashboard-stat-lbl">Tổng số ảnh</div>
                <div className="dashboard-stat-val">
                  {data.total.toLocaleString()}
                </div>
              </div>
              <div className="dashboard-stat-card">
                <div className="dashboard-stat-lbl">Dung lượng trang này</div>
                <div className="dashboard-stat-val">
                  {formatSize(totalVaultSize)}
                </div>
              </div>
              <div className="dashboard-stat-card">
                <div className="dashboard-stat-lbl">Dung lượng TB</div>
                <div className="dashboard-stat-val">
                  {data.items.length
                    ? formatSize(Math.round(totalVaultSize / data.items.length))
                    : "0 KB"}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                background: "rgba(24,42,53,0.04)",
                borderRadius: "4px",
              }}
            >
              <strong style={{ fontSize: "12px", color: "#182a35" }}>
                🛡 An toàn dữ liệu & Sao lưu
              </strong>
              <p
                style={{
                  fontSize: "12px",
                  color: "#637078",
                  margin: "6px 0 12px",
                }}
              >
                Ảnh của bạn được lưu an toàn vĩnh viễn trên Telegram, metadata
                được lưu trên GitHub. Bạn có thể tải file sao lưu JSON đầy đủ về
                máy tính bất cứ lúc nào.
              </p>
              <button
                type="button"
                className="save-upload-button"
                style={{ width: "100%" }}
                onClick={handleExportBackup}
              >
                ⤓ Tải bản sao lưu Metadata (JSON)
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "20px",
              }}
            >
              <button
                type="button"
                className="cancel-upload-button"
                onClick={() => setShowDashboard(false)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Helper Modal */}
      {showShortcuts && (
        <div
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="confirm-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "460px" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <p className="login-kicker" style={{ margin: 0 }}>
                HƯỚNG DẪN THAO TÁC NHANH
              </p>
              <button
                type="button"
                className="lightbox-close-btn"
                style={{ color: "#182a35", background: "rgba(24,42,53,0.08)" }}
                onClick={() => setShowShortcuts(false)}
              >
                ✕
              </button>
            </div>
            <h2 style={{ marginTop: "10px" }}>Phím tắt bàn phím</h2>

            <table className="shortcuts-table">
              <tbody>
                <tr>
                  <td>
                    <kbd>Ctrl + V</kbd>
                  </td>
                  <td>Dán ảnh từ Clipboard để tải lên ngay</td>
                </tr>
                <tr>
                  <td>
                    <kbd>←</kbd> / <kbd>→</kbd>
                  </td>
                  <td>Chuyển ảnh trước / ảnh kế tiếp</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Space</kbd>
                  </td>
                  <td>Bật / Tạm dừng trình chiếu tự động (Slideshow)</td>
                </tr>
                <tr>
                  <td>
                    <kbd>+</kbd> / <kbd>-</kbd>
                  </td>
                  <td>Phóng to / Thu nhỏ ảnh</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Double Click</kbd>
                  </td>
                  <td>Phóng to 200% / Đặt lại 100%</td>
                </tr>
                <tr>
                  <td>
                    <kbd>R</kbd>
                  </td>
                  <td>Xoay ảnh 90 độ theo chiều kim đồng hồ</td>
                </tr>
                <tr>
                  <td>
                    <kbd>F</kbd>
                  </td>
                  <td>Bật / Tắt chế độ toàn màn hình (Fullscreen)</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Esc</kbd>
                  </td>
                  <td>Đóng ảnh / Thoát chế độ xem</td>
                </tr>
                <tr>
                  <td>
                    <kbd>?</kbd>
                  </td>
                  <td>Mở bảng phím tắt này</td>
                </tr>
              </tbody>
            </table>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "20px",
              }}
            >
              <button
                type="button"
                className="save-upload-button"
                onClick={() => setShowShortcuts(false)}
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {showFolderModal && (
        <div
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-folder-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isCreatingFolder) {
              setShowFolderModal(false);
            }
          }}
        >
          <form className="confirm-panel folder-form" onSubmit={createFolder}>
            <button
              type="button"
              className="upload-modal-close folder-close"
              onClick={() => setShowFolderModal(false)}
              disabled={isCreatingFolder}
              aria-label="Đóng"
            >
              ×
            </button>
            <p className="login-kicker">NEW FOLDER</p>
            <h2 id="create-folder-title">Tạo thư mục mới</h2>
            <p>Đặt tên cho thư mục để quản lý ảnh dễ dàng hơn.</p>
            <input
              className="folder-name-input"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Ví dụ: Du lịch Đà Nẵng"
              maxLength={80}
              autoFocus
              disabled={isCreatingFolder}
            />
            {folderError && (
              <p className="folder-form-error" role="alert">
                {folderError}
              </p>
            )}
            <div className="folder-form-actions">
              <button
                type="button"
                className="cancel-upload-button"
                onClick={() => setShowFolderModal(false)}
                disabled={isCreatingFolder}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="save-upload-button"
                disabled={!folderName.trim() || isCreatingFolder}
              >
                {isCreatingFolder ? "Đang tạo..." : "Tạo thư mục"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="toast-container">
          <div className="toast-message toast-success">{toastMessage}</div>
        </div>
      )}

      {/* Back to Top Floating Button */}
      {showBackToTop && !selected && !isUploadModalOpen && (
        <button
          type="button"
          className="back-to-top-btn"
          onClick={scrollToTop}
          title="Lên đầu trang"
          aria-label="Lên đầu trang"
        >
          ↑
        </button>
      )}
    </main>
  );
}
