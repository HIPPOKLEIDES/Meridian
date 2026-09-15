// Draws Meridian's app icons (the four-color ring from the sidebar) as PNGs, with no image libraries.
// Usage: node scripts/make-icons.mjs   → public/icons/*.png and public/favicon.svg
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const BACKGROUND = [13, 13, 13];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** ringScale: outer ring diameter as a share of the icon. rounded: corner radius share (0 = full bleed). */
function icon(size, { ringScale, rounded = 0 }) {
  const samples = 4;
  const c = size / 2;
  const outer = (size * ringScale) / 2;
  const inner = outer * (5 / 11);
  const corner = size * rounded;
  return png(size, (px, py) => {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const x = px + (sx + 0.5) / samples;
        const y = py + (sy + 0.5) / samples;
        // Rounded-square background.
        const dx = Math.max(corner - x, x - (size - corner), 0);
        const dy = Math.max(corner - y, y - (size - corner), 0);
        if (corner && dx * dx + dy * dy > corner * corner) continue;
        let color = BACKGROUND;
        const r = Math.hypot(x - c, y - c);
        if (r <= outer && r >= inner) {
          // Quarters clockwise from 12 o'clock, like the CSS conic gradient.
          const angle = (Math.atan2(x - c, -(y - c)) + 2 * Math.PI) % (2 * Math.PI);
          color = COLORS[Math.min(3, Math.floor((angle / (2 * Math.PI)) * 4))];
        }
        acc = [acc[0] + color[0], acc[1] + color[1], acc[2] + color[2], acc[3] + 255];
      }
    }
    const n = samples * samples;
    const alpha = acc[3] / n;
    return alpha ? [Math.round(acc[0] / (acc[3] / 255)), Math.round(acc[1] / (acc[3] / 255)), Math.round(acc[2] / (acc[3] / 255)), Math.round(alpha)] : [0, 0, 0, 0];
  });
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon-192.png', out), icon(192, { ringScale: 0.62, rounded: 0.22 }));
writeFileSync(new URL('icon-512.png', out), icon(512, { ringScale: 0.62, rounded: 0.22 }));
// Maskable icons are cropped to a circle or squircle by the OS, so keep the ring inside the safe zone.
writeFileSync(new URL('maskable-512.png', out), icon(512, { ringScale: 0.5 }));
writeFileSync(new URL('apple-touch-icon.png', out), icon(180, { ringScale: 0.6 }));

const quarter = (i) => {
  const a0 = (i * Math.PI) / 2;
  const a1 = ((i + 1) * Math.PI) / 2;
  const p = (r, a) => `${(50 + r * Math.sin(a)).toFixed(2)} ${(50 - r * Math.cos(a)).toFixed(2)}`;
  return `<path fill="rgb(${COLORS[i]})" d="M${p(44, a0)}A44 44 0 0 1 ${p(44, a1)}L${p(20, a1)}A20 20 0 0 0 ${p(20, a0)}Z"/>`;
};
writeFileSync(new URL('../public/favicon.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${[0, 1, 2, 3].map(quarter).join('')}</svg>\n`);
console.log('Icons written to public/icons and public/favicon.svg');
