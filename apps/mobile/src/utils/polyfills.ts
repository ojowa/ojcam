/**
 * Hermes does not provide the web globals btoa/atob.
 * Mirrors the existing utf8.ts approach: pure-JS implementations installed
 * on globalThis so existing call sites keep working.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function btoaPolyfill(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    const c1 = input.charCodeAt(i) & 0xff;
    const hasC2 = i + 1 < input.length;
    const hasC3 = i + 2 < input.length;
    const c2 = hasC2 ? input.charCodeAt(i + 1) & 0xff : 0;
    const c3 = hasC3 ? input.charCodeAt(i + 2) & 0xff : 0;

    output += CHARS[c1 >> 2];
    output += CHARS[((c1 & 3) << 4) | (c2 >> 4)];
    output += hasC2 ? CHARS[((c2 & 15) << 2) | (c3 >> 6)] : '=';
    output += hasC3 ? CHARS[c3 & 63] : '=';
  }
  return output;
}

export function atobPolyfill(input: string): string {
  const clean = input.replace(/=+$/, '');
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const val = CHARS.indexOf(clean[i]);
    if (val === -1) {
      throw new Error('Invalid character in base64 string');
    }
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

const globals = globalThis as Record<string, unknown>;
if (typeof globals.btoa !== 'function') {
  globals.btoa = btoaPolyfill;
}
if (typeof globals.atob !== 'function') {
  globals.atob = atobPolyfill;
}
