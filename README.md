# Immortal+

Immortal+ is a Dota 2 coach for Windows: a live coach with an in-game overlay and voice, a draft helper, and match analysis
for every game you play.

**[Download the latest installer](https://github.com/Hu1k1e/immortalplus-releases/releases/download/latest/Immortal-Plus-Setup.exe)**
(Windows 10 or 11). Installed copies update themselves.

The app is a paid product and its coaching logic is closed source. This repository holds the installers and, because the app
looks at your screen and your game, **everything you need to check what it does with them**.

## Read this first

| | |
|---|---|
| [PRIVACY.md](PRIVACY.md) | What the app reads, what it never reads, and exactly what leaves your PC. One page. |
| [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | How the screen reader and the game-data feed work, in plain words. |
| [SECURITY.md](SECURITY.md) | How to report a privacy or security problem. |

## The code that touches your computer

| File | What it does |
|---|---|
| `scanner/window_capture.py` | Finds the Dota 2 window and captures **only that window**, in memory. |
| `app/dota-locator.js` | Finds the Dota 2 window by its title, so nothing else is read. |
| `app/gsi.js` | Receives Dota's own Game State Integration feed on `127.0.0.1` and installs the one small config file Valve's feature needs. |
| `app/scanner.js` | Starts and stops the screen reader as a background process of the app and shuts it down when you quit. |

The part that decides what a picture means (recognising heroes and items) is not published; [HOW_IT_WORKS.md](HOW_IT_WORKS.md) explains
what it does and what it is limited to.

## Summary of the promises

- It captures **only the Dota 2 window**, the same pixels a screenshot tool or OBS would see, and only while Dota 2 is open.
- It does **not** read the game's memory, inject anything into the game, hook its processes, change game files (apart from the
  one Game State Integration config file Valve documents), press keys or move the mouse.
- Screen images stay in memory and are thrown away after each read. **No screenshot is saved or uploaded.**
- The live coach runs on your PC. Your game feed and the screen reader's output are not uploaded to anyone.

## Check it yourself

1. Read [PRIVACY.md](PRIVACY.md) for the claims and the list of what the app exchanges.
2. Watch the app's network traffic with Wireshark, Fiddler or Windows Resource Monitor while you play. Look for anything that is the size of a
   screenshot or happens as often as the screen is read: there is none.
3. Look at the source here for the capture and the game-feed relay. Both are small.
4. Check that the installer you downloaded is the one published here: the SHA-512 is in `latest.yml` on each release.

## License

All rights reserved. The source in this repository is published so it can be read and audited; it is not licensed for reuse or redistribution.
