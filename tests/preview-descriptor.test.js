import { describe, expect, it } from 'vitest';
import { previewDescriptor } from '../src/app/hooks/useAttachmentTransactions.js';

describe('preview kind: what a file is, when its transport does not say', () => {
  it('reads a generically typed file by its extension', () => {
    // A path in a message carries no type; cvmax's onboarding PNG arrived as
    // application/octet-stream and was refused as "不支持预览".
    expect(previewDescriptor({ name: '03_极简版_冷用户.png', mediaType: 'application/octet-stream' })).toEqual({ kind: 'image', mediaType: 'image/png' });
    expect(previewDescriptor({ name: 'shot.JPG' })).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(previewDescriptor({ resourceId: '/c0/artifacts/demo.mp4', mediaType: '' })).toEqual({ kind: 'video', mediaType: 'video/mp4' });
    expect(previewDescriptor({ name: 'voice.m4a', mediaType: 'binary/octet-stream' })).toEqual({ kind: 'audio', mediaType: 'audio/mp4' });
  });

  it('trusts a real declared type over the name', () => {
    expect(previewDescriptor({ name: 'misnamed.png', mediaType: 'text/plain' })).toEqual({ kind: 'text', mediaType: 'text/plain' });
    expect(previewDescriptor({ name: 'photo', mediaType: 'image/webp' })).toEqual({ kind: 'image', mediaType: 'image/webp' });
  });

  it('keeps an unknown binary unsupported', () => {
    expect(previewDescriptor({ name: 'archive.bin', mediaType: 'application/octet-stream' }).kind).toBe('unsupported');
  });
});
