export type UploadWorkerItem = {
  id: string;
  file: File;
};

export type UploadWorkerStatus = {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  status: "uploading" | "success" | "failed";
  error?: string;
};

export type UploadWorkerRequest =
  | { type: "start"; album: string; items: UploadWorkerItem[] }
  | { type: "stop" };

export type UploadWorkerEvent =
  | { type: "batch"; items: UploadWorkerStatus[] }
  | { type: "complete"; stopped: boolean }
  | { type: "error"; message: string };

declare const self: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<UploadWorkerRequest>) => void,
  ): void;
  postMessage(message: UploadWorkerEvent): void;
};

const MAX_UPLOAD_FILES_PER_BATCH = 10;
const MAX_UPLOAD_BATCH_BYTES = 4.5 * 1024 * 1024 - 64 * 1024;
let stopRequested = false;
let isRunning = false;

function createBatches(items: UploadWorkerItem[]) {
  const batches: UploadWorkerItem[][] = [];
  let batch: UploadWorkerItem[] = [];
  let batchSize = 0;

  for (const item of items) {
    if (
      batch.length > 0 &&
      (batch.length >= MAX_UPLOAD_FILES_PER_BATCH ||
        batchSize + item.file.size > MAX_UPLOAD_BATCH_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      batchSize = 0;
    }

    batch.push(item);
    batchSize += item.file.size;
  }

  if (batch.length) batches.push(batch);
  return batches;
}

function statusFor(
  item: UploadWorkerItem,
  status: UploadWorkerStatus["status"],
  error?: string,
): UploadWorkerStatus {
  return {
    id: item.id,
    filename: item.file.name,
    size: item.file.size,
    mimeType: item.file.type,
    status,
    ...(error ? { error } : {}),
  };
}

async function uploadItems(album: string, items: UploadWorkerItem[]) {
  const batches = createBatches(items);

  for (const batch of batches) {
    if (stopRequested) break;

    self.postMessage({
      type: "batch",
      items: batch.map((item) => statusFor(item, "uploading")),
    } satisfies UploadWorkerEvent);

    let statuses: UploadWorkerStatus[];
    try {
      const form = new FormData();
      if (album) form.append("album", album);
      for (const item of batch) form.append("files", item.file);

      const response = await fetch("/api/images", {
        method: "POST",
        body: form,
      });
      const responseText = await response.text();
      let result: {
        error?: string;
        errors?: Array<{ filename: string; error: string }>;
      };
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(
          !response.ok && responseText.trim()
            ? `Upload thất bại (${response.status}): ${responseText.trim()}`
            : "Máy chủ không trả về JSON hợp lệ.",
        );
      }

      if (!response.ok) {
        const error = result.error ?? `Upload thất bại (${response.status})`;
        statuses = batch.map((item) => statusFor(item, "failed", error));
      } else {
        const failedByFilename = new Map(
          (result.errors ?? []).map(({ filename, error }) => [filename, error]),
        );
        statuses = batch.map((item) => {
          const error = failedByFilename.get(item.file.name);
          return error
            ? statusFor(item, "failed", error)
            : statusFor(item, "success");
        });
      }
    } catch (reason) {
      const error =
        reason instanceof Error ? reason.message : "Lỗi kết nối mạng";
      statuses = batch.map((item) => statusFor(item, "failed", error));
    }

    self.postMessage({ type: "batch", items: statuses } satisfies UploadWorkerEvent);
  }

  self.postMessage({
    type: "complete",
    stopped: stopRequested,
  } satisfies UploadWorkerEvent);
}

self.addEventListener("message", (event: MessageEvent<UploadWorkerRequest>) => {
  if (event.data.type === "stop") {
    stopRequested = true;
    return;
  }
  if (isRunning) {
    self.postMessage({
      type: "error",
      message: "Worker đang xử lý một hàng đợi upload khác.",
    } satisfies UploadWorkerEvent);
    return;
  }

  isRunning = true;
  stopRequested = false;
  uploadItems(event.data.album, event.data.items)
    .catch((reason: unknown) => {
      self.postMessage({
        type: "error",
        message:
          reason instanceof Error ? reason.message : "Worker upload gặp lỗi.",
      } satisfies UploadWorkerEvent);
    })
    .finally(() => {
      isRunning = false;
    });
});
