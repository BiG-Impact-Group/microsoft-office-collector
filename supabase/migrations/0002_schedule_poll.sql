-- =============================================================
-- Schedule the poll-microsoft edge function every minute.
--
-- Apply this AFTER the function is deployed and after the service
-- role key GUC is set, otherwise the cron job will fire but the
-- HTTP call will be unauthorized:
--
--   ALTER DATABASE postgres SET "app.service_role_key" = '<service-role-key>';
--
-- (current_setting(..., true) returns null until that GUC is set, so
-- this migration applies safely even if the key isn't configured yet.)
-- =============================================================

select cron.schedule(
  'poll-microsoft',
  '* * * * *',
  $$
    select net.http_post(
      url     => 'https://swfnxitaxbydcyyffxam.supabase.co/functions/v1/poll-microsoft',
      headers => jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body    => '{}'::jsonb
    );
  $$
);
