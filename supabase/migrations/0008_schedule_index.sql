-- =============================================================
-- Schedule index-emails every minute: embeds any emails missing chunks
-- (backfill + keeps up with newly polled mail) in small CPU-safe batches.
--
-- Same auth model as the poll cron (0002): the anon key satisfies the
-- gateway's verify_jwt and the function authorizes on x-poll-secret, read
-- from the app.poll_secret DB setting (set out-of-band; never committed).
-- =============================================================

select cron.schedule(
  'index-emails',
  '* * * * *',
  $$
    select net.http_post(
      url     => 'https://swfnxitaxbydcyyffxam.supabase.co/functions/v1/index-emails',
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
