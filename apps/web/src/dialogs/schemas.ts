import type { NewDocumentDialogData } from "@/features/documents/new-document-dialog";
import type { ReactNode } from "react";

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

type DialogRendererEntry<T extends DialogType = DialogType> = {
	type: T;
	render: (dialog: Extract<DialogSchema, { type: T }>) => ReactNode;
};

export type AnyDialogRendererEntry = {
	[T in DialogType]: DialogRendererEntry<T>;
}[DialogType];

export type DialogData<T extends DialogType> = Extract<DialogSchema, { type: T }>["data"];

type DialogPropsData<T extends DialogType> =
	DialogData<T> extends undefined ? Record<string, never> : { data: DialogData<T> };

export type DialogProps<T extends DialogType> = DialogPropsData<T>;
