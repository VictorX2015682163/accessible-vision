/* 生成慧眼图标 PNG(纯 Node,无外部依赖)
 * 黑底 + 黄色"眼睛"图形,高对比,符合无障碍视觉。
 * 用法: node make-icons.js
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePNG(size) {
  const cx = size / 2, cy = size / 2;
  const rOuter = size * 0.42, rInner = size * 0.18;
  // 眼睛外轮廓半宽(杏仁形)
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      // 杏仁形眼睛:椭圆 |dx/a|^2 + |dy/b|^2 < 1
      const a = size * 0.44, b = size * 0.26;
      const inEye = (dx * dx) / (a * a) + (dy * dy) / (b * b) < 1;
      const dist = Math.hypot(dx, dy);
      let r = 0, g = 0, bl = 0;               // 默认黑底
      if (inEye) { r = 255; g = 212; bl = 0; } // 黄色眼白
      if (dist < rInner) { r = 0; g = 0; bl = 0; } // 黑瞳孔
      raw[p++] = r; raw[p++] = g; raw[p++] = bl;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const s of [192, 512]) {
  fs.writeFileSync(path.join(dir, `icon-${s}.png`), makePNG(s));
  console.log('wrote icons/icon-' + s + '.png');
}
