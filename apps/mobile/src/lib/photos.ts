import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

export const PHOTO_BUCKET = 'movement-photos';

export type PickedPhoto = { uri: string; mimeType: string };

const OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };

/** Abre a câmera ou a galeria. Retorna null se o usuário cancelar ou negar a permissão. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickedPhoto | null> {
  if (source === 'camera') {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) throw new Error('Permita o acesso à câmera nas configurações do aparelho.');
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(OPTIONS);

  const asset = result.canceled ? null : result.assets[0];
  return asset ? { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' } : null;
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

/** Envia a foto para {company_id}/{ano}/{mês}/{uuid}.jpg e retorna o caminho no bucket. */
export async function uploadMovementPhoto(companyId: string, photo: PickedPhoto): Promise<string> {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ext = EXTENSIONS[photo.mimeType] ?? 'jpg';
  const path = `${companyId}/${now.getFullYear()}/${month}/${randomUUID()}.${ext}`;

  const body = await (await fetch(photo.uri)).arrayBuffer();
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, body, { contentType: photo.mimeType });
  if (error) throw new Error(`Falha ao enviar a foto: ${error.message}`);
  return path;
}
