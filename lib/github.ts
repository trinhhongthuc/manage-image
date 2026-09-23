import type { ImageRecord } from "@/lib/types";

const shardCount = 16;
const apiRoot = "https://api.github.com";
const foldersPath = "metadata/folders.json";

function config() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH ?? "main";
  if (!token || !owner || !repo) throw new Error("Thiếu cấu hình GitHub.");
  return { token, owner, repo, branch };
}

function pathForShard(index: number) {
  return `metadata/images-${index.toString(16).padStart(2, "0")}.json`;
}

function shardFor(id: string) {
  return Number.parseInt(id.slice(-2), 16) % shardCount;
}

async function github(path: string, init?: RequestInit) {
  const { token } = config();
  try {
    return await fetch(`${apiRoot}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error
      ? `: ${error.cause.message}`
      : "";
    throw new Error(`Không thể kết nối GitHub API${cause}`);
  }
}

type ShardCacheEntry = { data: { items: ImageRecord[]; sha?: string }; expiresAt: number };
const shardCache = new Map<number, ShardCacheEntry>();

async function readShard(index: number): Promise<{ items: ImageRecord[]; sha?: string }> {
  const cached = shardCache.get(index);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const { owner, repo, branch } = config();
  const response = await github(`/repos/${owner}/${repo}/contents/${pathForShard(index)}?ref=${encodeURIComponent(branch)}`);
  if (response.status === 404) {
    const empty = { items: [] };
    shardCache.set(index, { data: empty, expiresAt: Date.now() + 60 * 1000 });
    return empty;
  }
  if (!response.ok) throw new Error(`GitHub đọc metadata thất bại (${response.status}).`);
  const payload = (await response.json()) as { content: string; sha: string };
  const content = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
  const items = JSON.parse(content) as unknown;
  const result = { items: Array.isArray(items) ? (items as ImageRecord[]) : [], sha: payload.sha };
  shardCache.set(index, { data: result, expiresAt: Date.now() + 60 * 1000 });
  return result;
}

async function writeShard(index: number, items: ImageRecord[], sha?: string) {
  const { owner, repo, branch } = config();
  const body = {
    message: `chore(images): update shard ${index.toString(16).padStart(2, "0")}`,
    content: Buffer.from(JSON.stringify(items, null, 2) + "\n").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };
  const response = await github(`/repos/${owner}/${repo}/contents/${pathForShard(index)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub ghi metadata thất bại (${response.status}).`);
  const payload = (await response.json()) as { content?: { sha?: string } };
  shardCache.set(index, {
    data: { items, sha: payload.content?.sha ?? sha },
    expiresAt: Date.now() + 60 * 1000,
  });
}

export async function readFolders(): Promise<string[]> {
  const { owner, repo, branch } = config();
  const response = await github(
    `/repos/${owner}/${repo}/contents/${foldersPath}?ref=${encodeURIComponent(branch)}`,
  );
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`GitHub đọc folder thất bại (${response.status}).`);
  const payload = (await response.json()) as { content: string };
  const content = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
  const folders = JSON.parse(content) as unknown;
  return Array.isArray(folders)
    ? folders.filter((folder): folder is string => typeof folder === "string")
    : [];
}

export async function appendFolder(folder: string) {
  const { owner, repo, branch } = config();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await github(
      `/repos/${owner}/${repo}/contents/${foldersPath}?ref=${encodeURIComponent(branch)}`,
    );
    let folders: string[] = [];
    let sha: string | undefined;
    if (response.ok) {
      const payload = (await response.json()) as { content: string; sha: string };
      folders = JSON.parse(Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8")) as string[];
      sha = payload.sha;
    } else if (response.status !== 404) {
      throw new Error(`GitHub đọc folder thất bại (${response.status}).`);
    }

    if (folders.some((existing) => existing.toLowerCase() === folder.toLowerCase())) {
      return folders.find((existing) => existing.toLowerCase() === folder.toLowerCase()) ?? folder;
    }

    const writeResponse = await github(`/repos/${owner}/${repo}/contents/${foldersPath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore(images): add folder",
        content: Buffer.from(JSON.stringify([...folders, folder], null, 2) + "\n").toString("base64"),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (writeResponse.ok) return folder;
    if (writeResponse.status !== 409 || attempt === 2) {
      throw new Error(`GitHub ghi folder thất bại (${writeResponse.status}).`);
    }
  }
  throw new Error("Không thể tạo folder.");
}

export async function removeFolders(targets: string[]) {
  const { owner, repo, branch } = config();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await github(
      `/repos/${owner}/${repo}/contents/${foldersPath}?ref=${encodeURIComponent(branch)}`,
    );
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`GitHub đọc folder thất bại (${response.status}).`);

    const payload = (await response.json()) as { content: string; sha: string };
    const folders = JSON.parse(
      Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8"),
    ) as unknown;
    const targetSet = new Set(targets.map((target) => target.toLowerCase()));
    const removed = Array.isArray(folders)
      ? folders.filter(
          (folder): folder is string =>
            typeof folder === "string" &&
            targets.some(
              (target) =>
                folder.toLowerCase() === target.toLowerCase() ||
                folder.toLowerCase().startsWith(`${target.toLowerCase()}/`),
            ),
        )
      : [];
    const remaining = Array.isArray(folders)
      ? folders.filter(
          (folder) =>
            typeof folder === "string" &&
            !Array.from(targetSet).some(
              (target) =>
                folder.toLowerCase() === target ||
                folder.toLowerCase().startsWith(`${target}/`),
            ),
        )
      : [];

    const writeResponse = await github(`/repos/${owner}/${repo}/contents/${foldersPath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore(images): remove folder",
        content: Buffer.from(JSON.stringify(remaining, null, 2) + "\n").toString("base64"),
        branch,
        sha: payload.sha,
      }),
    });
    if (writeResponse.ok) return removed;
    if (writeResponse.status !== 409 || attempt === 2) {
      throw new Error(`GitHub xóa folder thất bại (${writeResponse.status}).`);
    }
  }
  throw new Error("Không thể xóa folder.");
}

export async function appendRecords(records: ImageRecord[]) {
  const byShard = new Map<number, ImageRecord[]>();
  for (const record of records) {
    const shard = shardFor(record.id);
    byShard.set(shard, [...(byShard.get(shard) ?? []), record]);
  }
  for (const [shard, additions] of byShard) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await readShard(shard);
      try {
        await writeShard(shard, [...current.items, ...additions], current.sha);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }
}

export async function readAllRecords() {
  const shards = await Promise.all(Array.from({ length: shardCount }, (_, index) => readShard(index)));
  return shards.flatMap((shard) => shard.items);
}

export async function findRecord(id: string) {
  const shard = await readShard(shardFor(id));
  return shard.items.find((record) => record.id === id);
}

export async function removeRecord(id: string) {
  const shardIndex = shardFor(id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readShard(shardIndex);
    const next = current.items.filter((record) => record.id !== id);
    if (next.length === current.items.length) return false;
    try {
      await writeShard(shardIndex, next, current.sha);
      return true;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return false;
}

export async function updateRecord(id: string, updates: Partial<ImageRecord>) {
  const shardIndex = shardFor(id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readShard(shardIndex);
    const index = current.items.findIndex((record) => record.id === id);
    if (index === -1) return null;
    const updatedRecord: ImageRecord = { ...current.items[index], ...updates };
    const next = [...current.items];
    next[index] = updatedRecord;
    try {
      await writeShard(shardIndex, next, current.sha);
      return updatedRecord;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return null;
}
