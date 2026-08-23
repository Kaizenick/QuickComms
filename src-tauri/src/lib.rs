#[cfg(target_os = "macos")]
fn request_macos_microphone_permission() {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};

    // WKWebView's getUserMedia request does not always trigger macOS's TCC
    // prompt for an ad-hoc signed app. Asking through AVFoundation registers
    // the application with TCC before the web client starts WebRTC.
    let completion = RcBlock::new(|granted: Bool| {
        eprintln!("macOS microphone permission granted: {}", granted.as_bool());
    });

    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(
            AVMediaTypeAudio.expect("AVFoundation audio media type is unavailable"),
            &completion,
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            request_macos_microphone_permission();

            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running QuickComms");
}
