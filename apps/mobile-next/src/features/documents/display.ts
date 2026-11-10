import type { Document } from "./model";
import { t } from "@lingui/core/macro";

export function editedLabel(date: Date, now: Date): string {
	const hours = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 3_600_000));
	if (hours < 1) return t`Edited just now`;
	if (hours < 24) return t`Edited ${hours} h ago`;
	if (hours < 48) return t`Edited yesterday`;
	const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
	return t`Edited ${day}`;
}

export function documentDetail(document: Document, now: Date): string {
	const edited = editedLabel(document.editedAt, now);
	if (document.isLocked) return t`${edited} · Locked`;
	if (document.isPublic) return document.hasPassword ? t`${edited} · Public with a password` : t`${edited} · Public`;
	if (document.application) return t`${edited} · For ${document.application.company}`;
	return edited;
}
