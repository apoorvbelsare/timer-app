use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (e.g. from the Start menu) just brings the planner forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_planner(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space)
                    {
                        show_capture(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![load_state, save_state, set_docked])
        .setup(|app| {
            let planner = MenuItem::with_id(app, "planner", "Open planner", true, None::<&str>)?;
            let focus = MenuItem::with_id(app, "focus", "Focus mode", true, None::<&str>)?;
            let park = MenuItem::with_id(app, "park", "Park a thought…	Ctrl+Shift+Space", true, None::<&str>)?;
            let widget = MenuItem::with_id(app, "widget", "Show / hide widget", true, None::<&str>)?;
            let dock = CheckMenuItem::with_id(app, "dock", "Dock to taskbar", true, false, None::<&str>)?;
            app.manage(DockItem(dock.clone()));
            let lock = CheckMenuItem::with_id(
                app,
                "lock",
                "Lock widget (click-through)",
                true,
                false,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&planner, &focus, &park, &widget, &dock, &lock, &separator, &quit])?;

            let lock_item = lock.clone();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Timer")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "planner" => show_planner(app),
                    "focus" => show_focus(app),
                    "park" => show_capture(app),
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
                    _ => {}
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

            // Another app may already own the shortcut; the tray item still works then
            let capture = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if let Err(err) = app.global_shortcut().register(capture) {
                eprintln!("Couldn't register Ctrl+Shift+Space: {err}");
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
