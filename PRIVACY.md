# Privacy: what Immortal+ reads, and what leaves your PC

## What is read from your computer

| Source | What is read | How |
|---|---|---|
| The Dota 2 window | Draft picks and bans, the hero stats panel, enemy items, the Aegis announcement text | Pixels of that window only (`scanner/window_capture.py`), turned into hero and item names on your PC |
| Dota 2's Game State Integration | Game time, your hero, health and mana, items, cooldowns, minimap events such as Roshan and Aegis | Valve's official feature: Dota sends to `127.0.0.1` on your PC (`app/gsi.js`) |
| The Dota 2 install folder | Nothing is read. One config file is **written** into `game/dota/cfg/gamestate_integration/` so Valve's feature turns on | `app/gsi.js`, only when you press the button |

**Never read:** the game's memory, other windows or programs, files outside the app's own folder (apart from the config file above),
your keyboard or mouse, your microphone or camera, your Steam password.

## Screen pictures

- Captured in memory, read, and discarded. They are not written to disk, not uploaded, and not kept between reads.
- The only code that can save a picture of your screen is behind a developer switch (`DEBUG_CAPTURES=1`, off by default). It writes to a folder on that PC and never uploads.
- The app also keeps the small hero and item icons it downloads from Valve's image servers. Those are not pictures of your screen.

## What the screen reader produces, and where it goes

The screen reader produces only small facts and hands them to the coach **running on your own PC**:

| Fact | Content |
|---|---|
| Draft | Which heroes were picked and banned, per team |
| Enemy items | A hero and a list of item names |
| Hero stats | A hero and a few numbers read from the stats panel (for example attack damage, armor) |
| Aegis | Which hero picked it up, or denied it |
| Purchases | A hero and an item name |

None of this is a picture. None of it is sent to the Immortal+ service.

## What the app exchanges with the Immortal+ service

- **Sign-in:** through Steam (Steam's own page; your password never reaches the app). The app learns your public account number.
- **Match and game data:** the match IDs it needs and the analysis that comes back; shared game data such as hero statistics. These come
  from the game-data services the app uses; only match IDs, hero IDs and your public Steam account number are involved.
- **Updates:** the app downloads new versions from this repository's releases.

It does **not** upload: screenshots, the screen reader's facts, the live game feed, your keystrokes, your file list, or anything about other
programs on your PC. Live coaching runs entirely on your PC.

## What you can verify, and how

- **Network:** run a network monitor (Wireshark, Fiddler, Resource Monitor) during a match. You will see traffic to your own PC, Valve's servers
  (icons, Steam sign-in), this repository (updates) and the services that provide match and hero data. You will not see anything the size of a
  screenshot, or anything that repeats as often as the screen is read.
- **Capture:** `scanner/window_capture.py` is the code that captures the window, and `app/dota-locator.js` is how it finds it.
- **Game feed:** `app/gsi.js` accepts connections from `127.0.0.1` only.
- **Files:** the app writes only to its own data folder and the one Dota config file. Process Monitor shows this.
- **Installer:** the SHA-512 of each installer is in `latest.yml` on its release.

## Anti-cheat and Valve's rules

Reading the pixels of your own game window and using Valve's Game State Integration are the same techniques used by screen recorders and
tournament overlays. Immortal+ does not read game memory, inject code, or modify game files other than adding the Game State Integration
config file Valve documents.
