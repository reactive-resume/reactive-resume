use harfbuzz_sys as hb;
mod validation;
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    ptr, slice, str,
};

#[repr(C)]
pub struct FormeBuffer {
    pub data: *mut u8,
    pub len: usize,
}

#[repr(C)]
pub struct FormeResult {
    pub pdf: FormeBuffer,
    pub layout: FormeBuffer,
    pub warnings: FormeBuffer,
    pub error: FormeBuffer,
}

impl FormeBuffer {
    fn new(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self {
                data: ptr::null_mut(),
                len: 0,
            };
        }
        let mut bytes = bytes.into_boxed_slice();
        let result = Self {
            data: bytes.as_mut_ptr(),
            len: bytes.len(),
        };
        std::mem::forget(bytes);
        result
    }
    unsafe fn free(self) {
        if !self.data.is_null() {
            drop(Box::from_raw(ptr::slice_from_raw_parts_mut(
                self.data, self.len,
            )));
        }
    }
}

fn guarded(f: impl FnOnce() -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String>) -> *mut FormeResult {
    let result =
        catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| Err("Native Forme panicked".into()));
    let (pdf, layout, warnings, error) = match result {
        Ok((p, l, w)) => (p, l, w, Vec::new()),
        Err(e) => (Vec::new(), Vec::new(), Vec::new(), e.into_bytes()),
    };
    Box::into_raw(Box::new(FormeResult {
        pdf: FormeBuffer::new(pdf),
        layout: FormeBuffer::new(layout),
        warnings: FormeBuffer::new(warnings),
        error: FormeBuffer::new(error),
    }))
}

unsafe fn input<'a>(data: *const u8, len: usize) -> Result<&'a [u8], String> {
    if len == 0 {
        return Ok(&[]);
    }
    if data.is_null() || len > isize::MAX as usize {
        return Err("Invalid input buffer".into());
    }
    Ok(slice::from_raw_parts(data, len))
}

/// # Safety
/// Input must remain readable for the call. Free the returned result exactly once with forme_result_free.
#[no_mangle]
pub unsafe extern "C" fn forme_render_with_layout(json: *const u8, len: usize) -> *mut FormeResult {
    guarded(|| {
        if len > 64 * 1024 * 1024 {
            return Err("Document is too large".into());
        }
        let json = str::from_utf8(input(json, len)?).map_err(|e| e.to_string())?;
        let document: forme::Document = serde_json::from_str(json).map_err(|e| e.to_string())?;
        validation::validate(&document)?;
        let (pdf, layout, warnings, _) =
            forme::render_with_layout_and_options(&document, forme::RenderOptions::default())
                .map_err(|e| e.to_string())?;
        Ok((
            pdf,
            serde_json::to_vec(&layout).map_err(|e| e.to_string())?,
            serde_json::to_vec(&warnings).map_err(|e| e.to_string())?,
        ))
    })
}

extern "C" {
    fn hb_subset_input_create_or_fail() -> *mut std::ffi::c_void;
    fn hb_subset_input_destroy(input: *mut std::ffi::c_void);
    fn hb_subset_input_unicode_set(input: *mut std::ffi::c_void) -> *mut hb::hb_set_t;
    fn hb_subset_input_set(input: *mut std::ffi::c_void, set_type: u32) -> *mut hb::hb_set_t;
    fn hb_subset_or_fail(
        face: *mut hb::hb_face_t,
        input: *const std::ffi::c_void,
    ) -> *mut hb::hb_face_t;
}

pub fn subset_font(font: &[u8], text: &str) -> Result<Vec<u8>, String> {
    if font.is_empty() || font.len() > u32::MAX as usize {
        return Err("Invalid font length".into());
    }
    unsafe {
        // HB_MEMORY_MODE_DUPLICATE: HarfBuzz owns its copy, including on allocation failure.
        let blob = hb::hb_blob_create(
            font.as_ptr().cast(),
            font.len() as u32,
            hb::HB_MEMORY_MODE_DUPLICATE,
            ptr::null_mut(),
            None,
        );
        let face = hb::hb_face_create(blob, 0);
        hb::hb_blob_destroy(blob);
        if hb::hb_face_get_glyph_count(face) == 0 {
            hb::hb_face_destroy(face);
            return Err("Invalid font".into());
        }
        let input = hb_subset_input_create_or_fail();
        if input.is_null() {
            hb::hb_face_destroy(face);
            return Err("Cannot allocate font subset input".into());
        }
        let features = hb_subset_input_set(input, 6); // HB_SUBSET_SETS_LAYOUT_FEATURE_TAG: preserve every shaping feature.
        hb::hb_set_clear(features);
        hb::hb_set_invert(features);
        let unicodes = hb_subset_input_unicode_set(input);
        for ch in text.chars() {
            hb::hb_set_add(unicodes, ch as u32);
        }
        let subset = hb_subset_or_fail(face, input);
        hb_subset_input_destroy(input);
        hb::hb_face_destroy(face);
        if subset.is_null() {
            return Err("HarfBuzz could not subset font".into());
        }
        let result = hb::hb_face_reference_blob(subset);
        let mut len = 0;
        let data = hb::hb_blob_get_data(result, &mut len);
        let bytes = if data.is_null() || len == 0 {
            Err("Empty font subset".into())
        } else {
            Ok(slice::from_raw_parts(data.cast::<u8>(), len as usize).to_vec())
        };
        hb::hb_blob_destroy(result);
        hb::hb_face_destroy(subset);
        bytes
    }
}

/// # Safety
/// Subset bytes are in result.pdf. Inputs must remain readable for the call; free result exactly once.
#[no_mangle]
pub unsafe extern "C" fn forme_subset_font(
    font: *const u8,
    font_len: usize,
    text: *const u8,
    text_len: usize,
) -> *mut FormeResult {
    guarded(|| {
        let font = input(font, font_len)?;
        let text = str::from_utf8(input(text, text_len)?).map_err(|e| e.to_string())?;
        Ok((subset_font(font, text)?, Vec::new(), Vec::new()))
    })
}

/// # Safety
/// Result must come from this library and must not have been freed already. Null is allowed.
#[no_mangle]
pub unsafe extern "C" fn forme_result_free(result: *mut FormeResult) {
    if result.is_null() {
        return;
    }
    let result = *Box::from_raw(result);
    result.pdf.free();
    result.layout.free();
    result.warnings.free();
    result.error.free();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_rejects_invalid_layout_and_renders_ordinary_text() {
        for (json, valid) in [
            (
                r#"{"children":[{"kind":{"type":"Text","content":"Fictional resume"}}]}"#,
                true,
            ),
            (
                r#"{"children":[{"kind":{"type":"View"},"style":{"gridTemplateColumns":[{"Fr":1}]},"children":[{"kind":{"type":"View"},"style":{"gridPlacement":{"columnSpan":2}}}]}]}"#,
                false,
            ),
        ] {
            unsafe {
                let result = forme_render_with_layout(json.as_ptr(), json.len());
                assert_eq!((*result).error.len == 0, valid);
                assert_eq!((*result).pdf.len > 0, valid);
                forme_result_free(result);
            }
        }
    }
}
