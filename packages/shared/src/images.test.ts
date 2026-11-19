import { describe, expect, it } from 'vitest';

import { base64ToBytes, looksLikeImage } from './images';

const b64 = (bytes: number[] | string) =>
  Buffer.from(typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)).toString('base64');

// First bytes of each format (padded to 12 bytes).
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const WEBP = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')];
const ftyp = (brand: string) => [0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from(brand)];

describe('base64ToBytes', () => {
  it('decodes plain base64', () => expect([...base64ToBytes(b64(JPEG))]).toEqual(JPEG));
  it('strips a data: URI prefix', () =>
    expect([...base64ToBytes(`data:image/png;base64,${b64(PNG)}`)]).toEqual(PNG));
});

describe('looksLikeImage', () => {
  it.each([
    ['JPEG', JPEG],
    ['PNG', PNG],
    ['WebP', WEBP],
    ['HEIC', ftyp('heic')],
    ['HEIF (mif1)', ftyp('mif1')],
  ])('accepts %s', (_, bytes) => expect(looksLikeImage(Uint8Array.from(bytes))).toBe(true));

  it.each([
    // what Expo Go returned for a local file URI, stored as a "photo" before the fix
    ['error body', [...Buffer.from('File not found')]],
    ['HTML page', [...Buffer.from('<!DOCTYPE html>')]],
    ['MP4 video', ftyp('isom')],
    ['QuickTime video', ftyp('qt  ')],
    ['empty', []],
  ])('rejects %s', (_, bytes) => expect(looksLikeImage(Uint8Array.from(bytes))).toBe(false));
});
