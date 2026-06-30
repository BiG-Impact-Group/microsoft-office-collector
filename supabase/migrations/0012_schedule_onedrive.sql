-- =============================================================
-- Schedule poll-onedrive every minute. Same auth model as the other crons
-- (anon key for the gateway + x-poll-secret from app.poll_secret).
-- Inert until an account is reconnected with the Files.Read scope granted.
-- =============================================================

select cron.schedule(
  'poll-onedrive',
  '* * * * *',
  $$
    select net.http_post(
      url     => 'https://swfnxitaxbydcyyffxam.supabase.co/functions/v1/poll-onedrive',
      headers => jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Zm54aXRheGJ5ZGN5eWZmeGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3Mjg1MTUsImV4cCI6MjA5NzMwNDUxNX0.71puoq1kGYenVVjiMtBWdYavWXdCTJFnUdZzf4it3bY',
        'x-poll-secret', current_setting('app.poll_secret', true)
      ),
      body    => '{}'::jsonb,
      timeout_milliseconds => 55000
    );
  $$
);
