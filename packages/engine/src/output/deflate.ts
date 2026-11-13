/**
 * zlib streams (RFC 1950/1951) in plain TypeScript, for the PDF writer: the
 * engine has no DOM or Node APIs, and one compressor on every host keeps the
 * files byte-identical between the app and the command line.
 *
 * - inflate: full decoder (stored, fixed and dynamic blocks); reads the
 *   tables of WOFF fonts.
 * - deflate: LZ77 with hash chains and the fixed Huffman code, one block.
 *   Not as tight as zlib's dynamic codes, but drawing streams are repetitive
 *   text and shrink to a fifth or less.
 */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

interface Huffman {
  count: Uint16Array;
  symbol: Uint16Array;
}

function huffman(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(16);
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lengths[i]!]!++;
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len]! + count[len]!;
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]!]!++] = i;
  return { count, symbol };
}

const FIXED = ((): { lit: Huffman; dist: Huffman } => {
  const l = new Uint8Array(288);
  for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
  return { lit: huffman(l, 288), dist: huffman(new Uint8Array(30).fill(5), 30) };
})();

/** Decodes a zlib stream. Throws on damaged data (a broken font file is a host bug, not user data). */
export function inflate(data: Uint8Array): Uint8Array {
  let pos = 2; // zlib header
  let bitBuf = 0;
  let bitCnt = 0;
  const bits = (n: number): number => {
    while (bitCnt < n) {
      if (pos >= data.length) throw new Error("inflate: unexpected end of data");
      bitBuf |= data[pos++]! << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const c = h.count[len]!;
      if (code - c < first) return h.symbol[index + (code - first)]!;
      index += c;
      first += c;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("inflate: bad code");
  };

  let out = new Uint8Array(Math.max(1024, data.length * 4));
  let n = 0;
  const need = (k: number): void => {
    if (n + k <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, n + k));
    bigger.set(out.subarray(0, n));
    out = bigger;
  };

  for (let last = 0; !last; ) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      const len = data[pos]! | (data[pos + 1]! << 8);
      pos += 4;
      need(len);
      out.set(data.subarray(pos, pos + len), n);
      n += len;
      pos += len;
      continue;
    }
    if (type === 3) throw new Error("inflate: bad block type");
    let lit = FIXED.lit;
    let dist = FIXED.dist;
    if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]!] = bits(3);
      const clh = huffman(cl, 19);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(clh);
        if (sym < 16) lengths[i++] = sym;
        else {
          const prev = sym === 16 ? lengths[i - 1]! : 0;
          let rep = sym === 16 ? 3 + bits(2) : sym === 17 ? 3 + bits(3) : 11 + bits(7);
          while (rep--) lengths[i++] = prev;
        }
      }
      lit = huffman(lengths.subarray(0, nlen), nlen);
      dist = huffman(lengths.subarray(nlen), ndist);
    }
    for (;;) {
      const sym = decode(lit);
      if (sym === 256) break;
      if (sym < 256) {
        need(1);
        out[n++] = sym;
        continue;
      }
      const len = LEN_BASE[sym - 257]! + bits(LEN_EXTRA[sym - 257]!);
      const ds = decode(dist);
      const d = DIST_BASE[ds]! + bits(DIST_EXTRA[ds]!);
      if (d > n) throw new Error("inflate: distance too far back");
      need(len);
      for (let k = 0; k < len; k++, n++) out[n] = out[n - d]!;
    }
  }
  return out.slice(0, n);
}

const LEN_SYM = ((): Uint8Array => {
  const t = new Uint8Array(259);
  for (let s = 0; s < 29; s++) for (let l = LEN_BASE[s]!; l <= (s === 28 ? 258 : LEN_BASE[s + 1]! - 1); l++) t[l] = s;
  return t;
})();

const distSym = (d: number): number => {
  let lo = 0;
  let hi = 29;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (DIST_BASE[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const reverse = (code: number, len: number): number => {
  let r = 0;
  for (let i = 0; i < len; i++) r |= ((code >> i) & 1) << (len - 1 - i);
  return r;
};

/** Compresses to a zlib stream. Deterministic: the same input gives the same bytes on every host. */
export function deflate(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil((data.length * 9) / 8) + 16);
  let n = 0;
  out[n++] = 0x78;
  out[n++] = 0x9c;
  let bitBuf = 0;
  let bitCnt = 0;
  const put = (v: number, len: number): void => {
    bitBuf |= v << bitCnt;
    bitCnt += len;
    while (bitCnt >= 8) {
      out[n++] = bitBuf & 0xff;
      bitBuf >>>= 8;
      bitCnt -= 8;
    }
  };
  // Fixed code, bits already reversed for the LSB-first writer.
  const litCode = new Uint16Array(288);
  const litLen = new Uint8Array(288);
  for (let s = 0; s < 288; s++) {
    const [code, len] = s < 144 ? [0x30 + s, 8] : s < 256 ? [0x190 + s - 144, 9] : s < 280 ? [s - 256, 7] : [0xc0 + s - 280, 8];
    litCode[s] = reverse(code, len);
    litLen[s] = len;
  }
  const sym = (s: number): void => put(litCode[s]!, litLen[s]!);

  put(1, 1); // last block
  put(1, 2); // fixed Huffman

  const HASH = 1 << 15;
  const head = new Int32Array(HASH).fill(-1);
  const prev = new Int32Array(data.length);
  const hash = (i: number): number => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & (HASH - 1);
  const insert = (i: number): void => {
    const h = hash(i);
    prev[i] = head[h]!;
    head[h] = i;
  };
  const end = data.length;
  for (let i = 0; i < end; ) {
    let best = 0;
    let bestDist = 0;
    if (i + 3 <= end) {
      const max = Math.min(258, end - i);
      let cand = head[hash(i)]!;
      for (let chain = 0; cand >= 0 && i - cand <= 32768 && chain < 48; chain++, cand = prev[cand]!) {
        if (data[cand + best] !== data[i + best]) continue;
        let l = 0;
        while (l < max && data[cand + l] === data[i + l]) l++;
        if (l > best) {
          best = l;
          bestDist = i - cand;
          if (l === max) break;
        }
      }
    }
    if (best >= 3) {
      const ls = LEN_SYM[best]!;
      sym(257 + ls);
      if (LEN_EXTRA[ls]) put(best - LEN_BASE[ls]!, LEN_EXTRA[ls]!);
      const ds = distSym(bestDist);
      put(reverse(ds, 5), 5);
      if (DIST_EXTRA[ds]) put(bestDist - DIST_BASE[ds]!, DIST_EXTRA[ds]!);
      for (let k = 0; k < best; k++, i++) if (i + 3 <= end) insert(i);
    } else {
      sym(data[i]!);
      if (i + 3 <= end) insert(i);
      i++;
    }
  }
  sym(256);
  if (bitCnt) put(0, 8 - bitCnt);
  const a = adler32(data);
  out[n++] = a >>> 24;
  out[n++] = (a >>> 16) & 0xff;
  out[n++] = (a >>> 8) & 0xff;
  out[n++] = a & 0xff;
  return out.slice(0, n);
}
