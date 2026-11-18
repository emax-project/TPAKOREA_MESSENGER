const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const png2icons = require('png2icons');

const clientRoot = path.join(__dirname, '..');
// TPA KOREA 육각형 심볼(투명 배경, 검정) — 흰 배경 위에 얹어 앱 아이콘을 만든다.
const logoPath = path.join(clientRoot, 'public', 'tpa-icon.png');
const logoPngPath = logoPath;
const outDir = path.join(clientRoot, 'build', 'icons');

/** macOS 스타일 둥근 모서리 적용 (radius ≈ 22%) */
function roundedRectMask(size) {
  const radius = Math.max(2, Math.round(size * 0.22));
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
</svg>`;
  return Buffer.from(svg);
}

/** 흰 정사각 배경 중앙에 심볼을 배치 (심볼 비율 ≈ 60%) */
async function onWhiteSquare(inputBuffer, size) {
  const symbol = await sharp(inputBuffer)
    .resize(Math.round(size * 0.6), Math.round(size * 0.6), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: symbol, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function applyRoundedCorners(inputBuffer, size) {
  const maskSvg = roundedRectMask(size);
  const base = await onWhiteSquare(inputBuffer, size);
  return sharp(base)
    .resize(size, size)
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function main() {
  const inputPath = fs.existsSync(logoPngPath) ? logoPngPath : logoPath;
  if (!fs.existsSync(inputPath)) {
    console.error('Logo not found. Expected:', logoPath, 'or', logoPngPath);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const inputBuffer = fs.readFileSync(inputPath);

  // 1024x1024 base for ico/icns
  const icon1024 = await applyRoundedCorners(inputBuffer, 1024);
  await fs.promises.writeFile(path.join(outDir, 'icon-1024.png'), icon1024);

  // 512x512 for icon.png (Electron 런타임/트레이용)
  const icon512 = await applyRoundedCorners(inputBuffer, 512);
  await fs.promises.writeFile(path.join(outDir, 'icon.png'), icon512);

  // Windows .ico
  const ico = png2icons.createICO(icon1024, png2icons.BICUBIC, false, true);
  if (!ico) throw new Error('ICO generation failed');
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  // macOS .icns
  const icns = png2icons.createICNS(icon1024, png2icons.BICUBIC, false, true);
  if (!icns) throw new Error('ICNS generation failed');
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icns);

  console.log('Icons built from', path.basename(inputPath), '→', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
