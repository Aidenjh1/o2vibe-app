/**
 * CRC-8, polynomial 0x07, init 0x00, no reflection, no xor-out ("CRC-8/SMBUS").
 *
 * This is what every legacy O2 reference uses: the vendor SDK's lookup table (BleCRC.java)
 * starts 0x00,0x07,0x0E,0x09… and the bit-trick versions in o2r / farolone are the same
 * function. Computed over every byte of the frame except the trailing CRC byte.
 */
const TABLE = (() => {
  const t = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff
    t[i] = c
  }
  return t
})()

export function crc8(data: ArrayLike<number>, start = 0, end = data.length): number {
  let crc = 0
  for (let i = start; i < end; i++) crc = TABLE[(crc ^ data[i]) & 0xff]
  return crc
}

/** Port of the "hybrid" implementation published in o2r / farolone docs (kept for cross-check tests). */
export function crc8ReferenceO2r(data: ArrayLike<number>): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    const chk = crc ^ data[i]
    crc = 0
    if (chk & 0x01) crc = 0x07
    if (chk & 0x02) crc ^= 0x0e
    if (chk & 0x04) crc ^= 0x1c
    if (chk & 0x08) crc ^= 0x38
    if (chk & 0x10) crc ^= 0x70
    if (chk & 0x20) crc ^= 0xe0
    if (chk & 0x40) crc ^= 0xc7
    if (chk & 0x80) crc ^= 0x89
  }
  return crc
}
