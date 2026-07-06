import { resolveCaller, json, CORS_HEADERS } from "../_shared/graphUser.ts";

// Returns a short-lived, pre-authed OneDrive download URL for a file so the
// browser can fetch the bytes directly (keeping large payloads off the edge).

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
  const { token } = resolved;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}?$select=id,name,@microsoft.graph.downloadUrl`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error("item fetch failed:", res.status, await res.text());
    return json({ error: `Could not get download link (${res.status})` }, 502);
  }
  const item = (await res.json()) as { name?: string; "@microsoft.graph.downloadUrl"?: string };
  const downloadUrl = item["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) return json({ error: "No download URL available for this item" }, 409);

  return json({ downloadUrl, name: item.name ?? "download" });
});
