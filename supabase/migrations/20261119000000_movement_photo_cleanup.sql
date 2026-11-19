-- O app envia a foto antes de gravar a movimentação. Se o banco recusar o lançamento
-- (saldo insuficiente, permissão), o app apaga a foto para não deixar arquivo órfão.
-- Só quem enviou pode apagar, e só enquanto nenhuma movimentação aponta para a foto:
-- foto anexada a um lançamento é tão imutável quanto o próprio histórico.

create policy movement_photos_delete_unused on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'movement-photos'
    and owner_id = (select auth.uid())::text
    and not exists (
      select 1 from public.stock_movements m where m.photo_path = storage.objects.name
    )
  );
