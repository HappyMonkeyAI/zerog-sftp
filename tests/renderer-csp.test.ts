import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] ?? '';

describe('renderer content security policy', () => {
  it('defines a policy', () => {
    expect(csp).not.toBe('');
  });

  it('allows data: image URLs used for thumbnails', () => {
    const directives = new Map(
      csp.split(';').map(part => part.trim()).filter(Boolean).map(part => {
        const [name, ...values] = part.split(/\s+/);
        return [name.toLowerCase(), values];
      }),
    );
    const imgSrc = directives.get('img-src') ?? directives.get('default-src') ?? [];
    expect(imgSrc).toContain('data:');
  });
});
