import type { ReactNode } from "react";
import { isValidElement } from "react";

const LETTER = /\p{L}/u;
const RTL_LETTER =
	/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;

const textOf = (node: ReactNode): string => {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
	return "";
};

/**
 * A paragraph's direction on a right-to-left page, as `dir="auto"` decides it: its first letter's. An Arabic or Hebrew
 * paragraph reads right to left; a Latin or Japanese one left to right, its full stop at the end. With no letters, the
 * page's direction.
 */
export function paragraphDirection(node: ReactNode): "ltr" | "rtl" {
	return textDirection(textOf(node));
}

/** The same decision for plain text: its first letter's direction, or right to left with no letters. */
export function textDirection(text: string): "ltr" | "rtl" {
	for (const char of text) if (LETTER.test(char)) return RTL_LETTER.test(char) ? "rtl" : "ltr";
	return "rtl";
}
