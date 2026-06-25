import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidAccessToken } from "../_shared/graphToken.ts";

// Sends an email as the calling user via Microsoft Graph /me/sendMail.
// Server-side so the access token never reaches the browser.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

interface SendRequest {
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Identify the caller ───────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing authorization" }, 401);
  }
  const jwt = authHeader.slice(7);

  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return json({ error: "Invalid session" }, 401);
  }

  // ── Validate input ────────────────────────────────────────
  let payload: SendRequest;
  try {
    payload = (await req.json()) as SendRequest;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const to = (payload.to ?? []).map((a) => a.trim()).filter(Boolean);
  const cc = (payload.cc ?? []).map((a) => a.trim()).filter(Boolean);
  if (to.length === 0) {
    return json({ error: "At least one recipient is required" }, 400);
  }

  // ── Load the user's Microsoft account + a valid token ─────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: account, error: accErr } = await admin
    .from("connected_accounts")
    .select("id, access_token_encrypted, refresh_token_encrypted, token_expires_at")
    .eq("user_id", user.id)
    .eq("provider", "microsoft")
    .maybeSingle();

  if (accErr) {
    console.error("Account lookup failed:", accErr);
    return json({ error: "Failed to load account" }, 500);
  }
  if (!account) {
    return json({ error: "No Microsoft account connected" }, 400);
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(admin, account);
  } catch (err) {
    console.error("Token error:", err);
    return json({ error: "Could not obtain a Microsoft access token" }, 502);
  }

  // ── Send via Microsoft Graph ──────────────────────────────
  const message = {
    subject: payload.subject ?? "(no subject)",
    body: { contentType: "Text", content: payload.body ?? "" },
    toRecipients: to.map((address) => ({ emailAddress: { address } })),
    ccRecipients: cc.map((address) => ({ emailAddress: { address } })),
  };

  const graphRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!graphRes.ok) {
    const detail = await graphRes.text();
    console.error("sendMail failed:", graphRes.status, detail);
    // 403 almost always means the account was connected before Mail.Send was
    // granted — the user needs to reconnect to re-consent.
    if (graphRes.status === 403) {
      return json(
        { error: "Sending isn't authorized yet. Reconnect your email to grant send permission." },
        403
      );
    }
    return json({ error: "Failed to send email" }, 502);
  }

  return json({ success: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
