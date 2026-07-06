import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { convertToMarkdown } from "./convert.ts";

// Converts a OneDrive file (base64 bytes) to markdown and stores it as a
// `documents` row (source='onedrive') so the index-documents cron embeds it.
// Shared by onedrive-upload and onedrive-process. Idempotent on
// (account_id, source, external_id): re-processing updates the existing row.

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType?: string | null;
}

export type ProcessStatus = "converted" | "skipped" | "failed";

export async function storeOneDriveDocument(
  serviceDb: SupabaseClient,
  accountId: string,
  file: DriveFileMeta,
  base64: string,
): Promise<ProcessStatus> {
  let status: ProcessStatus;
  let markdown: string | null = null;
  let error: string | null = null;

  try {
    const result = await convertToMarkdown(file.name, file.mimeType ?? "", base64);
    if (result === null) {
      status = "skipped";
      error = "unsupported type (docx/xlsx/binary)";
    } else {
      status = "converted";
      markdown = result;
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  const row = {
    account_id: accountId,
    source: "onedrive",
    external_id: file.id,
    email_id: null,
    name: file.name,
    mime_type: file.mimeType ?? null,
    status,
    markdown,
    error,
  };

  // Manual upsert: the (account_id, source, external_id) uniqueness is a partial
  // index, which ON CONFLICT can't always infer — so look up then update/insert.
  const { data: existing } = await serviceDb
    .from("documents")
    .select("id")
    .eq("account_id", accountId)
    .eq("source", "onedrive")
    .eq("external_id", file.id)
    .maybeSingle();

  if (existing) {
    const { error: upErr } = await serviceDb
      .from("documents")
      .update({ name: row.name, mime_type: row.mime_type, status, markdown, error })
      .eq("id", (existing as { id: string }).id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await serviceDb.from("documents").insert(row);
    if (insErr) throw insErr;
  }

  return status;
}
