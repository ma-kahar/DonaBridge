// mic.rs - native microphone bridge for Windows.
//
// Some Intel/Huawei audio stacks expose a capture endpoint that the WASAPI
// shared-mode engine cannot open (IAudioClient::GetMixFormat returns
// 0x8000FFFF). Browsers such as Firefox still record because they use a
// different Windows audio path. WebView2/Chromium only use WASAPI, so WhatsApp
// Web voice notes fail even though the microphone itself is fine.
//
// This module captures the microphone through PortAudio's WDM-KS (kernel
// streaming) backend and streams 48 kHz mono PCM to the WhatsApp webview, where
// init_script.rs exposes it as a synthetic MediaStream. Machines whose WASAPI
// path works are unaffected: if the bridge cannot start, the script falls back
// to the normal getUserMedia implementation.

use std::ffi::{c_char, c_int, c_ulong, c_void, CStr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use base64::Engine;
use libloading::Library;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const SAMPLE_RATE: f64 = 48_000.0;
const CHUNK_SAMPLES: usize = 960; // 20 ms mono
const EVENT: &str = "mic://pcm";
const MAX_CHANNELS: i32 = 4;
const WDMKS_HOST_API: c_int = 11;

/// 0 = ask, 1 = allowed, 2 = denied.
static PERMISSION: AtomicU8 = AtomicU8::new(0);
static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

struct Session {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

fn session() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

#[repr(C)]
struct PaDeviceInfo {
    struct_version: c_int,
    name: *const c_char,
    host_api: c_int,
    max_input_channels: c_int,
    max_output_channels: c_int,
    default_low_input_latency: f64,
    default_low_output_latency: f64,
    default_high_input_latency: f64,
    default_high_output_latency: f64,
    default_sample_rate: f64,
}

#[repr(C)]
struct PaHostApiInfo {
    struct_version: c_int,
    api_type: c_int,
    name: *const c_char,
    device_count: c_int,
    default_input_device: c_int,
    default_output_device: c_int,
}

#[repr(C)]
struct PaStreamParameters {
    device: c_int,
    channel_count: c_int,
    sample_format: c_ulong,
    suggested_latency: f64,
    host_api_specific_stream_info: *mut c_void,
}

type PaError = c_int;
type PaStream = c_void;
type PaStreamCallback = unsafe extern "C" fn(
    *const c_void,
    *mut c_void,
    c_ulong,
    *const c_void,
    c_ulong,
    *mut c_void,
) -> c_int;

struct CallbackState {
    channels: usize,
    tx: SyncSender<Vec<i16>>,
}

/// Downmix interleaved WDM-KS samples to mono and hand them to the emitter.
unsafe extern "C" fn pa_callback(
    input: *const c_void,
    _output: *mut c_void,
    frames: c_ulong,
    _time: *const c_void,
    _flags: c_ulong,
    user: *mut c_void,
) -> c_int {
    if input.is_null() || user.is_null() {
        return 0;
    }
    let state = &*(user as *const CallbackState);
    let channels = state.channels.max(1);
    let samples =
        unsafe { std::slice::from_raw_parts(input as *const i16, frames as usize * channels) };
    let mut mono = Vec::with_capacity(frames as usize);
    for frame in samples.chunks(channels) {
        let sum: i32 = frame.iter().map(|&v| v as i32).sum();
        mono.push((sum / channels as i32) as i16);
    }
    match state.tx.try_send(mono) {
        Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
    }
    0
}

fn dll_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("portaudio").join("libportaudio64bit.dll");
        if bundled.exists() {
            return Ok(bundled);
        }
        let flat = dir.join("libportaudio64bit.dll");
        if flat.exists() {
            return Ok(flat);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("portaudio")
        .join("libportaudio64bit.dll");
    if dev.exists() {
        return Ok(dev);
    }
    Err("PortAudio runtime not found".into())
}

fn pa_error(api: &PaApi, code: PaError) -> String {
    unsafe {
        let text = (api.get_error_text)(code);
        if text.is_null() {
            format!("PortAudio error {code}")
        } else {
            CStr::from_ptr(text).to_string_lossy().to_string()
        }
    }
}

struct PaApi {
    _lib: Library,
    initialize: unsafe extern "C" fn() -> PaError,
    terminate: unsafe extern "C" fn() -> PaError,
    get_device_count: unsafe extern "C" fn() -> c_int,
    get_device_info: unsafe extern "C" fn(c_int) -> *const PaDeviceInfo,
    get_host_api_count: unsafe extern "C" fn() -> c_int,
    get_host_api_info: unsafe extern "C" fn(c_int) -> *const PaHostApiInfo,
    get_error_text: unsafe extern "C" fn(PaError) -> *const c_char,
    open_stream: unsafe extern "C" fn(
        *mut *mut PaStream,
        *const PaStreamParameters,
        *const PaStreamParameters,
        f64,
        c_ulong,
        c_ulong,
        Option<PaStreamCallback>,
        *mut c_void,
    ) -> PaError,
    start_stream: unsafe extern "C" fn(*mut PaStream) -> PaError,
    stop_stream: unsafe extern "C" fn(*mut PaStream) -> PaError,
    close_stream: unsafe extern "C" fn(*mut PaStream) -> PaError,
}

impl PaApi {
    fn load(path: &PathBuf) -> Result<Self, String> {
        unsafe {
            let lib = Library::new(path)
                .map_err(|e| format!("Could not load PortAudio ({}): {e}", path.display()))?;
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get($name).map_err(|e| {
                        format!(
                            "PortAudio is missing {}: {e}",
                            String::from_utf8_lossy($name)
                        )
                    })?
                };
            }
            let api = Self {
                initialize: sym!(b"Pa_Initialize\0"),
                terminate: sym!(b"Pa_Terminate\0"),
                get_device_count: sym!(b"Pa_GetDeviceCount\0"),
                get_device_info: sym!(b"Pa_GetDeviceInfo\0"),
                get_host_api_count: sym!(b"Pa_GetHostApiCount\0"),
                get_host_api_info: sym!(b"Pa_GetHostApiInfo\0"),
                get_error_text: sym!(b"Pa_GetErrorText\0"),
                open_stream: sym!(b"Pa_OpenStream\0"),
                start_stream: sym!(b"Pa_StartStream\0"),
                stop_stream: sym!(b"Pa_StopStream\0"),
                close_stream: sym!(b"Pa_CloseStream\0"),
                _lib: lib,
            };
            let err = (api.initialize)();
            if err != 0 {
                return Err(pa_error(&api, err));
            }
            Ok(api)
        }
    }
}

impl Drop for PaApi {
    fn drop(&mut self) {
        unsafe {
            let _ = (self.terminate)();
        }
    }
}

struct Capture {
    api: PaApi,
    stream: *mut PaStream,
    state: *mut CallbackState,
}

impl Drop for Capture {
    fn drop(&mut self) {
        unsafe {
            if !self.stream.is_null() {
                let _ = (self.api.stop_stream)(self.stream);
                let _ = (self.api.close_stream)(self.stream);
                self.stream = std::ptr::null_mut();
            }
            if !self.state.is_null() {
                drop(Box::from_raw(self.state));
                self.state = std::ptr::null_mut();
            }
        }
    }
}

fn open_capture(app: &AppHandle) -> Result<(Capture, Receiver<Vec<i16>>), String> {
    let path = dll_path(app)?;
    let api = PaApi::load(&path)?;

    unsafe {
        let host_count = (api.get_host_api_count)();
        let mut wdmks = -1;
        for i in 0..host_count {
            let info = (api.get_host_api_info)(i);
            if info.is_null() {
                continue;
            }
            if (*info).api_type == WDMKS_HOST_API {
                wdmks = i;
            }
        }
        if wdmks < 0 {
            return Err("Windows kernel streaming is not available".into());
        }

        let count = (api.get_device_count)();
        let mut best: Option<(c_int, i32)> = None;
        let mut best_score = -1000;
        for i in 0..count {
            let info = (api.get_device_info)(i);
            if info.is_null() {
                continue;
            }
            let info = &*info;
            if info.host_api != wdmks || info.max_input_channels < 2 {
                continue;
            }
            if info.default_sample_rate < 47_999.0 {
                continue;
            }
            let name = CStr::from_ptr(info.name).to_string_lossy().to_lowercase();
            if name.contains("senary") || name.contains("loopback") {
                continue;
            }
            let channels = info.max_input_channels.min(MAX_CHANNELS);
            let mut score = 0;
            if name.contains("microphone") {
                score += 10;
            }
            if name.contains("array") {
                score += 5;
            }
            if channels >= 4 {
                score += 5;
            }
            if score > best_score {
                best_score = score;
                best = Some((i, channels));
            }
        }

        let Some((device, channels)) = best else {
            return Err("No kernel-streaming microphone found".into());
        };

        let (tx, rx) = sync_channel::<Vec<i16>>(32);
        let state = Box::new(CallbackState {
            channels: channels as usize,
            tx,
        });
        let state_ptr = Box::into_raw(state);
        let params = PaStreamParameters {
            device,
            channel_count: channels,
            sample_format: 0x0000_0008, // paInt16
            suggested_latency: 0.05,
            host_api_specific_stream_info: std::ptr::null_mut(),
        };

        let mut stream: *mut PaStream = std::ptr::null_mut();
        let err = (api.open_stream)(
            &mut stream,
            &params,
            std::ptr::null(),
            SAMPLE_RATE,
            480,
            0,
            Some(pa_callback),
            state_ptr as *mut c_void,
        );
        if err != 0 {
            drop(Box::from_raw(state_ptr));
            return Err(pa_error(&api, err));
        }

        let err = (api.start_stream)(stream);
        if err != 0 {
            let _ = (api.close_stream)(stream);
            drop(Box::from_raw(state_ptr));
            return Err(pa_error(&api, err));
        }

        Ok((
            Capture {
                api,
                stream,
                state: state_ptr,
            },
            rx,
        ))
    }
}

fn capture_loop(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    ready: std::sync::mpsc::Sender<Result<(), String>>,
) {
    let (capture, rx) = match open_capture(&app) {
        Ok(value) => value,
        Err(err) => {
            let _ = ready.send(Err(err));
            return;
        }
    };
    let _ = ready.send(Ok(()));

    let engine = base64::engine::general_purpose::STANDARD;
    let mut buffer: Vec<i16> = Vec::with_capacity(CHUNK_SAMPLES * 2);
    while !stop.load(Ordering::Relaxed) {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => {
                buffer.extend(chunk);
                while buffer.len() >= CHUNK_SAMPLES {
                    let chunk: Vec<i16> = buffer.drain(..CHUNK_SAMPLES).collect();
                    let mut bytes = Vec::with_capacity(CHUNK_SAMPLES * 2);
                    for sample in chunk {
                        bytes.extend_from_slice(&sample.to_le_bytes());
                    }
                    let payload = engine.encode(bytes);
                    let _ = app.emit(EVENT, payload);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(capture);
}

#[cfg(target_os = "windows")]
fn ask_native() -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONQUESTION, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO,
    };

    let text =
        HSTRING::from("Dona Bridge wants to use your microphone for voice messages and calls.");
    let caption = HSTRING::from("Microphone permission");
    let result = unsafe {
        MessageBoxW(
            HWND(std::ptr::null_mut()),
            &text,
            &caption,
            MB_YESNO | MB_ICONQUESTION | MB_TOPMOST | MB_SETFOREGROUND,
        )
    };
    result.0 == 6 // IDYES
}

#[cfg(not(target_os = "windows"))]
fn ask_native() -> bool {
    true
}

/// Ask the user once, like a browser permission prompt.
pub fn permission(_app: &AppHandle) -> bool {
    match PERMISSION.load(Ordering::Relaxed) {
        1 => true,
        2 => false,
        _ => {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(ask_native());
            });
            match rx.recv_timeout(Duration::from_secs(120)) {
                Ok(true) => {
                    PERMISSION.store(1, Ordering::Relaxed);
                    true
                }
                _ => {
                    PERMISSION.store(2, Ordering::Relaxed);
                    false
                }
            }
        }
    }
}

fn start(app: AppHandle) -> Result<(), String> {
    let mut guard = session().lock();
    if guard.is_some() {
        return Ok(());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let stop_for_thread = stop.clone();
    let thread = std::thread::Builder::new()
        .name("dona-mic".into())
        .spawn(move || capture_loop(app, stop_for_thread, ready_tx))
        .map_err(|e| format!("Could not start microphone thread: {e}"))?;

    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => {
            *guard = Some(Session {
                stop,
                thread: Some(thread),
            });
            Ok(())
        }
        Ok(Err(err)) => {
            stop.store(true, Ordering::Relaxed);
            let _ = thread.join();
            Err(err)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            let _ = thread.join();
            Err("Microphone did not start".into())
        }
    }
}

fn stop() {
    let taken = session().lock().take();
    if let Some(mut session) = taken {
        session.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = session.thread.take() {
            let _ = thread.join();
        }
    }
}

#[tauri::command]
pub fn mic_permission(app: AppHandle) -> bool {
    permission(&app)
}

#[tauri::command]
pub fn mic_start(app: AppHandle) -> Result<(), String> {
    if PERMISSION.load(Ordering::Relaxed) != 1 {
        return Err("Microphone permission has not been granted".into());
    }
    start(app)
}

#[tauri::command]
pub fn mic_stop() {
    stop();
}
