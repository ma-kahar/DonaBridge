// windows/taskbar.rs — Taskbar unread badge via ITaskbarList3::SetOverlayIcon.
// Draws a crisp red badge with the unread count onto the Windows taskbar icon.

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, CreateDIBSection, CreateFontW, CreateSolidBrush,
    DeleteDC, DeleteObject, DrawTextW, Ellipse, SelectObject, SetBkMode, SetTextColor, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, DT_CENTER, DT_SINGLELINE, DT_VCENTER, TRANSPARENT,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{ITaskbarList3, TaskbarList};
use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, DestroyIcon, HICON, ICONINFO};

/// Update the Windows taskbar overlay badge on `hwnd_raw` (`0` clears the badge).
pub fn set_badge_for_hwnd(hwnd_raw: isize, count: u32) {
    let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let Ok(taskbar): windows::core::Result<ITaskbarList3> =
            CoCreateInstance(&TaskbarList, None, CLSCTX_ALL)
        else {
            return;
        };
        if taskbar.HrInit().is_err() {
            return;
        }

        if count == 0 {
            let _ = taskbar.SetOverlayIcon(hwnd, HICON::default(), windows::core::w!(""));
            return;
        }

        if let Some(hicon) = create_badge_icon(count) {
            let _ = taskbar.SetOverlayIcon(hwnd, hicon, windows::core::w!("Unread messages"));
            let _ = DestroyIcon(hicon);
        }
    }
}

unsafe fn create_badge_icon(count: u32) -> Option<HICON> {
    let size = 32i32;
    let screen_dc = windows::Win32::Graphics::Gdi::GetDC(None);
    let mem_dc = CreateCompatibleDC(screen_dc);

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let Ok(color_bmp) = CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, None, 0) else {
        let _ = DeleteDC(mem_dc);
        return None;
    };
    let mask_bmp = CreateCompatibleBitmap(screen_dc, size, size);

    let old_bmp = SelectObject(mem_dc, color_bmp);
    // Clear transparent background
    if !bits.is_null() {
        std::ptr::write_bytes(bits as *mut u8, 0, (size * size * 4) as usize);
    }

    // Draw red circle (BGR: 0x002222EF)
    let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x0026_26DC));
    let old_brush = SelectObject(mem_dc, brush);
    let _ = Ellipse(mem_dc, 1, 1, size - 1, size - 1);
    SelectObject(mem_dc, old_brush);
    let _ = DeleteObject(brush);

    // Draw white count text
    let label = if count > 99 {
        "99+".to_string()
    } else {
        count.to_string()
    };
    let font_size = if label.len() >= 3 { 13 } else { 17 };
    let font = CreateFontW(
        font_size,
        0,
        0,
        0,
        700,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        windows::core::w!("Segoe UI"),
    );
    let old_font = SelectObject(mem_dc, font);
    SetBkMode(mem_dc, TRANSPARENT);
    SetTextColor(mem_dc, windows::Win32::Foundation::COLORREF(0x00FF_FFFF));

    let mut wide: Vec<u16> = label.encode_utf16().collect();
    let mut rect = windows::Win32::Foundation::RECT {
        left: 0,
        top: 0,
        right: size,
        bottom: size,
    };
    DrawTextW(
        mem_dc,
        &mut wide,
        &mut rect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE,
    );

    // Fix alpha channel for non-zero pixels so GDI text/circle are opaque
    if !bits.is_null() {
        let slice = std::slice::from_raw_parts_mut(bits as *mut u32, (size * size) as usize);
        for px in slice.iter_mut() {
            if *px != 0 {
                *px |= 0xFF00_0000;
            }
        }
    }

    SelectObject(mem_dc, old_font);
    let _ = DeleteObject(font);
    SelectObject(mem_dc, old_bmp);

    let icon_info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask_bmp,
        hbmColor: color_bmp,
    };
    let hicon = CreateIconIndirect(&icon_info).ok();

    let _ = DeleteObject(color_bmp);
    let _ = DeleteObject(mask_bmp);
    let _ = DeleteDC(mem_dc);
    windows::Win32::Graphics::Gdi::ReleaseDC(None, screen_dc);
    hicon
}
