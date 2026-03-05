import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

const sizes = [16, 48, 128];
const outDir = 'public/icons';

mkdirSync(outDir, { recursive: true });

function isInLetterD(nx, ny) {
  const leftEdge = 0.32, barWidth = 0.12;
  const topEdge = 0.25, bottomEdge = 0.75;
  const rightEdge = 0.68;

  if (nx >= leftEdge && nx <= leftEdge + barWidth && ny >= topEdge && ny <= bottomEdge) return true;
  if (ny >= topEdge && ny <= topEdge + barWidth && nx >= leftEdge && nx <= rightEdge - 0.05) return true;
  if (ny >= bottomEdge - barWidth && ny <= bottomEdge && nx >= leftEdge && nx <= rightEdge - 0.05) return true;

  const arcCx = rightEdge - 0.05, arcCy = 0.5;
  const adx = (nx - arcCx) / 0.18, ady = (ny - arcCy) / 0.25;
  const arcDist = adx * adx + ady * ady;
  if (arcDist <= 1 && arcDist >= 0.55 && nx >= rightEdge - 0.15) return true;

  return false;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function createPNG(size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const ihdr = makeChunk('IHDR', ihdrData);

  const rawData = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2, cy = size / 2;
  const r = size * 0.4;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 4 + 1);
    rawData[rowOffset] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        const nx = x / size, ny = y / size;
        if (isInLetterD(nx, ny)) {
          rawData[px] = 255; rawData[px+1] = 255; rawData[px+2] = 255; rawData[px+3] = 255;
        } else {
          rawData[px] = 59; rawData[px+1] = 130; rawData[px+2] = 246; rawData[px+3] = 255;
        }
      } else if (dist <= r + 1) {
        const alpha = Math.max(0, Math.min(255, Math.round((r + 1 - dist) * 255)));
        rawData[px] = 59; rawData[px+1] = 130; rawData[px+2] = 246; rawData[px+3] = alpha;
      }
    }
  }

  const compressed = deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

for (const size of sizes) {
  const png = createPNG(size);
  const path = `${outDir}/icon${size}.png`;
  writeFileSync(path, png);
  console.log(`Generated ${path} (${png.length} bytes)`);
}

console.log('Icons generated successfully!');
