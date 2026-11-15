'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

test('sharp produces the grayscale and RGB buffers used by image deduplication', async () => {
  const source = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: { r: 42, g: 103, b: 191 }
    }
  }).png().toBuffer();

  const gray = await sharp(source)
    .rotate()
    .resize(16, 16, { fit: 'cover', position: 'centre' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    { width: gray.info.width, height: gray.info.height, channels: gray.info.channels },
    { width: 16, height: 16, channels: 1 }
  );
  assert.equal(gray.data.length, 16 * 16);

  const color = await sharp(source)
    .rotate()
    .resize(32, 32, { fit: 'cover', position: 'centre' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    { width: color.info.width, height: color.info.height, channels: color.info.channels },
    { width: 32, height: 32, channels: 3 }
  );
  assert.equal(color.data.length, 32 * 32 * 3);
});
