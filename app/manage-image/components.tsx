import type { ChangeEvent, FormEvent } from "react";
import type { ImagePage } from "@/lib/types";

type Theme = "light" | "dark";

type ManageHeaderProps = {
  theme: Theme;
  hasUploads: boolean;
  uploadCount: number;
  onToggleTheme: () => void;
  onShowDashboard: () => void;
  onShowShortcuts: () => void;
  onShowUploads: () => void;
  onLogout: () => void;
};

export function ManageHeader({
  theme,
  hasUploads,
  uploadCount,
  onToggleTheme,
  onShowDashboard,
  onShowShortcuts,
  onShowUploads,
  onLogout,
}: ManageHeaderProps) {
  return (
    <header className="manage-toolbar">
      <div>
        <p className="login-kicker">PRIVATE MEDIA VAULT</p>
        <h1>Thư viện hình ảnh & Video</h1>
      </div>
      <div className="manage-toolbar-actions">
        <button className="cancel-upload-button" type="button" onClick={onToggleTheme}>
          {theme === "dark" ? "☀️ Sáng" : "🌙 Tối"}
        </button>
        <button className="cancel-upload-button" type="button" onClick={onShowDashboard}>
          📊 Thống kê
        </button>
        <button className="cancel-upload-button" type="button" onClick={onShowShortcuts}>
          ⌨ Phím tắt
        </button>
        {hasUploads && (
          <button className="save-upload-button" type="button" onClick={onShowUploads}>
            Hàng đợi ({uploadCount})
          </button>
        )}
        <button className="cancel-upload-button" type="button" onClick={onLogout}>
          Đăng xuất
        </button>
      </div>
    </header>
  );
}

type UploadDropzoneProps = {
  dragging: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
};

export function UploadDropzone({
  dragging,
  onChange,
  onDragOver,
  onDragLeave,
  onDrop,
}: UploadDropzoneProps) {
  return (
    <div
      className={`upload-dropzone mobile-hidden ${dragging ? "is-dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input id="files" className="visually-hidden" type="file" accept="image/*,video/*" multiple onChange={onChange} />
      <p className="login-kicker">UPLOAD & CLIPBOARD</p>
      <h2>Kéo ảnh hoặc video vào đây hoặc bấm Ctrl + V</h2>
      <p>
        Hỗ trợ <label htmlFor="files">chọn nhiều file</label>, kéo thả ảnh/video, hoặc dán trực tiếp ảnh chụp màn hình bằng <strong>Ctrl + V</strong>.
      </p>
    </div>
  );
}

type UploadQueueBannerProps = {
  count: number;
  pendingCount: number;
  successCount: number;
  failedCount: number;
  onOpen: () => void;
};

export function UploadQueueBanner({
  count,
  pendingCount,
  successCount,
  failedCount,
  onOpen,
}: UploadQueueBannerProps) {
  return (
    <div className="upload-queue-banner">
      <div>
        <strong>Hàng đợi: {count} ảnh</strong>
        <span>
          (Chờ: {pendingCount} · Thành công: {successCount}
          {failedCount > 0 ? ` · Thất bại: ${failedCount}` : ""})
        </span>
      </div>
      <button type="button" className="save-upload-button" onClick={onOpen}>
        Mở hàng đợi ({count})
      </button>
    </div>
  );
}

type ConfirmDeleteModalProps = {
  kind: "selected" | "all";
  total: number;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmDeleteModal({
  kind,
  total,
  isDeleting,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
  const isAll = kind === "all";
  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" onClick={() => !isDeleting && onClose()}>
      <div className="confirm-panel" onClick={(event) => event.stopPropagation()}>
        <p className="login-kicker" style={isAll ? { color: "#b6503e" } : undefined}>
          {isAll ? "CẢNH BÁO NGUY HIỂM" : "XÁC NHẬN XÓA MỤC ĐÃ CHỌN"}
        </p>
        <h2>{isAll ? `XÓA TẤT CẢ (${total}) ẢNH TRONG KHO?` : `Xóa ${total} mục đã chọn?`}</h2>
        <p style={{ marginTop: "12px", color: isAll ? "#b6503e" : undefined }}>
          {isAll
            ? "Hành động này sẽ XÓA TOÀN BỘ tất cả ảnh trong kho lưu trữ. Không có cách nào để hoàn tác!"
            : "Folder đã chọn sẽ xóa cả folder con và ảnh bên trong khỏi thư viện. Thao tác này không thể khôi phục."}
        </p>
        <div className="confirm-actions">
          <button type="button" className="cancel-upload-button" disabled={isDeleting} onClick={onClose}>
            Hủy bỏ
          </button>
          <button type="button" className="delete-button" disabled={isDeleting} onClick={onConfirm}>
            {isDeleting ? "Đang xóa..." : isAll ? "XÁC NHẬN XÓA TẤT CẢ" : `Xác nhận xóa (${total} mục)`}
          </button>
        </div>
      </div>
    </div>
  );
}

type DashboardModalProps = {
  data: ImagePage;
  totalVaultSize: number;
  onClose: () => void;
  onExport: () => void;
  formatSize: (size: number) => string;
};

export function DashboardModal({ data, totalVaultSize, onClose, onExport, formatSize }: DashboardModalProps) {
  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="confirm-panel" onClick={(event) => event.stopPropagation()} style={{ maxWidth: "520px" }}>
        <div className="modal-heading-row">
          <p className="login-kicker">HỆ THỐNG LƯU TRỮ VAULT</p>
          <button type="button" className="lightbox-close-btn" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <h2>Thống kê kho ảnh</h2>
        <div className="dashboard-stats-grid">
          <div className="dashboard-stat-card"><div className="dashboard-stat-lbl">Tổng số ảnh</div><div className="dashboard-stat-val">{data.total.toLocaleString()}</div></div>
          <div className="dashboard-stat-card"><div className="dashboard-stat-lbl">Dung lượng trang này</div><div className="dashboard-stat-val">{formatSize(totalVaultSize)}</div></div>
          <div className="dashboard-stat-card"><div className="dashboard-stat-lbl">Dung lượng TB</div><div className="dashboard-stat-val">{data.items.length ? formatSize(Math.round(totalVaultSize / data.items.length)) : "0 KB"}</div></div>
        </div>
        <div className="dashboard-backup-panel">
          <strong>🛡 An toàn dữ liệu & Sao lưu</strong>
          <p>Ảnh được lưu trên Telegram, metadata được lưu trên GitHub. Bạn có thể tải file sao lưu JSON đầy đủ về máy tính.</p>
          <button type="button" className="save-upload-button" onClick={onExport}>⤓ Tải bản sao lưu Metadata (JSON)</button>
        </div>
        <div className="confirm-actions"><button type="button" className="cancel-upload-button" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}

type ShortcutsModalProps = { onClose: () => void };
export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const shortcuts = [
    ["Ctrl + V", "Dán ảnh từ Clipboard để tải lên ngay"],
    ["← / →", "Chuyển ảnh trước / ảnh kế tiếp"],
    ["Space", "Bật / Tạm dừng trình chiếu tự động"],
    ["+ / -", "Phóng to / Thu nhỏ ảnh"],
    ["Double Click", "Phóng to 200% / Đặt lại 100%"],
    ["R", "Xoay ảnh 90 độ"],
    ["F", "Bật / Tắt toàn màn hình"],
    ["Esc", "Đóng ảnh / Thoát chế độ xem"],
    ["?", "Mở bảng phím tắt này"],
  ];
  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="confirm-panel" onClick={(event) => event.stopPropagation()} style={{ maxWidth: "460px" }}>
        <div className="modal-heading-row"><p className="login-kicker">HƯỚNG DẪN THAO TÁC NHANH</p><button type="button" className="lightbox-close-btn" onClick={onClose}>✕</button></div>
        <h2>Phím tắt bàn phím</h2>
        <table className="shortcuts-table"><tbody>{shortcuts.map(([key, description]) => <tr key={key}><td><kbd>{key}</kbd></td><td>{description}</td></tr>)}</tbody></table>
        <div className="confirm-actions"><button type="button" className="save-upload-button" onClick={onClose}>Đã hiểu</button></div>
      </div>
    </div>
  );
}

type FolderModalProps = {
  folderName: string;
  folderError: string;
  isCreating: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};
export function FolderModal({ folderName, folderError, isCreating, onChange, onSubmit, onClose }: FolderModalProps) {
  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="confirm-panel folder-form" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="upload-modal-close folder-close" onClick={onClose} disabled={isCreating} aria-label="Đóng">×</button>
        <p className="login-kicker">NEW FOLDER</p><h2>Tạo thư mục mới</h2><p>Đặt tên cho thư mục để quản lý ảnh dễ dàng hơn.</p>
        <input className="folder-name-input" value={folderName} onChange={onChange} placeholder="Ví dụ: Du lịch Đà Nẵng" maxLength={80} autoFocus disabled={isCreating} />
        {folderError && <p className="folder-form-error" role="alert">{folderError}</p>}
        <div className="folder-form-actions"><button type="button" className="cancel-upload-button" onClick={onClose} disabled={isCreating}>Hủy</button><button type="submit" className="save-upload-button" disabled={!folderName.trim() || isCreating}>{isCreating ? "Đang tạo..." : "Tạo thư mục"}</button></div>
      </form>
    </div>
  );
}
