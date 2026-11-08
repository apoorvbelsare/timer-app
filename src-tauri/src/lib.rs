use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent, Wry,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

/// Writes to a temp file first so a crash mid-write never leaves a half-written routine.
#[tauri::command]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    let path = state_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Whether the widget is the bar sitting on the taskbar.
static DOCKED: AtomicBool = AtomicBool::new(false);

/// The tray's "Dock to taskbar" tick, kept in step with the widget.
struct DockItem(CheckMenuItem<tauri::Wry>);

/// The widget reports its mode on every switch, including drags on and off the taskbar.
#[tauri::command]
fn set_docked(app: AppHandle, docked: bool) {
    DOCKED.store(docked, Ordering::Relaxed);
    if let Some(item) = app.try_state::<DockItem>() {
        let _ = item.0.set_checked(docked);
    }
}

/// The taskbar raises itself over other always-on-top windows whenever it's
/// clicked, so the docked bar puts itself back on top. While a fullscreen app
/// or presentation is up, the taskbar hides and the bar does too.
#[cfg(windows)]
fn keep_dock_on_top(app: AppHandle) {
    use windows::Win32::{
        Foundation::HWND,
        UI::{
            Shell::{
                SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
                QUNS_RUNNING_D3D_FULL_SCREEN,
            },
            WindowsAndMessaging::{
                SetWindowPos, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE,
                SWP_NOOWNERZORDER, SWP_NOSIZE,
            },
        },
    };

    std::thread::spawn(move || {
        let mut hidden_for_fullscreen = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let Some(widget) = app.get_webview_window("widget") else {
                continue;
            };
            let docked = DOCKED.load(Ordering::Relaxed);
            let fullscreen = docked
                && matches!(
                    unsafe { SHQueryUserNotificationState() },
                    Ok(s) if s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE
                );
            if fullscreen {
                if widget.is_visible().unwrap_or(false) {
                    let _ = widget.hide();
                    hidden_for_fullscreen = true;
                }
                continue;
            }
            if hidden_for_fullscreen {
                hidden_for_fullscreen = false;
                let _ = widget.show();
            }
            let overlay_up = app
                .get_webview_window("overlay")
                .and_then(|o| o.is_visible().ok())
                .unwrap_or(false);
            if !docked || overlay_up || !widget.is_visible().unwrap_or(false) {
                continue;
            }
            if let Ok(hwnd) = widget.hwnd() {
                unsafe {
                    let _ = SetWindowPos(
                        HWND(hwnd.0),
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
                    );
                }
            }
        }
    });
}

fn show_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_planner(app: &AppHandle) {
    show_window(app, "planner");
}

/// The focus page listens for this to pick its mode and resume ambient sound.
fn show_focus(app: &AppHandle) {
    show_window(app, "focus");
    let _ = app.emit_to("focus", "focus-mode", "focus");
}

/// The parking lot's quick-capture box: centred, on top, ready to type.
fn show_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("capture", "capture-open", ());
    }
}

fn toggle_widget(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("widget") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
        }
    }
}

/// Checking out and back in, from anywhere.
fn check_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyC)
}

/// The tray menu's fixed items, kept so the menu can be rebuilt around the events.
struct TrayItems {
    planner: MenuItem<Wry>,
    focus: MenuItem<Wry>,
    park: MenuItem<Wry>,
    check: MenuItem<Wry>,
    stuck: MenuItem<Wry>,
    widget: MenuItem<Wry>,
    dock: CheckMenuItem<Wry>,
    lock: CheckMenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Your events' hotkeys and which event each one marks.
struct EventKeys(Mutex<Vec<(Shortcut, String)>>);

#[derive(serde::Deserialize)]
struct EventDef {
    id: String,
    name: String,
    hotkey: String,
}

fn build_menu(app: &AppHandle, items: &TrayItems, events: &[EventDef]) -> tauri::Result<Menu<Wry>> {
    let separator = || PredefinedMenuItem::separator(app);
    let event_items = events
        .iter()
        .map(|e| {
            let label = if e.hotkey.is_empty() { e.name.clone() } else { format!("{}\t{}", e.name, e.hotkey) };
            MenuItem::with_id(app, format!("event:{}", e.id), label, true, None::<&str>)
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let event_refs: Vec<&dyn IsMenuItem<Wry>> = event_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let marks = Submenu::with_items(app, "Mark an event", !events.is_empty(), &event_refs)?;
    Menu::with_items(
        app,
        &[
            &items.planner,
            &items.focus,
            &items.park,
            &separator()?,
            &items.check,
            &items.stuck,
            &marks,
            &separator()?,
            &items.widget,
            &items.dock,
            &items.lock,
            &separator()?,
            &items.quit,
        ],
    )
}

/// The planner hands over your events whenever they change, and the widget on launch.
/// Rebuilds the tray's "Mark an event" menu and registers the hotkeys; returns, by
/// event id, any hotkey that couldn't be used.
#[tauri::command]
fn set_events(app: AppHandle, events: Vec<EventDef>) -> Result<HashMap<String, String>, String> {
    let mut errors = HashMap::new();
    let shortcuts = app.global_shortcut();
    let keys = app.state::<EventKeys>();
    let mut keys = keys.0.lock().unwrap();
    for (shortcut, _) in keys.drain(..) {
        let _ = shortcuts.unregister(shortcut);
    }
    for e in events.iter().filter(|e| !e.hotkey.is_empty()) {
        match e.hotkey.parse::<Shortcut>() {
            Ok(shortcut) if keys.iter().any(|(k, _)| *k == shortcut) => {
                errors.insert(e.id.clone(), format!("{} is already used by another event.", e.hotkey));
            }
            Ok(shortcut) => match shortcuts.register(shortcut) {
                Ok(()) => keys.push((shortcut, e.id.clone())),
                Err(err) => {
                    errors.insert(e.id.clone(), format!("Couldn’t use {}: {err}", e.hotkey));
                }
            },
            Err(_) => {
                errors.insert(e.id.clone(), format!("“{}” isn’t a hotkey. Try something like Ctrl+Alt+L.", e.hotkey));
            }
        }
    }
    let menu = build_menu(&app, &app.state::<TrayItems>(), &events).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(errors)
}

/// The "I'm stuck" task list. Only Markdown files, and only the one you picked in Settings.
#[tauri::command]
fn read_task_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let markdown = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"));
    if !markdown {
        return Err("The task list needs to be a .md file.".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (e.g. from the Start menu) just brings the planner forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_planner(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space) {
                        show_capture(app);
                    } else if *shortcut == check_shortcut() {
                        let _ = app.emit_to("widget", "check-toggle", ());
                    } else if let Some(id) = app
                        .state::<EventKeys>()
                        .0
                        .lock()
                        .unwrap()
                        .iter()
                        .find(|(key, _)| key == shortcut)
                        .map(|(_, id)| id.clone())
                    {
                        let _ = app.emit_to("widget", "fire-event", id);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            set_docked,
            set_events,
            read_task_file
        ])
        .setup(|app| {
            let items = TrayItems {
                planner: MenuItem::with_id(app, "planner", "Open planner", true, None::<&str>)?,
                focus: MenuItem::with_id(app, "focus", "Focus mode", true, None::<&str>)?,
                park: MenuItem::with_id(app, "park", "Park a thought…	Ctrl+Shift+Space", true, None::<&str>)?,
                check: MenuItem::with_id(app, "check", "Check out / in	Ctrl+Alt+C", true, None::<&str>)?,
                stuck: MenuItem::with_id(app, "stuck", "I’m stuck…", true, None::<&str>)?,
                widget: MenuItem::with_id(app, "widget", "Show / hide widget", true, None::<&str>)?,
                dock: CheckMenuItem::with_id(app, "dock", "Dock to taskbar", true, false, None::<&str>)?,
                lock: CheckMenuItem::with_id(app, "lock", "Lock widget (click-through)", true, false, None::<&str>)?,
                quit: MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            };
            app.manage(DockItem(items.dock.clone()));
            let menu = build_menu(app.handle(), &items, &[])?;
            let lock_item = items.lock.clone();
            app.manage(items);
            app.manage(EventKeys(Mutex::new(Vec::new())));

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Timer")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "planner" => show_planner(app),
                    "focus" => show_focus(app),
                    "park" => show_capture(app),
                    "check" => {
                        let _ = app.emit_to("widget", "check-toggle", ());
                    }
                    "stuck" => {
                        let _ = app.emit_to("widget", "stuck", ());
                    }
                    "widget" => toggle_widget(app),
                    // The widget owns the mode; it switches and reports back to set the tick
                    "dock" => {
                        let _ = app.emit_to("widget", "toggle-dock", ());
                    }
                    "lock" => {
                        let locked = lock_item.is_checked().unwrap_or(false);
                        if let Some(window) = app.get_webview_window("widget") {
                            let _ = window.set_ignore_cursor_events(locked);
                        }
                    }
                    "quit" => app.exit(0),
                    id => {
                        if let Some(event_id) = id.strip_prefix("event:") {
                            let _ = app.emit_to("widget", "fire-event", event_id.to_string());
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_planner(tray.app_handle());
                    }
                })
                .build(app)?;

            // Another app may already own a shortcut; the tray items still work then
            let capture = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            for (shortcut, label) in [(capture, "Ctrl+Shift+Space"), (check_shortcut(), "Ctrl+Alt+C")] {
                if let Err(err) = app.global_shortcut().register(shortcut) {
                    eprintln!("Couldn't register {label}: {err}");
                }
            }
            #[cfg(windows)]
            keep_dock_on_top(app.handle().clone());
            Ok(())
        })
        // The app lives in the tray: closing a window only hides it
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the timer app");
}
