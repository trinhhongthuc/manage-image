export type UploadStatus = "pending" | "uploading" | "success" | "failed";

export type StoredUploadMetadata = {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  status: UploadStatus;
  error?: string;
};

export type StoredUploadFile = {
  id: string;
  file: File;
};

const DATABASE_NAME = "manage-image-upload-queue";
const DATABASE_VERSION = 1;
const FILES_STORE = "files";
const QUEUE_STORE = "queue";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore(FILES_STORE, { keyPath: "id" });
      database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Không thể mở hàng đợi upload."));
    request.onblocked = () => reject(new Error("Không thể mở hàng đợi upload do một tab khác đang cập nhật dữ liệu."));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Không thể lưu hàng đợi upload."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Đã hủy thao tác lưu hàng đợi upload."));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Không thể đọc hàng đợi upload."));
  });
}

export async function readUploadQueue() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([FILES_STORE, QUEUE_STORE], "readonly");
    const completion = transactionComplete(transaction);
    const metadataRequest = transaction.objectStore(QUEUE_STORE).getAll() as IDBRequest<StoredUploadMetadata[]>;
    const filesRequest = transaction.objectStore(FILES_STORE).getAll() as IDBRequest<StoredUploadFile[]>;
    const [metadata, files] = await Promise.all([
      requestResult(metadataRequest),
      requestResult(filesRequest),
    ]);
    await completion;
    const filesById = new Map(files.map((entry) => [entry.id, entry.file]));
    return metadata.flatMap((item) => {
      const file = filesById.get(item.id);
      return file ? [{ ...item, file }] : [];
    });
  } finally {
    database.close();
  }
}

export async function storeNewUploadItems(items: Array<{
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
}>) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([FILES_STORE, QUEUE_STORE], "readwrite");
    const completion = transactionComplete(transaction);
    const files = transaction.objectStore(FILES_STORE);
    const queue = transaction.objectStore(QUEUE_STORE);
    for (const item of items) {
      files.put({ id: item.id, file: item.file } satisfies StoredUploadFile);
      queue.put({
        id: item.id,
        filename: item.file.name,
        size: item.file.size,
        mimeType: item.file.type,
        status: item.status,
        ...(item.error ? { error: item.error } : {}),
      } satisfies StoredUploadMetadata);
    }
    await completion;
  } finally {
    database.close();
  }
}

export async function updateStoredUploadItems(items: StoredUploadMetadata[]) {
  if (!items.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(QUEUE_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    const queue = transaction.objectStore(QUEUE_STORE);
    for (const item of items) queue.put(item);
    await completion;
  } finally {
    database.close();
  }
}

export async function removeStoredUploadItems(ids: string[]) {
  if (!ids.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction([FILES_STORE, QUEUE_STORE], "readwrite");
    const completion = transactionComplete(transaction);
    const files = transaction.objectStore(FILES_STORE);
    const queue = transaction.objectStore(QUEUE_STORE);
    for (const id of ids) {
      files.delete(id);
      queue.delete(id);
    }
    await completion;
  } finally {
    database.close();
  }
}

export async function clearStoredUploadItems() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([FILES_STORE, QUEUE_STORE], "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(FILES_STORE).clear();
    transaction.objectStore(QUEUE_STORE).clear();
    await completion;
  } finally {
    database.close();
  }
}
