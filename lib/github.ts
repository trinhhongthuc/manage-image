import type { ImageRecord } from "@/lib/types";

const shardCount = 16;
const apiRoot = "https://api.github.com";

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
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  return response;
}

async function readShard(index: number): Promise<{ items: ImageRecord[]; sha?: string }> {
  const { owner, repo, branch } = config();
  const response = await github(`/repos/${owner}/${repo}/contents/${pathForShard(index)}?ref=${encodeURIComponent(branch)}`);
  if (response.status === 404) return { items: [] };
  if (!response.ok) throw new Error(`GitHub đọc metadata thất bại (${response.status}).`);
  const payload = (await response.json()) as { content: string; sha: string };
  const content = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
  const items = JSON.parse(content) as unknown;
  return { items: Array.isArray(items) ? (items as ImageRecord[]) : [], sha: payload.sha };
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
