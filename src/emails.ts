import { supabase } from "./lib/supabase.js";

export type EmailCategory = "urgent" | "primary" | "promotions" | "junk" | "sent";

export interface Email {
  id: string;
  account_id: string;
  subject: string;
  from_address: string;
  preview: string;
  body_html: string;
  received_at: string;
  is_read: boolean;
  category: EmailCategory | null;
  to_recipients: string[];
  cc_recipients: string[];
}

export interface ConnectedAccount {
  id: string;
  provider_account_email: string;
}

export async function getMicrosoftAccount(): Promise<ConnectedAccount | null> {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("id, provider_account_email")
    .eq("provider", "microsoft")
    .maybeSingle();

  if (error) throw error;
  return data as ConnectedAccount | null;
}

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error("Not signed in");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/send-mail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Server error (${res.status})`);
  }
}

export async function searchEmails(query: string): Promise<Email[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error("Not signed in");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Server error (${res.status})`);
  }

  const data = (await res.json()) as { results: Email[] };
  return data.results ?? [];
}

export async function fetchEmails(accountId: string): Promise<Email[]> {
  const { data, error } = await supabase
    .from("emails")
    .select("id, account_id, subject, from_address, preview, body_html, received_at, is_read, category, to_recipients, cc_recipients")
    .eq("account_id", accountId)
    .order("received_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []) as Email[];
}
