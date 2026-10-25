import type { NewDocumentDialogData } from "@/features/documents/new-document-dialog";

type EmptyDialog<T extends string> = { [K in T]: { type: K; data?: undefined } }[T];

export type DialogSchema =
	| EmptyDialog<"auth.change-password" | "auth.two-factor.enable" | "auth.two-factor.disable">
	| {
			type: "document.new";
			data?: NewDocumentDialogData | undefined;
	  }
	| {
			type: "resume.update";
			data: { id: string; name: string; slug: string; tags: string[] };
	  }
	| {
			type: "resume.duplicate";
			data: { id: string; name: string; slug: string; tags: string[] };
	  };

export type DialogType = DialogSchema["type"];

export type DialogData<T extends DialogType> = Extract<DialogSchema, { type: T }>["data"];

export type DialogProps<T extends DialogType> =
	DialogData<T> extends undefined ? Record<string, never> : { data: DialogData<T> };
