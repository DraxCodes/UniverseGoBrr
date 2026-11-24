# Windows PowerShell 5.1 writes text files as cp1252 and corrupts UTF-8

Written 2026-11-24 against Windows PowerShell 5.1.26100 (Desktop edition) on Windows 11, while
batch-editing a 16 KB markdown handoff. The shell in this harness is PowerShell 5.1, not PowerShell
7.

## Symptom

A whole-file replace through the shell — `(Get-Content $f -Raw).Replace(...) | Set-Content $f` —
leaves a file that the `edit` tool then refuses to touch:

```
file is not valid UTF-8. It was left unchanged because rewriting it as text would replace
every byte that is not UTF-8 with U+FFFD
```

In the console the damage looks like `?` or `?"` where an em dash used to be. Every character
outside cp1252 becomes a literal `?`, so the corruption is lossy and silent.

## Cause

PowerShell 5.1's `Set-Content`, `Out-File`, `Add-Content` and `>` default to the **ANSI codepage**
(`[System.Text.Encoding]::Default`), which is **1252** on this machine — not UTF-8. `Get-Content`
decodes with the same codepage, so the round trip is lossy in both directions:

- the three UTF-8 bytes `E2 80 94` (em dash) are read as three cp1252 characters and written back
  as garbage, or collapsed to one `0x97`;
- anything cp1252 cannot represent (thin spaces, arrows, `≈`) is written as `?`.

**`Add-Content` is not the safe half of this.** Appending a here-string containing `·` or `°` to an
otherwise-UTF-8 file writes those two chars as single cp1252 bytes (`0xB7`, `0xB0`), so a file that
was valid UTF-8 becomes a *mixed* file with two invalid sequences in the new text and valid
multibyte sequences above it. The `edit` tool then refuses the whole file even though the damage is
two bytes. Append with the `write` tool or a Node script, never with `Add-Content`.

PowerShell 7 defaults to UTF-8 and does not do this. The harness runs 5.1.

The console is a second, separate trap: `[Console]::OutputEncoding` here is **OEM 850**, so a
perfectly valid UTF-8 file still renders as `?"` in `Select-String` output. Do not diagnose a file
from console display — check the bytes.

## Diagnose

```powershell
$bytes = [System.IO.File]::ReadAllBytes($f)
try { [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes) | Out-Null; 'valid UTF-8' }
catch { "invalid: $($_.Exception.Message)" }
```

To find the damaged positions, decode as above but count non-ASCII bytes and their offsets:

```powershell
for ($i = 0; $i -lt $bytes.Length; $i++) {
  if ($bytes[$i] -gt 127) { "{0} 0x{1:X2}" -f $i, $bytes[$i] }
}
```

A `0x97` sitting where an em dash belongs is the signature: the file was written as cp1252 and
needs re-encoding, not rewriting.

## What to do instead

1. **Use the `edit` and `write` tools** for any file containing non-ASCII text. They preserve the
   existing encoding and line endings.
2. If a whole-file replace is genuinely needed, do it in Node, which is UTF-8 by default:

   ```powershell
   node --input-type=module -e "import {readFile,writeFile} from 'node:fs/promises'; const p=process.argv[1]; const t=await readFile(p,'utf8'); await writeFile(p,t.replaceAll('a','b'),'utf8');" $file
   ```

   (PowerShell 5.1 mangles quotes in native-command arguments — put the script in a `.mjs` file
   instead of inlining it, as this repo's scratch scripts do.)
3. If you must stay in PowerShell, `-Encoding UTF8` on 5.1 writes **UTF-8 with a BOM**, which then
   breaks JSON and other strict parsers. `utf8NoBOM` exists only in PowerShell 7.
4. Never `Set-Content` a file that the `edit` tool also writes. Mixed tooling is how the damage got
   in.

## Repair, if it already happened

Decode **valid UTF-8 sequences as UTF-8** and route only invalid bytes through cp1252 — a blanket
`Get-Content | Set-Content -Encoding UTF8` turns every good em dash into `?` on the way back. The
throwaway script that did this for the handoff decoded with `TextDecoder('utf-8', { fatal: true })`
per candidate sequence, fell back to a cp1252 map for single bytes, and reported each repair so the
result could be checked. It found exactly one damaged byte.

A second trap in the repair itself: reading the whole file as cp1252 and writing it back as UTF-8
**double-encodes the bytes that were already valid**. Each byte of an existing `E2 88 92` becomes a
cp1252 character, and re-encoding turns one 3-byte character into nine bytes of mojibake — the file
is still valid UTF-8, so the `edit` tool now accepts it and quietly saves the garbage. Repair at the
byte level (replace only the invalid single bytes with their UTF-8 sequences), then read the touched
lines back and compare them with what you meant to write.

After repairing, verify rather than trust: the file should validate as UTF-8 and keep its original
line endings (`CRLF count` and `bare LF` from the byte view above).