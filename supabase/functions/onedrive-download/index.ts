import { resolveCaller, json, CORS_HEADERS } from "../_shared/graphUser.ts";

// Returns info about a OneDrive item: a short-lived pre-authed download URL
// (for direct browser download) AND its parent folder (so the UI can reveal the
// file inside the OneDrive browser). Used by the assistant's document sources.

interface ParentRef {
  id?: string;
  path?: string;
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
  const { token } = resolved;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}?$select=id,name,parentReference,@microsoft.graph.downloadUrl`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error("item fetch failed:", res.status, await res.text());
    return json({ error: `Item not found (${res.status})` }, res.status === 404 ? 404 : 502);
  }
  const item = (await res.json()) as {
    name?: string;
    parentReference?: ParentRef;
    "@microsoft.graph.downloadUrl"?: string;
  };

  // Derive the parent folder from parentReference.path (".../root:/A/B").
  const path = item.parentReference?.path ?? "";
  const afterRoot = path.includes("root:") ? path.split("root:")[1] : "";
  const isRoot = afterRoot === "" || afterRoot === "/";
  const segs = afterRoot.split("/").filter(Boolean);
  const parentName = isRoot ? "OneDrive" : decodeURIComponent(segs[segs.length - 1]);

  return json({
    name: item.name ?? "download",
    downloadUrl: item["@microsoft.graph.downloadUrl"] ?? null,
    parentId: item.parentReference?.id ?? null,
    parentName,
    isRoot,
  });
});
