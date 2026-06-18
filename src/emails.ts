import { supabase } from "./lib/supabase.js";

export interface Email {
  id: string;
  account_id: string;
  subject: string;
  from_address: string;
  preview: string;
  body_html: string;
  received_at: string;
  is_read: boolean;
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

export async function fetchEmails(accountId: string): Promise<Email[]> {
  const { data, error } = await supabase
    .from("emails")
    .select("id, account_id, subject, from_address, preview, body_html, received_at, is_read")
    .eq("account_id", accountId)
    .order("received_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []) as Email[];
}
