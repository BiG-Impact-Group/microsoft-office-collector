-- =============================================================
-- Schedule process-attachments + index-documents every minute.
-- Same auth model as the other crons (0002 / 0008): anon key for the gateway,
-- x-poll-secret read from the app.poll_secret DB setting (set out-of-band).
-- =============================================================

select cron.schedule(
  'process-attachments',
  '* * * * *',
  $$
    select net.http_post(
      url     => 'https://swfnxitaxbydcyyffxam.supabase.co/functions/v1/process-attachments',
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

select cron.schedule(
  'index-documents',
  '* * * * *',
  $$
    select net.http_post(
      url     => 'https://swfnxitaxbydcyyffxam.supabase.co/functions/v1/index-documents',
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
