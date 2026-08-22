-- Brevado — audio storage bucket
-- Private bucket; objects are namespaced by user id so RLS can scope access
-- per-user based on the object's own path, same as the recordings table.
-- Expected path shape: {user_id}/{recording_id}.m4a

insert into storage.buckets (id, name, public)
values ('recordings-audio', 'recordings-audio', false)
on conflict (id) do nothing;

-- storage.foldername(name) splits the object path on '/' and returns it as an
-- array, so foldername(name)[1] is the first path segment — the user id prefix.

create policy "Users can read their own audio files"
  on storage.objects for select
  using (
    bucket_id = 'recordings-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload their own audio files"
  on storage.objects for insert
  with check (
    bucket_id = 'recordings-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own audio files"
  on storage.objects for update
  using (
    bucket_id = 'recordings-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'recordings-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No delete policy: the 7-day retention cleanup runs from the backend with the
-- service role key, which bypasses RLS, so client-side delete access isn't
-- needed for that flow. Add one deliberately if a manual "delete recording"
-- feature shows up.
