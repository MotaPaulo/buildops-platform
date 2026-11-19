-- The app uploads the photo before inserting the movement. If the database rejects the movement
-- (insufficient balance, permission), the app deletes the photo so no orphan file is left behind.
-- Only the uploader can delete, and only while no movement references the photo:
-- a photo attached to a movement is as immutable as the movement history itself.

create policy movement_photos_delete_unused on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'movement-photos'
    and owner_id = (select auth.uid())::text
    and not exists (
      select 1 from public.stock_movements m where m.photo_path = storage.objects.name
    )
  );
