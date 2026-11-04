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
| `src/widget.ts`, `planner.ts`, `overlay.ts` | The three windows |
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
