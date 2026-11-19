import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

export const PHOTO_BUCKET = 'movement-photos';

/** `base64` holds the file contents: reading `uri` with fetch() fails for local files in Expo Go. */
export type PickedPhoto = { uri: string; mimeType: string; base64: string };

const OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true };

/** Opens the camera or the photo library. Returns null if the user cancels. Throws if camera access is denied. */
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
  if (!asset) return null;
  if (!asset.base64) throw new Error('Não foi possível ler a foto. Tente novamente.');
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', base64: asset.base64 };
}

/** Decodes base64 into bytes (atob is available in Hermes and browsers). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True if the bytes start like a JPEG, PNG, WebP or HEIC file. Guards against uploading an error page. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8) || // JPEG
    (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') ||
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') ||
    ascii(4, 8) === 'ftyp' // HEIC/HEIF
  );
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

/** Uploads the photo to {company_id}/{year}/{month}/{uuid}.jpg and returns its bucket path. */
export async function uploadMovementPhoto(companyId: string, photo: PickedPhoto): Promise<string> {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ext = EXTENSIONS[photo.mimeType] ?? 'jpg';
  const path = `${companyId}/${now.getFullYear()}/${month}/${randomUUID()}.${ext}`;

  const body = base64ToBytes(photo.base64);
  if (!looksLikeImage(body)) throw new Error('O arquivo escolhido não é uma imagem válida.');
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, body, { contentType: photo.mimeType });
  if (error) throw new Error(`Falha ao enviar a foto: ${error.message}`);
  return path;
}
