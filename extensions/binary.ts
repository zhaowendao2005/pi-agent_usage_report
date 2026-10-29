/**
 * Binary format / architecture inspection without spawning anything.
 *
 * Why: the npm package name (`usage-report-darwin-arm64`) is a *claim*. It can
 * be wrong — a release script bug, a cross-arch build, a pnpm
 * `supportedArchitectures` install, or a user copying files around. Blindly
 * exec'ing a wrong-arch binary gives "Bad CPU type in executable" or, worse on
 * Intel, silently runs under Rosetta.
 *
 * So every candidate is verified from its header before we exec it. Universal
 * (fat) binaries pass if they contain a slice for the current arch.
 */

import { openSync, readSync, closeSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { arch as hostArch, platform as hostPlatform } from "node:os";

/* CPU type constants */
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;
const CPU_TYPE_X86 = 0x00000007;

/* Mach-O magics (read as big-endian uint32) */
const MH_MAGIC = 0xfeedface;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM = 0xcefaedfe;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const FAT_CIGAM = 0xbebafeca;
const FAT_CIGAM_64 = 0xbfbafeca;

/* ELF / PE */
const ELF_MAGIC = 0x7f454c46;
const EM_X86_64 = 0x3e;
const EM_AARCH64 = 0xb7;
const PE_X64 = 0x8664;
const PE_ARM64 = 0xaa64;

export type BinaryCheck =
  | { ok: true; format: "mach-o" | "mach-o-universal" | "elf" | "pe"; arch: string; size: number }
  | { ok: false; reason: string };

function mapMachArch(cputype: number): string {
  switch (cputype) {
    case CPU_TYPE_ARM64:
      return "arm64";
    case CPU_TYPE_X86_64:
      return "x64";
    case CPU_TYPE_X86:
      return "ia32";
    default:
      return `cputype:0x${cputype.toString(16)}`;
  }
}

function mapElfArch(eMachine: number): string {
  if (eMachine === EM_AARCH64) return "arm64";
  if (eMachine === EM_X86_64) return "x64";
  return `emachine:0x${eMachine.toString(16)}`;
}

function mapPeArch(machine: number): string {
  if (machine === PE_ARM64) return "arm64";
  if (machine === PE_X64) return "x64";
  return `machine:0x${machine.toString(16)}`;
}

/** Architecture of the running process, which is what we must satisfy. */
export function expectedArch(): string {
  return hostArch() === "arm64" ? "arm64" : hostArch() === "x64" ? "x64" : hostArch();
}

/**
 * Verify that `path` is an executable for the current OS/arch.
 * Reads at most 4 KiB — cheap enough to run on every spawn.
 */
export function checkBinary(path: string, expected = expectedArch()): BinaryCheck {
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) return { ok: false, reason: "not a regular file" };
    size = st.size;
    if (size < 1024) return { ok: false, reason: `suspiciously small (${size} B) — truncated download?` };
  } catch (err) {
    return { ok: false, reason: `unreadable: ${(err as Error).message}` };
  }

  let buf: Buffer;
  try {
    buf = Buffer.alloc(4096);
    const fd = openSync(path, "r");
    try {
      const n = readSync(fd, buf, 0, buf.length, 0);
      buf = buf.subarray(0, n);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    return { ok: false, reason: `cannot read header: ${(err as Error).message}` };
  }
  if (buf.length < 64) return { ok: false, reason: "truncated header" };

  const magic = buf.readUInt32BE(0);

  /* ---- Mach-O (thin) ---- */
  if (magic === MH_MAGIC_64 || magic === MH_MAGIC || magic === MH_CIGAM_64 || magic === MH_CIGAM) {
    const swapped = magic === MH_CIGAM || magic === MH_CIGAM_64;
    const cputype = swapped ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
    const what = mapMachArch(cputype);
    if (what !== expected) return { ok: false, reason: `mach-o arch ${what}, need ${expected}` };
    return { ok: true, format: "mach-o", arch: what, size };
  }

  /* ---- Mach-O (universal / fat) ---- */
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64 || magic === FAT_CIGAM || magic === FAT_CIGAM_64) {
    const swapped = magic === FAT_CIGAM || magic === FAT_CIGAM_64;
    const wide = magic === FAT_MAGIC_64 || magic === FAT_CIGAM_64;
    const count = swapped ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
    if (count === 0 || count > 32) return { ok: false, reason: `implausible fat arch count ${count}` };
    const entrySize = wide ? 32 : 20;
    const holes = 8 + count * entrySize;
    if (buf.length < holes) return { ok: false, reason: "truncated fat header" };
    const arches: string[] = [];
    for (let i = 0; i < count; i++) {
      const off = 8 + i * entrySize;
      const cputype = swapped ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
      arches.push(mapMachArch(cputype));
    }
    if (!arches.includes(expected)) {
      return { ok: false, reason: `universal binary has [${arches.join(", ")}], need ${expected}` };
    }
    return { ok: true, format: "mach-o-universal", arch: arches.join("+"), size };
  }

  /* ---- ELF ---- */
  if (magic === ELF_MAGIC) {
    const what = mapElfArch(buf.readUInt16LE(18));
    if (expected === "arm64" && what !== "arm64") {
      return { ok: false, reason: `elf arch ${what}, need ${expected}` };
    }
    if (expected === "x64" && what !== "x64") {
      return { ok: false, reason: `elf arch ${what}, need ${expected}` };
    }
    return { ok: true, format: "elf", arch: what, size };
  }

  /* ---- PE (Windows) ---- */
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const peOff = buf.readUInt32LE(0x3c);
    if (peOff + 6 > buf.length) return { ok: false, reason: "truncated PE header" };
    if (buf.readUInt32BE(peOff) !== 0x50450000) return { ok: false, reason: "MZ without PE signature" };
    const what = mapPeArch(buf.readUInt16LE(peOff + 4));
    if (what !== expected) return { ok: false, reason: `pe arch ${what}, need ${expected}` };
    return { ok: true, format: "pe", arch: what, size };
  }

  return { ok: false, reason: `unknown format (magic 0x${magic.toString(16)}) on ${hostPlatform()}` };
}

/** sha256 of a file, used to verify downloaded binaries. */
export function sha256File(path: string): string {
  const hash = createHash("sha256");
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(path, "r");
  try {
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
      pos += n;
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}
