import { resolveCaller, json, CORS_HEADERS } from "../_shared/graphUser.ts";
import { bytesToBase64 } from "../_shared/convert.ts";
import { storeOneDriveDocument } from "../_shared/onedriveDoc.ts";

// Processes an existing OneDrive file into the vector DB: download bytes →
// markdown → `documents` row (the index-documents cron then embeds it).
// Powers the per-file "Process" button and "Process all unprocessed".

const MAX_FILE_BYTES = 5_000_000;

interface GraphItem {
  id: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  "@microsoft.graph.downloadUrl"?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { itemId?: string };
  try {
    body = (await req.json()) as { itemId?: string };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const itemId = (body.itemId ?? "").trim();
  if (!itemId) return json({ error: "Missing itemId" }, 400);

  const resolved = await resolveCaller(req);
  if ("error" in resolved) return resolved.error;
  const { serviceDb, account, token } = resolved;

  const metaRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    console.error("item fetch failed:", metaRes.status, await metaRes.text());
    return json({ error: `Could not fetch file (${metaRes.status})` }, 502);
  }
  const item = (await metaRes.json()) as GraphItem;
  if (!item.file) return json({ error: "Not a file" }, 400);
  if ((item.size ?? 0) > MAX_FILE_BYTES) return json({ error: "File too large to process" }, 413);

  // Download bytes (pre-authed URL if present, else the authenticated endpoint).
  const dlUrl = item["@microsoft.graph.downloadUrl"];
  const dlRes = dlUrl
    ? await fetch(dlUrl)
    : await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/content`, {
        headers: { Authorization: `Bearer ${token}` },
      });
  if (!dlRes.ok) {
    console.error("download failed:", dlRes.status);
    return json({ error: `Download failed (${dlRes.status})` }, 502);
  }
  const base64 = bytesToBase64(new Uint8Array(await dlRes.arrayBuffer()));

  try {
    const status = await storeOneDriveDocument(serviceDb, account.id, {
      id: item.id,
      name: item.name ?? "(unnamed)",
      mimeType: item.file?.mimeType ?? null,
    }, base64);
    return json({ ok: true, status });
  } catch (err) {
    console.error("store failed:", err);
    return json({ error: "Failed to store document" }, 500);
  }
});
