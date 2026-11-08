# Timer

A visual routine timer for ADHD brains. It sits in the corner of your screen all day and shows what you should be doing right now, how much of it is left, and what comes next, so you don't have to keep time in your head.

## What it does

- **Always-on widget.** A ring that shrinks as the current block runs out, its name and step, and what's next. It warms from the block's colour to amber to coral near the end. Drag it anywhere; double-click it to open the planner.
- **Day strip.** A thin bar of the whole day under the ring, with a marker for now.
- **Routine.** Blocks with times, days, a colour and optional timed steps (shower 15 min → get dressed 10 min) that move on by themselves.
- **Optional blocks.** For things you don't do every day. When one comes up it asks "start it?" with Start / Skip, and skipping costs nothing.
- **Just for today.** Skip, move or add a one-off block for today only. The routine stays as it is.
- **Heads-ups.** A notification and soft chime 10, 5 and 1 minutes before a block ends (configurable), and before the next block during free time.
- **Hyperfocus guard.** When a block ends, the widget asks how it went (Done / Partly / Skipped). If nobody answers, a notification follows after 5 minutes and a full-screen "time to switch" card after 10. "I'm still on it" gives you 10 more minutes.
- **Session ritual.** Inspired by Flown's set-an-intention → work → share-how-it-went loop.
  - *Before:* when a block starts, the widget asks for your intention. Not now is always fine.
  - *During:* focus mode gives a big ring, your intention and to-dos, and a small flock of birds drifting overhead for company. You can add ambient rain, forest or brown noise, all generated in the app.
  - *After:* the "How did it go?" card takes a one-line note.
- **Growing garden.** Every block you log as Done (2 points) or Partly (1) grows it; skipping is free and nothing ever shrinks. One oak grows from seed to tree. Each fully grown tree starts two seedlings, until 31 trees make a forest, and then wildflowers. It stands on the hill in focus mode and has its own page in the planner. After 3 days away it looks sleepy until you're back.
- **Parking lot.** Press Ctrl+Shift+Space anywhere (or use the tray) to park a stray thought in a small box: type it, press Enter, and you're back to work. Review them later in the planner and turn any into a to-do for one of today's blocks. In free time, the widget reminds you how many are waiting.
- **Hourly ping.** A short tune on every hour, different for each of the 24. Mornings rise bright and high, afternoons arc in the middle, evenings fall low and soft, so even a tune you don't recognise yet tells you roughly what time it is. The widget glows for a moment and says the hour plus what's on ("3 pm · 40m left in Deep work"). Quiet hours (10pm–7am by default), volume, and a preview of every hour's tune are in Settings.
- **Recharge breaks.** A 2-minute guided breathing exercise and a 3-minute stretch sequence, offered in free time between blocks.
- **Tray app.** Lives in the system tray and starts with Windows. The tray menu can hide the widget or lock it so clicks pass through.

## Running it

You need [Node 20+](https://nodejs.org), [Rust](https://rustup.rs) and the Visual Studio C++ Build Tools ("Desktop development with C++"). WebView2 already ships with Windows 11.

```bash
npm install
npm run tauri dev
```

To build an installer (`src-tauri/target/release/bundle/nsis/`):

```bash
npm run tauri build
```

`npm run dev` on its own serves the pages in a normal browser at `http://localhost:1420/widget.html` and `/planner.html`. Outside the app, state goes to localStorage and notifications go to the console, which is handy for working on the UI.

## Layout

| Path | What's there |
| --- | --- |
| `src/model.ts` | Data types, time helpers, the sample routine |
| `src/engine.ts` | Pure logic: today's plan, the current block, prompts, escalation, overlap checks |
| `src/store.ts` | Loads and saves state through the Rust side and keeps windows in sync |
| `src/widget.ts`, `planner.ts`, `overlay.ts`, `focus.ts` | The four windows |
| `src/garden.ts`, `garden-view.ts` | How the garden grows (from block logs) and how it's drawn |
| `src/capture.ts`, `planner-pages.ts` | The parking lot's capture box, and the Garden and Parking lot pages |
| `src/hourly.ts` | The 24 hourly tunes and quiet hours |
| `src/sounds.ts`, `birds.ts` | Synthesised ambient sound and the flock animation |
| `src/styles/theme.css` | Shared palette and fonts (Fraunces + Nunito, bundled) |
| `src-tauri/` | The Tauri shell: tray menu, state file, plugins |

State is one JSON file at `%APPDATA%\com.apoorvbelsare.timer\state.json`.

```bash
npm test
```

runs the engine tests.

## Next up

- Planned vs actual: see how long things really take, against the plan
- Gentle gamification: XP for showing up, a plant that grows, weekly consistency instead of streaks
- Drag and resize blocks on the timeline
