/**
 * Minimal, dependency-free ZIP archive writer (STORE method — no compression).
 * Bundling a handful of small CSV text files for a single browser download
 * doesn't need real compression, so this avoids pulling in an external zip
 * library just for that.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time encoding required by the ZIP format's file headers. */
function dosDateTime(date) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function u16(n) {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

/**
 * Build a ZIP archive from a list of text files.
 * @param {Array<{ name: string, content: string }>} files
 * @returns {Blob}
 */
export function buildZip(files) {
  const encoder = new TextEncoder();
  const { dosTime, dosDate } = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, content } of files) {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const localHeader = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // local file header signature
      ...u16(20), // version needed to extract
      ...u16(0), // general purpose flags
      ...u16(0), // compression method: 0 = store
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(size), // compressed size
      ...u32(size), // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0), // extra field length
    ]);
    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, // central directory header signature
      ...u16(20), // version made by
      ...u16(20), // version needed to extract
      ...u16(0), // general purpose flags
      ...u16(0), // compression method
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0), // extra field length
      ...u16(0), // file comment length
      ...u16(0), // disk number start
      ...u16(0), // internal file attributes
      ...u32(0), // external file attributes
      ...u32(offset), // relative offset of local header
    ]);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, // end of central directory signature
    ...u16(0), // disk number
    ...u16(0), // disk with the start of the central directory
    ...u16(files.length), // entries on this disk
    ...u16(files.length), // total entries
    ...u32(centralDirSize),
    ...u32(centralDirOffset),
    ...u16(0), // comment length
  ]);

  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}
