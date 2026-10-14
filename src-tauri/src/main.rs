// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args();
    let _bin = args.next();
    if args.next().as_deref() == Some("hook") {
        std::process::exit(redwhisk_lib::run_tui_hook_command_from_process());
    }
    redwhisk_lib::run()
}
