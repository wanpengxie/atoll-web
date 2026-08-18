import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const stylesDir = new URL('../src/styles/', import.meta.url);
const tokens = readFileSync(new URL('tokens.css', stylesDir), 'utf8');

function token(name) {
  return tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
}

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('F6 视觉 Token 门禁', () => {
  it('语义文本色在实际浅色表面达到 WCAG AA 正文对比度', () => {
    for (const background of ['global-rail', 'channel-rail', 'workspace', 'surface-muted', 'surface-selected', 'surface-approval']) {
      for (const name of ['text', 'text-muted', 'text-dim']) {
        expect(contrast(token(name), token(background)), `${name} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const name of ['accent', 'agent', 'online', 'warning', 'tool', 'observer', 'business']) {
      expect(contrast(token(name), token('workspace')), `${name} on workspace`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token('white'), token('channel-marker')), 'unread badge').toBeGreaterThanOrEqual(4.5);
  });

  it('颜色、阴影与视觉常量只在 tokens.css 声明', () => {
    const offenders = readdirSync(stylesDir)
      .filter((name) => name.endsWith('.css') && name !== 'tokens.css')
      .flatMap((name) => [...readFileSync(new URL(name, stylesDir), 'utf8').matchAll(/#[0-9a-f]{3,8}|rgba?\(/gi)].map((match) => `${name}:${match[0]}`));
    expect(offenders).toEqual([]);
  });
});
