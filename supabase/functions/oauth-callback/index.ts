import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptToken } from "../_shared/crypto.ts";

const AZURE_CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID")!;
const AZURE_CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET")!;
const AZURE_REDIRECT_URI = Deno.env.get("AZURE_REDIRECT_URI")!;
const AZURE_TENANT = Deno.env.get("AZURE_TENANT") ?? "common";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req: Request) => {
  // Browsers send a CORS preflight (OPTIONS) before the cross-origin POST
  // because of the Authorization + Content-Type headers. Answer it.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 1. Verify the caller is an authenticated Supabase user ─
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing authorization" }, 401);
  }
  const userJwt = authHeader.slice(7);

  // Use the user's JWT to get their user_id — anon key is enough here
  // since we only need to verify the token and read uid.
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return json({ error: "Invalid session" }, 401);
  }

  // ── 2. Parse request body ──────────────────────────────────
  let body: { code?: string };
  try {
    body = await req.json() as { code?: string };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const { code } = body;
  if (!code) {
    return json({ error: "Missing authorization code" }, 400);
  }

  // ── 3. Exchange code for tokens ────────────────────────────
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${AZURE_TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        redirect_uri: AZURE_REDIRECT_URI,
        grant_type: "authorization_code",
        code,
        scope: "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Files.Read",
      }),
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("Token exchange failed:", err);
    return json({ error: "Failed to exchange authorization code" }, 502);
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // ── 4. Fetch the user's Microsoft email address ────────────
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!meRes.ok) {
    console.error("Graph /me failed:", await meRes.text());
    return json({ error: "Failed to fetch Microsoft user info" }, 502);
  }

  const me = await meRes.json() as { mail?: string; userPrincipalName?: string };
  const providerEmail = me.mail ?? me.userPrincipalName ?? "";

  // ── 5. Encrypt tokens application-side (AES-256-GCM) ───────
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let encAccess: string;
  let encRefresh: string;
  try {
    encAccess = await encryptToken(tokens.access_token);
    encRefresh = await encryptToken(tokens.refresh_token);
  } catch (err) {
    console.error("Encryption failed:", err);
    return json({ error: "Failed to encrypt tokens" }, 500);
  }

  // ── 6. Upsert into connected_accounts ────────────────────
  const { error: upsertErr } = await adminClient
    .from("connected_accounts")
    .upsert(
      {
        user_id: user.id,
        provider: "microsoft",
        provider_account_email: providerEmail,
        access_token_encrypted: encAccess,
        refresh_token_encrypted: encRefresh,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: "user_id,provider" }
    );

  if (upsertErr) {
    console.error("DB upsert failed:", upsertErr);
    return json({ error: "Failed to store account" }, 500);
  }

  return json({ success: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}
