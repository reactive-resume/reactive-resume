import type { RichTextFieldProps } from "@/features/write/rich-text-field";
import { RichTextField } from "@/features/write/rich-text-field";

export { RichTextToolbar as LetterRichTextToolbar } from "@/features/write/rich-text-field";

type LetterRichTextProps = Omit<RichTextFieldProps, "letter"> & {
	applicationId?: string | null | undefined;
};

/** Letters share selection, reviewed replacement and native HTML/history ownership with resume fields. */
export function LetterRichText({ applicationId, ...props }: LetterRichTextProps) {
	return <RichTextField {...props} minLines={props.minLines ?? 8} letter={{ applicationId }} />;
}
