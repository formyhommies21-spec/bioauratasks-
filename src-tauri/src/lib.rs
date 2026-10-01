mod session;

use serde_json::Value;
use session::{ApiResponse, Session};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_window_state::StateFlags;

#[tauri::command]
fn session_status(session: State<'_, Session>) -> bool {
    session.has_cookies()
}

#[tauri::command]
fn set_endpoints(session: State<'_, Session>, auth: Option<String>, project: Option<String>) {
    session.set_endpoints(auth, project);
}

#[tauri::command]
async fn auth_login(session: State<'_, Session>, email: String, password: String) -> Result<ApiResponse, ()> {
    Ok(session.login(email.trim(), &password).await)
}

#[tauri::command]
async fn auth_logout(session: State<'_, Session>) -> Result<(), ()> {
    session.logout().await;
    Ok(())
}

#[tauri::command]
async fn api(
    session: State<'_, Session>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<ApiResponse, ()> {
    Ok(session.request(&method, &path, body).await)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE & !StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            // Без иконки в Dock: виджет живёт в строке меню, как у TickTick
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            app.manage(Session::new(data_dir));

            let show = MenuItem::with_id(app, "toggle", "Показать / скрыть", true, None::<&str>)?;
            let sync = MenuItem::with_id(app, "sync", "Синхронизировать", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выйти из виджета", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &sync, &sep, &quit])?;

            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("BIOAURA · Задачи")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_main(app),
                    "sync" => {
                        show_main(app);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("window.__widgetSync && window.__widgetSync()");
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
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;

            show_main(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Крестик и Alt+F4 прячут виджет в трей, а не закрывают приложение
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            session_status,
            set_endpoints,
            auth_login,
            auth_logout,
            api
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
