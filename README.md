# Timer

**A calm visual timer for ADHD brains, for your daily routine.**

Timer sits in the empty middle of your taskbar, or in a corner of your screen, all day. It shows what you're meant to be doing right now, how much of it is left as a ring that shrinks, and what comes next, so you don't have to keep time in your head. Around that it adds the things that help an ADHD day hold together: warnings before you have to switch, a nudge when hyperfocus keeps you past the end of a block, a quiet focus mode, a place to park stray thoughts, an hourly tune, and a garden that grows every time you show up.

Everything stays on your PC. There's no account, no cloud and no tracking.

> **`main` has the latest version of Timer (v0.6.1, 8 November 2026)**, and it's the one to install and build from. The other branches are earlier versions and experiments, kept for reference. See [Branches](#branches).

---

## Why it works this way

Many people with ADHD struggle to sense time passing (often called *time blindness*). The usual advice is to **make time visible from outside**. A clock you have to read and work out doesn't help much; a shape that shrinks in front of you does. Timer is built on a few ideas that come up again and again in ADHD research and in well-loved apps:

| Idea | Where it shows up |
| --- | --- |
| Show time as a shape, not a number (Time Timer) | The shrinking ring on the widget and in focus mode |
| Show the whole day, not just the countdown (Tiimo) | The day strip under the ring, and the Today timeline |
| Changing tasks is the hard part | Warnings at 10, 5 and 1 minutes, and a check that you actually switched |
| Hyperfocus needs something to interrupt it | A note on the widget, then a notification, then a full-screen "time to switch" card |
| A ritual around focus work (Flown) | Set an intention, focus, then a one-line "how did it go" |
| Reward showing up, never punish missing (Finch) | A garden that grows and never shrinks; no streaks to break |
| Catch distractions without acting on them | The parking lot, one shortcut away |

---

## Features

### See your time
- **Always-on widget:** a small card that stays on top, wherever you drag it. It shows a ring that shrinks as the current block runs out, the block's name and current step, and what's next. The whole card takes on a deep shade of the current block's colour (purple for a purple Study block, deep blue for a blue evening block), so you can tell which zone you're in at a glance; free time goes back to forest green. The ring changes from the block's colour to amber to coral near the end.
- **Taskbar dock:** the widget can sit inside the taskbar instead, as one wide bar in the empty middle. It shows everything the card does on a single line: ring, block, step or intention, time left, what's next, the day strip, and the Breathe / Stretch / Parked chips. Prompts open as a card just above it.
  - **Drag the bar up** off the taskbar and it becomes the floating card again. **Drag the card onto the taskbar** and it docks. Drag the bar sideways to move it along the taskbar.
  - It stays above the taskbar when you click the taskbar, and hides while a fullscreen video, game or presentation is up.
  - It suits a taskbar with left-aligned icons (Settings → Personalization → Taskbar → Taskbar behaviors → Taskbar alignment: Left), so the middle is free.
- **Day strip:** a thin bar of your whole day under the ring, with a marker for "now".
- **Hourly ping:** a short tune on every hour, different for each of the 24. Morning tunes rise and sound bright, afternoon tunes go up then down, and evening tunes fall low and soft. So even a tune you haven't learned yet tells you roughly what time it is. The widget glows for a moment and says the hour plus what's on ("3 pm · 40m left in Deep work"). It stays silent during quiet hours (10pm–7am by default).

### Plan your routine
- **Routine blocks:** each block has a time, days of the week, and a colour. It can also have **timed steps** that move on by themselves (shower 15 min → get dressed 10 min → breakfast 15 min).
- **Optional blocks:** for things you don't do every day. Instead of starting on their own, they ask "Start or skip?", and skipping costs nothing.
- **Overlapping blocks:** blocks can share the same time. The one that started most recently is shown in front, and the widget lists the others as "Also on". A 10:00 call inside a 9–12 Deep work block takes over for its half hour, then Deep work comes back. On the Today page, overlapping blocks sit side by side.
- **Just for today:** skip, move or add a one-off block for today only. Your usual routine stays as it is.

### Anchors, not just clocks
Time blindness makes "at 09:00" hard to act on; "after breakfast" is much easier. So blocks can hang off things that happen.
- **Chained blocks:** a block can start **after another block is done**, or **after one of your events**, instead of at a clock time (Routine → Starts). It keeps its planned slot on the Today page and runs for that long from whenever it actually starts. If it moves, the Today page shows where it ran in solid colour, with the planned slot as a dashed outline behind it, and the widget says "planned 09:00". You can give it a **latest start** so it begins anyway if the anchor never comes.
- **Finish early:** the ✓ on the widget ends the current block now and starts whatever is chained after it.
- **Your events:** moments you mark as they happen, like "Ate lunch", "Back from gym" or "Kids in bed" (Settings → Your events). Mark them from the tray's **Mark an event** menu, your own hotkey, or the buttons on the Today page. Each one shows on the Today timeline at the time you marked it.
- **Check out / check in:** tell Timer when you step away (widget door icon, tray, or **Ctrl + Alt + C**). While you're out, reminders pause. When you check back in, a **return ritual** walks you through your steps (editable in Settings), then shows where you left off, with **Resume**, **Switch** or **I'm stuck**.
- **I'm stuck:** the **?** on the widget (or the tray) opens a picker of tasks from your own Markdown task list: everything under a **To do** or **In progress** heading (Settings → Task list). Pick one and it gives you five minutes to just start it, then asks whether to keep going (it becomes the block's intention) or pick another.

### Stay on track
- **Warnings** with a soft chime and a notification before a block ends, or before the next one starts during free time.
- **Hyperfocus guard:** when a block ends, the widget asks how it went (Done / Partly / Skipped). If you don't answer, a notification follows after 5 minutes, then a full-screen "time to switch" card after 10. "I'm still on it" gives you 10 more minutes.

### Focus, with company
- **Session ritual:** when a block starts, the widget asks for your intention (you can always say "not now"). When it ends, you can add a one-line note on how it went.
- **Focus mode:** a calm full-screen window with a big ring, your intention and to-dos, and a small flock of birds drifting overhead so you're not alone. You can add **rain, forest or brown-noise** sound, all generated in the app.
- **Recharge breaks:** a 2-minute guided breathing exercise and a 3-minute stretch sequence, offered during free time.

### Motivation and clear headspace
- **Growing garden:** every block you log as **Done** (2 points) or **Partly** (1 point) helps it grow.
  - It starts with one oak, which grows from seed to a full tree. Each grown tree starts two new seedlings beside it, and so on (1 → 2 → 4 → 8 → 16), until **31 trees make a forest**. After that, wildflowers keep appearing.
  - Skipping is free and nothing ever shrinks. If you're away for a few days, it just looks a bit sleepy until you're back.
- **Parking lot:** press **Ctrl + Shift + Space** anywhere, type the thought ("call the bank"), and press Enter. It's saved and you're straight back to work. Later you can review the list and turn any thought into a to-do.

---

## Install

Timer runs on **Windows 10 and 11**. It installs for your user account only, so it doesn't need admin rights.

### Option A: use a ready-made installer

If a `Timer_x.y.z_x64-setup.exe` is attached to the [Releases](https://github.com/apoorvbelsare/timer-app/releases) page, download it and run it. Otherwise, build one yourself with option B (it takes about 10 minutes the first time).

> **"Windows protected your PC"?** The installer isn't code-signed, so Windows SmartScreen warns about it. Click **More info → Run anyway**.

### Option B: build the installer from source

1. Install the tools (one time):
   ```bash
   winget install OpenJS.NodeJS.LTS
   ```
   ```bash
   winget install Rustlang.Rustup
   ```
   ```bash
   winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
   WebView2 already comes with Windows 11. On Windows 10 you may need the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/). Open a **new** terminal afterwards so it picks up the new tools.

2. Get the code and build:
   ```bash
   git clone https://github.com/apoorvbelsare/timer-app.git
   cd timer-app
   npm install
   npm run tauri build
   ```

3. Run the installer it creates:
   `src-tauri\target\release\bundle\nsis\Timer_0.6.1_x64-setup.exe`

After installing, **Timer** is in your Start menu, and it **starts with Windows** from the first launch. You can turn that off in Settings. To uninstall: **Windows Settings → Apps → Timer**.

### Updating

Build or download the newer installer and run it over the old one. Your routine and history are kept, because they live outside the install folder (see [Your data](#your-data)).

---

## How to use it

### First time (about 5 minutes)

1. The planner opens on **Routine**. Click **Start from a sample**, or **Add a block**.
2. Edit the blocks to match your real day: click a block to change its name, time, days and colour.
3. Tick **Optional** on anything you don't do every day, like Study or Gym.
4. For routines with several parts (morning, wind-down), add **steps** with minutes. They'll move on by themselves.
5. Glance at **Settings**: warning times, chime, the hyperfocus guard delay, hourly ping and its quiet hours.

### A normal day

| When | What happens | What you do |
| --- | --- | --- |
| A block starts | The widget asks for your intention | Type one thing, or click **Not now** |
| During a block | The ring shrinks and steps move on | Open **Focus mode** (leaf icon or tray) for deep work |
| A stray thought | You notice it pulling you away | **Ctrl + Shift + Space**, type, **Enter** |
| On the hour | That hour's tune plays, and the widget says what's on | Nothing; it's just a time anchor |
| 10 / 5 / 1 minutes left | A chime and a notification | Start wrapping up |
| Block ends | "How did it go?" | **Done**, **Partly** or **Skipped**, plus an optional note. Your garden grows. |
| Still hyperfocused | A notification, then a full-screen card | Switch, or **I'm still on it** (+10 min) |
| Free time | **Breathe**, **Stretch** and **Parked** chips appear | Take a break, or clear the parking lot |
| Plans change | — | In the planner's **Today** page, skip, move or add a block for today |

### Shortcuts and controls

| Action | How |
| --- | --- |
| Park a thought from anywhere | **Ctrl + Shift + Space** |
| Check out / check back in | **Ctrl + Alt + C**, the door icon on the widget, or the tray |
| Mark one of your events | Its hotkey (set in Settings), tray → **Mark an event**, or the Today page |
| I'm stuck | **?** on the widget, or the tray |
| Finish the current block now | **✓** on the widget |
| Open the planner | Double-click the widget, or left-click the tray icon |
| Focus mode | Leaf icon on the widget (hover), the tray menu, or the planner sidebar |
| Full screen in focus mode | **F11** |
| "Give me 10 more minutes" on the full-screen card | **Esc** |
| Move the widget | Drag it |
| Dock to the taskbar / float again | Drag it onto or off the taskbar, the dock button on the widget, or tray → **Dock to taskbar** |
| Let clicks pass through the widget | Tray → **Lock widget (click-through)** |
| Hide the widget / quit | Tray menu |

Closing a window only hides it; Timer keeps running in the tray. Use **Quit** in the tray menu to stop it completely.

---

## Tech stack

| Part | Choice | Why |
| --- | --- | --- |
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) | A small, native Windows app that idles at about 30–50 MB of RAM. That matters for something running all day; an Electron app would idle at 150 MB or more. |
| Windows APIs | [`windows`](https://crates.io/crates/windows) crate | Keeps the docked bar above the taskbar and notices fullscreen apps. |
| UI | TypeScript + [Vite](https://vitejs.dev), plain DOM (no framework) | Five small windows don't need React. It keeps the bundle tiny and the code direct. |
| Rendering | SVG (rings, garden, hills) and Canvas (the bird flock) | Sharp at any size, animated with almost no CPU. |
| Sound | Web Audio API | Every chime, hourly tune and ambient sound (rain, forest, brown noise) is generated in code, so the app ships no audio files. |
| Fonts | [Fraunces](https://fonts.google.com/specimen/Fraunces) and [Nunito](https://fonts.google.com/specimen/Nunito), bundled through Fontsource | They work offline. |
| Tauri plugins | notification, autostart, single-instance, global-shortcut, dialog | Toasts, start with Windows, one copy at a time, hotkeys, picking the task-list file |
| Tests | [Vitest](https://vitest.dev) | The scheduling engine, garden growth and hourly tunes are plain functions with unit tests. |
| Installer | NSIS (through `tauri build`) | A per-user `.exe` installer, no admin needed. |

### How it fits together

```
 Rust shell (src-tauri)           Web windows (src)
 ─────────────────────            ─────────────────
 tray menu, autostart,            widget   – the always-on card, or the taskbar bar
 global shortcut,         ◄──►    planner  – Today, Routine, Garden, Parking lot, Settings
 state file on disk,              focus    – focus mode, sounds, breaks
 keeping the dock on top
                                  overlay  – full-screen "time to switch"
                                  capture  – the parking-lot box
```

- `engine.ts`, `garden.ts` and `hourly.ts` are **pure logic**: give them the saved state and the time, and they say what's current, what to prompt, how big the garden is, and which tune to play. That's what the tests cover.
- Each window keeps its own copy of the state. A change is saved to disk by the Rust side and broadcast to the other windows, so they all stay in step.

---

## Development

```bash
npm install
npm run tauri dev     # run the app with live reload
npm test              # unit tests
npm run build         # typecheck and build the web pages
npm run tauri build   # build the Windows installer
```

`npm run dev` on its own serves the pages in a normal browser (`http://localhost:1420/widget.html`, `/planner.html`, `/focus.html`). Outside the app, data goes to the browser's storage and notifications to the console, which is handy for working on the UI.

### Project layout

| Path | What's there |
| --- | --- |
| `src/model.ts` | Data types, time helpers, the sample routine |
| `src/engine.ts` | Today's plan, the current block, prompts, hyperfocus escalation, overlap checks |
| `src/garden.ts`, `garden-view.ts` | How the garden grows (from block logs) and how it's drawn |
| `src/hourly.ts` | The 24 hourly tunes and quiet hours |
| `src/store.ts`, `actions.ts` | Loading, saving and syncing state; the changes windows can make |
| `src/widget.ts`, `planner.ts`, `planner-pages.ts`, `focus.ts`, `overlay.ts`, `capture.ts` | The windows |
| `src/sounds.ts`, `birds.ts`, `alerts.ts` | Ambient sound, the bird flock, chimes and notifications |
| `src/styles/` | One stylesheet per window, plus `theme.css` for the shared palette |
| `src-tauri/` | The Rust shell: tray, windows, plugins, saving the state file, keeping the docked bar on top |

### Branches

`main` is the current app. The other branches are earlier versions and experiments, kept side by side for reference.

| Branch | What it is |
| --- | --- |
| `main` | **Use this one: the latest version (v0.6.1, 8 November 2026).** Flown style, the garden, parking lot, hourly ping and taskbar dock |
| `feat/taskbar-dock` | Where the taskbar dock was built; the same as `main` |
| `feat/garden-parking-lot` | v0.3.0: Flown style plus the garden, parking lot and hourly ping |
| `feat/flown-style` | The Flown-inspired version without those three additions |
| `feat/sunsama-style` | An experiment with Sunsama-style daily planning, tasks and weekly goals |
| `feat/mvp` | The first, plain version |

---

## Your data

Everything lives in one file on your PC:

```
%APPDATA%\com.apoorvbelsare.timer\state.json
```

It holds your routine, each day's logs and notes, parked thoughts and settings. Nothing is sent anywhere. To back up, copy that file; to start fresh, delete it while Timer is closed.

---

## Ideas for later

- Planned vs actual: see how long things really take compared with your guesses
- Drag and resize blocks directly on the timeline
- Blocks that cross midnight
- A choice of keyboard shortcut for the parking lot
