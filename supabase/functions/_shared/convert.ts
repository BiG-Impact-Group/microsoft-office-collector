// Shared file → markdown conversion, used by process-attachments and
// poll-onedrive. Returns markdown, or null for types we don't handle yet
// (docx/xlsx/images/other binary). PDF needs ANTHROPIC_API_KEY.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

export async function convertToMarkdown(
  name: string,
  mime: string,
  b64: string
): Promise<string | null> {
  const lower = name.toLowerCase();
  const isText =
    mime.startsWith("text/") ||
    mime === "application/json" ||
    /\.(txt|md|markdown|csv|tsv|json|log|html?|xml)$/.test(lower);

  if (isText) {
    const text = new TextDecoder().decode(base64ToBytes(b64));
    if (mime.includes("html") || /\.html?$/.test(lower)) return stripHtml(text);
    return text.slice(0, 100_000);
  }

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    if (!ANTHROPIC_API_KEY) return null;
    return await pdfToMarkdown(b64);
  }

  // docx / xlsx / pptx / images / other binary — not yet handled.
  return null;
}

async function pdfToMarkdown(b64: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: "Convert this document to clean Markdown. Output only the Markdown, no preamble." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`pdf conversion failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000; // avoid call-stack limits on String.fromCharCode(...)
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000);
}
