//! Desktop and tablet shell. The whole planner is the web app in
//! `packages/app`; this side only provides native file dialogs and file
//! access (plugins dialog + fs). Documents are stored by the web app.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Cabinet Planner");
}
