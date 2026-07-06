import { resolveCaller, json, CORS_HEADERS } from "../_shared/graphUser.ts";

// Lists the caller's OneDrive contents (root, or a given folder) live from
// Microsoft Graph, and annotates each file with whether we've already processed
// it into the vector DB (a `documents` row for this account with a matching
// external_id). Read-only — works on the current Files scope.

interface GraphItem {
  id: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  lastModifiedDateTime?: string;
  "@microsoft.graph.downloadUrl"?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { folderId?: string };
  try {
    body = (await req.json()) as { folderId?: string };
  } catch {
    body = {};
  }

  const resolved = await resolveCaller(req);
  if ("error" in resolved) return resolved.error;
  const { serviceDb, account, token } = resolved;

  const path = body.folderId
    ? `/me/drive/items/${body.folderId}/children`
    : "/me/drive/root/children";
  const listRes = await fetch(`https://graph.microsoft.com/v1.0${path}?$top=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    console.error("drive list failed:", listRes.status, await listRes.text());
    return json({ error: `OneDrive listing failed (${listRes.status})` }, 502);
  }
  const graphItems = ((await listRes.json()) as { value: GraphItem[] }).value ?? [];

  // Which of these files have we already turned into documents?
  const fileIds = graphItems.filter((it) => it.file).map((it) => it.id);
  const processed = new Map<string, string>();
  if (fileIds.length > 0) {
    const { data: docs } = await serviceDb
      .from("documents")
      .select("external_id, status")
      .eq("account_id", account.id)
      .eq("source", "onedrive")
      .in("external_id", fileIds);
    for (const d of (docs ?? []) as { external_id: string; status: string }[]) {
      processed.set(d.external_id, d.status);
    }
  }

  const items = graphItems
    .map((it) => ({
      id: it.id,
      name: it.name ?? "(unnamed)",
      size: it.size ?? 0,
      isFolder: !!it.folder,
      mimeType: it.file?.mimeType ?? null,
      lastModified: it.lastModifiedDateTime ?? null,
      downloadUrl: it["@microsoft.graph.downloadUrl"] ?? null,
      processedStatus: it.file ? processed.get(it.id) ?? null : null,
    }))
    // Folders first, then files, each alphabetical.
    .sort((a, b) =>
      a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1,
    );

  return json({ items });
});
