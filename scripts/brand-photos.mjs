// Cuts the brand photos the app shows out of the four source photos of the design system.
//
//   node scripts/brand-photos.mjs "<folder with red-studio.png, dusk-friends.png, fizz-macro.png, portrait-studio.png>"
//
// The results land in content/brand/, which is NOT in git: the photos are internal brand
// material and this repository is public. Copy that folder to the server next to the code
// (see README, "Brand photos"). Without it the app still works: photo blocks turn flat.
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/brand-photos.mjs <folder with the four source photos>');
  process.exit(1);
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../content/brand');

/** name -> [source file, left, top, width, height (in source pixels), output width] */
const CUTS = {
  // Welcome: the red wall on the left, the crew at work on the right.
  welcome: ['red-studio.png', 700, 0, 1152, 1152, 1080],
  // Task covers.
  'task-shoot': ['red-studio.png', 1000, 0, 1048, 1152, 1048],
  'task-friends': ['dusk-friends.png', 20, 0, 1560, 1152, 1280],
  'task-fizz': ['fizz-macro.png', 760, 0, 1640, 1440, 1280],
  // Paid offer: the portrait, with the dark wall kept for the words.
  offer: ['portrait-studio.png', 960, 0, 1088, 1152, 1088],
  // News thumbnail.
  news: ['fizz-macro.png', 0, 0, 1440, 1440, 480],
};

await mkdir(out, { recursive: true });
for (const [name, [file, left, top, width, height, outWidth]] of Object.entries(CUTS)) {
  const target = join(out, `${name}.webp`);
  const info = await sharp(join(source, file)).extract({ left, top, width, height }).resize({ width: outWidth }).webp({ quality: 80 }).toFile(target);
  console.log(`${name}.webp  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB`);
}
