"use client";

import { ChangeEvent, DragEvent, useEffect, useState } from "react";
import type { ImagePage, ImageRecord } from "@/lib/types";

const emptyPage: ImagePage = { items: [], page: 1, limit: 24, total: 0, hasNextPage: false };
type UploadItem = { id: string; file: File; preview: string; status: "pending" | "uploading" | "success" | "failed"; error?: string };

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function ManageImagePage() {
  const [data, setData] = useState<ImagePage>(emptyPage);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [type, setType] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ImageRecord | null>(null);

  async function load(page = 1) {
    const params = new URLSearchParams({ page: String(page), limit: "24", sort });
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    const response = await fetch(`/api/images?${params}`, { cache: "no-store" });
    if (response.status === 401) { window.location.href = "/"; return; }
    if (!response.ok) throw new Error("Không thể tải gallery.");
    setData(await response.json());
  }

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : "Không thể tải gallery.")); }, [sort, type]);

  function addFiles(files: File[]) {
    const valid = files.filter((file) => file.type.startsWith("image/"));
    setUploads((current) => [...current, ...valid.map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: "pending" as const }))]);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }
  function handleDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }
  function removeUpload(id: string) { setUploads((current) => current.filter((item) => item.id !== id)); }

  async function uploadAll() {
    const pending = uploads.filter((item) => item.status === "pending");
    if (!pending.length) return;
    setUploads((current) => current.map((item) => pending.some((next) => next.id === item.id) ? { ...item, status: "uploading" } : item));
    const form = new FormData();
    pending.forEach((item) => form.append("files", item.file));
    try {
      const response = await fetch("/api/images", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Upload thất bại.");
      const failed = new Set((result.errors ?? []).map((item: { filename: string }) => item.filename));
      setUploads((current) => current.map((item) => pending.some((next) => next.id === item.id) ? { ...item, status: failed.has(item.file.name) ? "failed" : "success" } : item));
      await load(1);
    } catch (reason) {
      setUploads((current) => current.map((item) => pending.some((next) => next.id === item.id) ? { ...item, status: "failed", error: reason instanceof Error ? reason.message : "Upload thất bại." } : item));
    }
  }

  async function deleteImage(image: ImageRecord) {
    if (!window.confirm(`Xóa ${image.filename}?`)) return;
    const response = await fetch("/api/images", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: image.id }) });
    if (!response.ok) { setError("Không thể xóa ảnh."); return; }
    setSelected(null);
    await load(data.page);
  }

  return (
    <main className="manage-page">
      <div className="manage-container">
        <header className="manage-toolbar">
          <div><p className="login-kicker">PRIVATE IMAGE VAULT</p><h1>Thư viện hình ảnh</h1></div>
          <button className="cancel-upload-button" type="button" onClick={() => fetch("/api/auth", { method: "DELETE" }).then(() => { window.location.href = "/"; })}>Đăng xuất</button>
        </header>

        <div className={`upload-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
          <input id="files" className="visually-hidden" type="file" accept="image/*" multiple onChange={handleChange} />
          <p className="login-kicker">UPLOAD</p><h2>Kéo ảnh vào đây</h2><p>Hoặc <label htmlFor="files">chọn nhiều ảnh</label>. Ảnh sẽ được gửi qua server tới Telegram.</p>
        </div>

        {uploads.length > 0 && <section className="upload-queue" aria-label="Hàng đợi upload">
          <div className="section-heading"><h2>Hàng đợi ({uploads.length})</h2><button className="save-upload-button" type="button" onClick={uploadAll}>Upload ảnh</button></div>
          <div className="upload-queue-list">{uploads.map((item) => <article className="queue-item" key={item.id}><img src={item.preview} alt="" /><div><strong>{item.file.name}</strong><span>{formatSize(item.file.size)} · {item.status}</span></div><button type="button" onClick={() => removeUpload(item.id)} aria-label={`Bỏ ${item.file.name}`}>×</button></article>)}</div>
        </section>}

        <section className="gallery-section">
          <div className="gallery-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load(1); }} placeholder="Tìm theo tên file" /><select value={type} onChange={(event) => setType(event.target.value)}><option value="">Mọi định dạng</option><option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option><option value="gif">GIF</option></select><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Mới nhất</option><option value="oldest">Cũ nhất</option><option value="name">Tên file</option><option value="size">Kích thước</option></select><button className="save-upload-button" type="button" onClick={() => load(1)}>Lọc</button></div>
          <div className="section-heading"><div><p className="login-kicker">GALLERY</p><h2>{data.total.toLocaleString()} ảnh</h2></div><span>Trang {data.page}</span></div>
          {error && <p className="upload-error" role="alert">{error}</p>}
          <div className="image-grid grid-4">{data.items.map((image) => <button className="image-card" key={image.id} type="button" onClick={() => setSelected(image)}><div className="image-preview"><img src={`/api/image/${image.id}`} alt={image.filename} loading="lazy" /></div><span className="image-caption">{image.filename}</span></button>)}</div>
          <div className="pagination"><button className="cancel-upload-button" type="button" disabled={data.page <= 1} onClick={() => load(data.page - 1)}>Trước</button><button className="cancel-upload-button" type="button" disabled={!data.hasNextPage} onClick={() => load(data.page + 1)}>Sau</button></div>
        </section>
      </div>
      {selected && <div className="image-lightbox" role="dialog" aria-modal="true" onClick={() => setSelected(null)}><button className="lightbox-close" type="button" onClick={() => setSelected(null)} aria-label="Đóng">×</button><div className="lightbox-content" onClick={(event) => event.stopPropagation()}><img src={`/api/image/${selected.id}`} alt={selected.filename} /><div className="lightbox-meta"><strong>{selected.filename}</strong><span>{selected.width ?? "?"} × {selected.height ?? "?"} · {formatSize(selected.size)} · {selected.mimeType}</span><button className="delete-button" type="button" onClick={() => deleteImage(selected)}>Xóa ảnh</button></div></div></div>}
    </main>
  );
}
