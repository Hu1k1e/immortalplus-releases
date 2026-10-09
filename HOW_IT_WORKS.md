# How it works

This describes what the app does with your screen and your game, in plain words. It deliberately does not include the recognition
code, the screen coordinates, or the tuning values: those are the product. It does include everything that matters for your privacy.

## 1. The game-data feed (Game State Integration)

Dota 2 has an official feature, **Game State Integration**, that lets other programs receive information about your match.
Tournament broadcasts and many overlays use it. It is **one-way**: Dota sends, nothing can be sent back into the game.

- The app writes a single small config file into Dota's `cfg/gamestate_integration` folder (you press the button in the setup guide).
- Dota then sends a small message about twice a second **to your own PC** (`127.0.0.1`). The relay in `app/gsi.js` accepts only local
  connections and hands each message to the coach running on your PC.
- The messages contain what Valve decided to share: game time, your hero, health and mana, items, cooldowns, minimap events such
  as Roshan and Aegis. They contain nothing about other programs on your PC.
- The relay keeps a short queue and drops old messages, so it can never slow your game.

## 2. The screen reader

Dota does not share the enemy draft or the enemy's items. The screen reader fills that gap by looking at the pixels of your Dota window,
the way a screenshot would.

```
Dota 2 window  ->  one picture in memory  ->  recognise  ->  small facts  ->  your coach, on your PC
```

1. **Find the window.** `app/dota-locator.js` and `scanner/window_capture.py` look for the window titled "Dota 2". Only that window's
   rectangle is captured. If Dota is not open, nothing is captured.
2. **Capture, in memory.** A picture of that window is taken a few times a second during a match. It exists only in memory and is replaced by
   the next one. It is not written to disk and not sent anywhere.
3. **Recognise.** Small parts of the picture are compared with known hero portraits and item icons, and a few short texts (for
   example a ban list or the Aegis announcement) are read as text. This runs on your PC.
4. **Keep only the facts.** What leaves the recognition step is small facts such as "hero 44 is on the enemy team", "this enemy carries
   Blink Dagger", "the Aegis was picked up by hero 12". Never the picture.
5. **Hand over locally.** The facts go to the coach running on your own PC, which uses them for the draft helper and the live tips.

What it never does: read the game's memory, inject code, hook the game, change game files, press keys, move the mouse, read any other
window, or keep a screenshot. A debug switch for developers (off by default) can save a picture to a folder on that PC; it never uploads.

## 3. The coach

The coach turns the game feed and the facts into tips (runes, Roshan and Aegis timers, enemy items, lane plans, what to buy next). It runs
on your PC, so your match is not uploaded to get coached.

## 4. What the Immortal+ service does

The app uses the Immortal+ service for your account sign-in (through Steam, which never shares your password), for your match history and
analysis, and for shared game data such as hero statistics. See [PRIVACY.md](PRIVACY.md) for exactly what is exchanged.

## Why not publish the recognition code?

Because it is the part competitors would copy, and publishing it adds nothing to your privacy: the privacy guarantees come from what is captured
(only the Dota window, in memory) and what leaves the PC (small facts, never pictures), and both can be checked from outside with a network monitor
and from the capture code published here.
