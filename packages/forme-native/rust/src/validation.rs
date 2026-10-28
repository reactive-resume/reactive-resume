use forme::{
    model::{PageConfig, Position},
    style::{SizeConstraint, Style},
    Document, Node, NodeKind,
};

const MAX_NODES: usize = 20_000;
const MAX_GRID_CELLS: usize = 200_000;

fn page(config: &PageConfig) -> Result<f64, String> {
    let (width, height) = config.size.dimensions();
    let edges = config.margin;
    if ![width, height]
        .iter()
        .all(|v| v.is_finite() && *v >= 1.0 && *v <= 14_400.0)
        || ![edges.top, edges.right, edges.bottom, edges.left]
            .iter()
            .all(|v| v.is_finite() && *v >= 0.0)
        || width - edges.horizontal() < 1.0
        || height - edges.vertical() < 1.0
    {
        return Err("Page must have positive usable width and height".into());
    }
    Ok(height - edges.vertical())
}

fn grid(style: &Style, children: &[Node], budget: &mut usize) -> Result<(), String> {
    let Some(columns) = &style.grid_template_columns else {
        return Ok(());
    };
    let columns = columns.len();
    if columns == 0 {
        return Ok(());
    }
    if columns > 100 {
        return Err("Too many grid columns".into());
    }
    let mut rows = children.len() + children.len().div_ceil(columns);
    for child in children {
        let Some(placement) = &child.style.grid_placement else {
            continue;
        };
        let span = |start: Option<i32>, end: Option<i32>, count: Option<u32>, max: usize| {
            if start.is_some_and(|v| v < 1 || v as usize > max)
                || end.is_some_and(|v| v < 2 || v as usize > max + 1)
            {
                return Err("Grid placement is out of range".to_string());
            }
            let size = match (start, end) {
                (Some(start), Some(end)) if end > start => (end - start) as usize,
                (Some(_), Some(_)) => return Err("Invalid grid range".into()),
                _ => count.unwrap_or(1) as usize,
            };
            if size == 0 || size > max || start.unwrap_or(1) as usize - 1 + size > max {
                return Err("Grid span exceeds available space".into());
            }
            Ok(size)
        };
        span(
            placement.column_start,
            placement.column_end,
            placement.column_span,
            columns,
        )?;
        let row_span = span(
            placement.row_start,
            placement.row_end,
            placement.row_span,
            MAX_NODES,
        )?;
        rows += row_span + placement.row_start.unwrap_or(1) as usize - 1;
        if rows > MAX_GRID_CELLS / columns {
            return Err("Grid is too large".into());
        }
    }
    *budget = budget.saturating_add(rows.saturating_mul(columns));
    if *budget > MAX_GRID_CELLS {
        return Err("Grid is too large".into());
    }
    Ok(())
}

/// Reject non-progressing pagination and impossible grid placements before entering the renderer.
pub fn validate(document: &Document) -> Result<(), String> {
    let mut min_height = page(&document.default_page)?;
    for config in [
        &document.first_page,
        &document.left_page,
        &document.right_page,
    ]
    .into_iter()
    .flatten()
    {
        min_height = min_height.min(page(config)?);
    }
    for named in document.named_pages.values() {
        min_height = min_height.min(page(&named.base)?);
        for config in [
            &named.display,
            &named.display_first,
            &named.display_left,
            &named.display_right,
        ]
        .into_iter()
        .flatten()
        {
            min_height = min_height.min(page(config)?);
        }
    }
    let mut stack: Vec<_> = document.children.iter().map(|node| (node, 0)).collect();
    let mut nodes = 0;
    let mut cells = 0;
    let mut declared_height = 0.0;
    let mut fixed_height = 0.0;
    let mut continuation_height: f64 = 0.0;
    if let Some(style) = &document.default_style {
        grid(style, &document.children, &mut cells)?;
    }
    while let Some((node, depth)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_NODES || depth > 64 {
            return Err("Document is too complex".into());
        }
        if let NodeKind::Page { config } = &node.kind {
            min_height = min_height.min(page(config)?);
        }
        let style = node.style.resolve(None, 14_400.0);
        let padding = style.padding;
        let border = style.border_width;
        if ![
            padding.top,
            padding.right,
            padding.bottom,
            padding.left,
            border.top,
            border.right,
            border.bottom,
            border.left,
        ]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0)
        {
            return Err("Invalid page padding or border".into());
        }
        continuation_height = continuation_height.max(padding.top + border.top);
        if matches!(node.kind, NodeKind::Fixed { .. }) {
            let height = match style.height {
                SizeConstraint::Fixed(height) => height,
                SizeConstraint::Auto
                    if node
                        .children
                        .iter()
                        .all(|child| matches!(child.style.position, Some(Position::Absolute))) =>
                {
                    (padding.vertical() + border.vertical()).max(style.min_height)
                }
                // shortcut: auto-sized flow headers cannot be bounded without layout, allow them when the renderer enforces a page budget.
                SizeConstraint::Auto => {
                    return Err("Repeated flow content requires an explicit height".into())
                }
            };
            if !height.is_finite() || height < 0.0 {
                return Err("Invalid repeated height".into());
            }
            fixed_height += height;
        }
        if let Some(height) = node.style.height.and_then(|v| v.resolve(14_400.0)) {
            if !height.is_finite() || height < 0.0 {
                return Err("Invalid fixed height".into());
            }
            declared_height += height;
        }
        grid(&node.style, &node.children, &mut cells)?;
        stack.extend(node.children.iter().map(|child| (child, depth + 1)));
    }
    let usable_height = min_height - fixed_height - continuation_height;
    if usable_height < 1.0 {
        return Err("Repeated content and padding leave no room for pagination".into());
    }
    if declared_height > usable_height * 1000.0 {
        return Err("Fixed heights require too many pages".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_impossible_grid_placements_before_rendering() {
        for placement in [
            json!({"columnSpan": 2}),
            json!({"rowSpan": u32::MAX}),
            json!({"rowStart": i32::MAX}),
        ] {
            let document: Document =
                serde_json::from_value(json!({"children": [{"kind": {"type": "View"},
                "style": {"display": "Grid", "gridTemplateColumns": [{"Fr": 1}]},
                "children": [{"kind": {"type": "View"}, "style": {"gridPlacement": placement}}]}]}))
                .unwrap();
            assert!(validate(&document).is_err());
        }
    }

    #[test]
    fn rejects_pages_without_progress_and_extreme_fixed_heights() {
        for (height, margin, fixed) in [(100.0, 50.0, 20.0), (0.0, 0.0, 20.0), (100.0, 0.0, 1e100)]
        {
            let document: Document = serde_json::from_value(
                json!({"children": [{"kind": {"type": "View"}, "style": {"height": {"Pt": fixed}}}],
                "defaultPage": {"size": {"Custom": {"width": 100, "height": height}},
                "margin": {"top": margin, "bottom": margin, "left": 0, "right": 0}}}),
            )
            .unwrap();
            assert!(validate(&document).is_err());
        }
    }

    #[test]
    fn accepts_ordinary_page_and_grid() {
        let document: Document = serde_json::from_value(json!({"children": [{"kind": {"type": "View"},
            "style": {"display": "Grid", "gridTemplateColumns": [{"Fr": 1}, {"Fr": 1}]},
            "children": [{"kind": {"type": "View"}, "style": {"gridPlacement": {"columnSpan": 2}, "height": {"Pt": 1000}}}]}]})).unwrap();
        assert!(validate(&document).is_ok());
    }

    #[test]
    fn rejects_repeated_content_and_padding_that_prevent_progress() {
        for style in [
            json!({"padding": {"top": 900, "right": 0, "bottom": 0, "left": 0}}),
            json!({"borderWidth": {"top": 900, "right": 0, "bottom": 0, "left": 0}}),
        ] {
            let document: Document = serde_json::from_value(
                json!({"children": [{"kind": {"type": "View"}, "style": style}]}),
            )
            .unwrap();
            assert!(validate(&document).is_err());
        }
        for style in [json!({"height": {"Pt": 900}}), json!({})] {
            let document: Document = serde_json::from_value(
                json!({"children": [{"kind": {"type": "Fixed", "position": "Header"},
                "style": style, "children": [{"kind": {"type": "Text", "content": "Header"}}]}]}),
            )
            .unwrap();
            assert!(validate(&document).is_err());
        }
        let document: Document = serde_json::from_value(json!({"children": [{"kind": {"type": "Fixed", "position": "Header"},
            "children": [{"kind": {"type": "View"}, "style": {"position": "Absolute", "height": {"Pt": 700}}}]}]})).unwrap();
        assert!(validate(&document).is_ok());
    }
}
