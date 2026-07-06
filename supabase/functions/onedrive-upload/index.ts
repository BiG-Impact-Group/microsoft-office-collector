import { resolveCaller, json, CORS_HEADERS } from "../_shared/graphUser.ts";
import { storeOneDriveDocument } from "../_shared/onedriveDoc.ts";

// Uploads a file from the browser into the caller's OneDrive (a dedicated
// "DevPod Uploads" folder), then processes it into the vector DB. Requires the
// Files.ReadWrite scope — returns a clear error (needsReconnect) until the
// account is reconnected with write access granted.

const UPLOAD_FOLDER = "DevPod Uploads";
const MAX_FILE_BYTES = 4_000_000; // simple-upload ceiling we allow from the edge

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { name?: string; mimeType?: string; contentBase64?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const name = (body.name ?? "").trim();
  const contentBase64 = body.contentBase64 ?? "";
  if (!name || !contentBase64) return json({ error: "Missing name or content" }, 400);

  let bytes: Uint8Array;
  try {
    const binary = atob(contentBase64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return json({ error: "Invalid base64 content" }, 400);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return json({ error: `File too large (max ${MAX_FILE_BYTES / 1_000_000} MB)` }, 413);
  }

  const resolved = await resolveCaller(req);
  if ("error" in resolved) return resolved.error;
  const { serviceDb, account, token } = resolved;

  // Ensure the upload folder exists (create it if missing).
  const folderPath = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(UPLOAD_FOLDER)}`;
  const folderRes = await fetch(folderPath, { headers: { Authorization: `Bearer ${token}` } });
  if (folderRes.status === 404) {
    const createRes = await fetch("https://graph.microsoft.com/v1.0/me/drive/root/children", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: UPLOAD_FOLDER, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    // 409 = someone created it concurrently; that's fine.
    if (!createRes.ok && createRes.status !== 409) {
      return graphError("Could not create upload folder", createRes);
    }
  } else if (!folderRes.ok) {
    return graphError("Could not access OneDrive", folderRes);
  }

  // Simple upload to the folder.
  const uploadUrl =
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(UPLOAD_FOLDER)}/${encodeURIComponent(name)}:/content`;
  const upRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": body.mimeType || "application/octet-stream",
    },
    body: bytes,
  });
  if (!upRes.ok) return graphError("Upload failed", upRes);

  const item = (await upRes.json()) as { id: string; name?: string; file?: { mimeType?: string }; size?: number };

  // Process the freshly-uploaded bytes into the vector DB.
  let status = "unknown";
  try {
    status = await storeOneDriveDocument(serviceDb, account.id, {
      id: item.id,
      name: item.name ?? name,
      mimeType: item.file?.mimeType ?? body.mimeType ?? null,
    }, contentBase64);
  } catch (err) {
    console.error("store after upload failed:", err);
    // The file is uploaded; surface partial success so the UI can say so.
    return json({ ok: true, uploaded: true, processed: false, item: shape(item) });
  }

  return json({ ok: true, uploaded: true, processed: true, status, item: shape(item) });
});

function shape(item: { id: string; name?: string; size?: number }) {
  return { id: item.id, name: item.name ?? "", size: item.size ?? 0 };
}

async function graphError(message: string, res: Response): Promise<Response> {
  const text = await res.text();
  console.error(`${message}:`, res.status, text);
  // 403 almost always means Files.ReadWrite hasn't been consented yet.
  if (res.status === 403) {
    return json(
      { error: "Uploading needs OneDrive write access. Reconnect your Microsoft account to grant it.", needsReconnect: true },
      403,
    );
  }
  return json({ error: `${message} (${res.status})` }, 502);
}
