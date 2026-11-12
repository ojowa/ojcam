/** UTF-8 helpers for Hermes, which does not provide TextEncoder/TextDecoder. */
export function utf8Encode(value: string): Uint8Array {
  const bytes: number[] = [];

  for (let i = 0; i < value.length; i++) {
    let codePoint = value.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i++;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint < 0x80) bytes.push(codePoint);
    else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
  }

  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let result = '';
  let i = 0;

  while (i < bytes.length) {
    const first = bytes[i++];
    let codePoint: number;
    let continuationCount: number;
    let minimum: number;

    if (first < 0x80) {
      codePoint = first;
      continuationCount = 0;
      minimum = 0;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      continuationCount = 1;
      minimum = 0x80;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      continuationCount = 2;
      minimum = 0x800;
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07;
      continuationCount = 3;
      minimum = 0x10000;
    } else {
      result += '\ufffd';
      continue;
    }

    let valid = i + continuationCount <= bytes.length;
    for (let j = 0; valid && j < continuationCount; j++) {
      const next = bytes[i++];
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        i--;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }

    if (!valid || codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      result += '\ufffd';
      continue;
    }

    if (codePoint <= 0xffff) result += String.fromCharCode(codePoint);
    else {
      codePoint -= 0x10000;
      result += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
    }
  }

  return result;
}
