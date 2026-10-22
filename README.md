This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Image upload flow

The upload queue offers two routes:

- **Load trực tiếp** uploads each file to Telegram and saves the returned metadata to GitHub through the management API.
- **Load qua server** uploads files to Telegram first, then sends batches of up to 20 metadata records through the management API to the separate metadata server and saves those records to the GitHub gallery metadata. The image files are not sent to the metadata-saving request. If metadata storage fails after Telegram accepts the upload, retrying the item resends its saved metadata without uploading the file to Telegram again.

The management API forwards `POST /api/images?operation=save-metadata` to `IMAGE_METADATA_API_URL` (default: `https://manage-image-be.onrender.com/upload`) as JSON. Configure `IMAGE_METADATA_API_URL` on the management server. The payload has this shape:

```json
{
  "items": [
    {
      "id": "img_...",
      "filename": "photo.jpg",
      "telegramFileId": "...",
      "telegramFileUniqueId": "...",
      "telegramMessageId": 123,
      "size": 1024,
      "mimeType": "image/jpeg",
      "createdAt": "2026-10-21T08:00:00.000Z",
      "album": "optional-folder"
    }
  ]
}
```

`width`, `height`, `url`, and `tags` are optional metadata fields.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
