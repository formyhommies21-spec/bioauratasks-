// Без консольного окна в релизной сборке под Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bioaura_tasks_widget_lib::run()
}
