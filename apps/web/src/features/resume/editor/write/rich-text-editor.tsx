import type { FocusRequest, RichTextEditorProps } from "./rich-text-editor-field";
import { Trans } from "@lingui/react/macro";
import { lazy, Suspense, useMemo, useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { hasUnsupportedTableMarkup, toPreviewHtml } from "@/components/input/rich-text-markup";

// Tiptap and ProseMirror are most of the builder's script. The editor loads when a field first renders (or earlier,
// see preloadRichTextEditor), and the field shows its text read-only until then, so the first render doesn't wait.
const loadField = () => import("./rich-text-editor-field");
const RichTextEditorField = lazy(() => loadField().then((module) => ({ default: module.RichTextEditor })));

/** Starts loading the editor, so fields are editable as soon as they show. */
export const preloadRichTextEditor = () => void loadField();

/** Rich text for descriptions. See ./rich-text-editor-field.tsx. */
export function RichTextEditor(props: RichTextEditorProps) {
	// A click or focus that lands on the preview moves to the editor once it mounts.
	const [focusRequest, setFocusRequest] = useState<FocusRequest>();

	return (
		<Suspense fallback={<RichTextPreview {...props} onFocusRequest={setFocusRequest} />}>
			<RichTextEditorField {...props} focusRequest={focusRequest} />
		</Suspense>
	);
}

type RichTextPreviewProps = RichTextEditorProps & {
	onFocusRequest: (update: (current: FocusRequest) => FocusRequest) => void;
};

/** The editor's frame and text at the same size and with the same markup rules, read-only, while it loads. */
function RichTextPreview({
	value,
	disabled = false,
	className,
	id,
	heightClassName = "max-h-[360px] min-h-[88px]",
	onFocusRequest,
}: RichTextPreviewProps) {
	const html = useMemo(() => toPreviewHtml(value), [value]);
	const readOnlyTable = useMemo(() => hasUnsupportedTableMarkup(value), [value]);
	const editable = !disabled && !readOnlyTable;

	return (
		<div className={cn("rounded-lg border border-control-border bg-raised", disabled && "bg-sunken", className)}>
			{readOnlyTable && (
				<p role="status" className="border-b border-line px-3 py-2 text-xs text-ink-2">
					<Trans>
						Original table formatting is preserved. This content is read-only because it cannot be edited safely.
					</Trans>
				</p>
			)}
			{/* Not a textbox yet: tests and assistive tech find the real one once it mounts. A click, or focus moved here
			    by id, is handed to the editor. */}
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- forwards to the editor, see above. */}
			<div
				id={id}
				aria-busy="true"
				tabIndex={editable ? -1 : undefined}
				onPointerDown={(event) => editable && onFocusRequest(() => ({ x: event.clientX, y: event.clientY }))}
				onFocus={() => editable && onFocusRequest((current) => current ?? "end")}
				className={cn(
					"typeset typeset-field overflow-y-auto px-3 py-2 text-sm outline-none",
					heightClassName,
					"[&_[data-resume-whitespace=preserve]]:whitespace-pre-wrap",
				)}
				// oxlint-disable-next-line react/no-danger -- toPreviewHtml keeps only the editor's own allowlisted markup.
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		</div>
	);
}
