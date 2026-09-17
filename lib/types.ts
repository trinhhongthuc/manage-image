export type ImageRecord = {
  id: string;
  filename: string;
  telegramFileId: string;
  telegramFileUniqueId?: string;
  telegramMessageId: number;
  width?: number;
  height?: number;
  size: number;
  mimeType: string;
  createdAt: string;
  tags?: string[];
  album?: string;
};

export type ImagePage = {
  items: ImageRecord[];
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
};
