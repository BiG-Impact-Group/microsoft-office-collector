import { supabase } from "./lib/supabase.js";

// Client for the OneDrive edge functions (onedrive-list / -download / -process
// / -upload). Mirrors the JWT-fetch helpers in emails.ts.

export interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  mimeType: string | null;
  lastModified: string | null;
  downloadUrl: string | null;
  /** documents.status if we've processed this file into the vector DB, else null. */
  processedStatus: string | null;
}

async function callFn<T>(name: string, payload: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error("Not signed in");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error((json.error as string) ?? `Server error (${res.status})`) as Error & {
      needsReconnect?: boolean;
    };
    err.needsReconnect = json.needsReconnect === true;
    throw err;
  }
  return json as T;
}

export async function listOneDrive(folderId?: string): Promise<OneDriveItem[]> {
  const data = await callFn<{ items: OneDriveItem[] }>("onedrive-list", { folderId });
  return data.items ?? [];
}

export async function getDownloadUrl(itemId: string): Promise<{ downloadUrl: string; name: string }> {
  return callFn("onedrive-download", { itemId });
}

export interface DocumentTarget {
  source: string;
  external_id: string | null;
  email_id: string | null;
}

/** Looks up how to open a document (from an assistant source): its provider
 *  source, OneDrive item id, and/or parent email id. RLS-scoped to the caller. */
export async function getDocumentTarget(documentId: string): Promise<DocumentTarget | null> {
  const { data, error } = await supabase
    .from("documents")
    .select("source, external_id, email_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  return (data as DocumentTarget | null) ?? null;
}

export async function processOneDriveItem(itemId: string): Promise<{ status: string }> {
  return callFn("onedrive-process", { itemId });
}

export async function uploadToOneDrive(
  file: File,
): Promise<{ processed: boolean; status?: string; item: { id: string; name: string } }> {
  const contentBase64 = await fileToBase64(file);
  return callFn("onedrive-upload", {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    contentBase64,
  });
}

/** Reads a File into a bare base64 string (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
