# Signed Shortcuts «Мозг» and «Мозг-напомнить»

Sources: `brain.cherri`, `remind.cherri` ([Cherri](https://github.com/electrikmilk/cherri) v2.3.0, GPL-2.0, no Windows binary: build from source).
Output (committed, served by Pages): `public/shortcuts/Мозг.shortcut`, `public/shortcuts/Мозг-напомнить.shortcut`, linked from `install/index.html` and the help sheet (`src/ui/shortcut-help.ts`).

Rebuild (Windows, no Docker):
1. `git -c core.autocrlf=false clone --depth 1 --branch v2.3.0 https://github.com/electrikmilk/cherri` (CRLF breaks Cherri's embedded action files: «Expected enumeration raw string»).
2. In it: `go build -o cherri.exe .` (portable Go is enough).
3. Here: `cherri.exe brain.cherri --hubsign` and `cherri.exe remind.cherri --hubsign`. `--hubsign` sends the plist (no user data, no key) to RoutineHub's HubSign service and gets back an Apple-signed AEA1 file. `--skip-sign --debug` writes the plist only.
4. Copy the two `.shortcut` files to `public/shortcuts/` with the exact names above (the app calls «Мозг-напомнить» by name).
5. Check: `python tools/shortcuts/inspect-signed.py public/shortcuts/Мозг.shortcut` — `certs: 2+`, actions dictatetext → urlencode → gettext → openurl; «Мозг-напомнить»: detect.dictionary → getvalueforkey ×2 → detect.date → addnewreminder. `e2e/install.spec.ts` checks the files are served and start with `AEA1`.

The site URL inside «Мозг» is hard-coded (`brain.cherri`): rebuild if the Pages URL changes.
