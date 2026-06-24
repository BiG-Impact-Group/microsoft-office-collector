-- =============================================================
-- Schedule the poll-microsoft edge function every minute.
--
-- Auth model (no service-role key in the database):
--   • The gateway requires a valid JWT — we pass the anon key below
--     (publishable, safe to commit).
--   • The function itself authorizes on the x-poll-secret header.
--
-- Before this works, set BOTH of these out-of-band (never commit the value):
--   1. the edge-function secret:
--        supabase secrets set POLL_SECRET=<random>
--   2. the matching DB setting this cron reads:
--        ALTER DATABASE postgres SET app.poll_secret = '<same random>';
--
-- current_setting(..., true) returns null until the GUC is set, so this
-- migration applies safely even before the secret is configured.
-- =============================================================

select cron.schedule(
  'poll-microsoft',
  '* * * * *',
  $$
    select net.http_post(
      url     => 'https://swfnxitaxbydcyyffxam.supabase.co/functions/v1/poll-microsoft',
      headers => jsonb_build_object(
        'Content-Type',  'application/json',
        -- anon key (publishable) satisfies the gateway's verify_jwt
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Zm54aXRheGJ5ZGN5eWZmeGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3Mjg1MTUsImV4cCI6MjA5NzMwNDUxNX0.71puoq1kGYenVVjiMtBWdYavWXdCTJFnUdZzf4it3bY',
        -- shared secret the function checks
        'x-poll-secret', current_setting('app.poll_secret', true)
      ),
      body    => '{}'::jsonb
    );
  $$
);
