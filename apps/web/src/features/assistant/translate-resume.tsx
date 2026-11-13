import type { Locale } from "@reactive-resume/utils/locale";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { toast } from "@reactive-resume/ui/components/toast";
import { handToAssistant } from "./handoff";
import { Combobox } from "@/components/ui/combobox";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { savePendingChanges, useResumeStore } from "@/features/resume/builder/draft";
import { getResumeErrorMessage } from "@/libs/error-message";
import { localeMap } from "@/libs/locale";
import { client, orpc } from "@/libs/orpc/client";

type TranslateResumeProps = { resumeId: string; onClose: () => void };

/** Creating a language copy never sends data to a provider; the copied assistant opens with an unsent draft. */
export function TranslateResume({ resumeId, onClose }: TranslateResumeProps) {
	const { i18n } = useLingui();
	const { session } = useRouteContext({ from: "/builder/$resumeId" });
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const languageId = useId();
	const sourceLocale = useResumeStore((state) =>
		state.resume?.id === resumeId ? state.resume.data.metadata.page.locale : undefined,
	);
	const [chosenLocale, setChosenLocale] = useState<Locale | null>(null);
	const fallbackLocale: Locale = sourceLocale === "de-DE" ? "en-US" : "de-DE";
	const locale = chosenLocale && chosenLocale !== sourceLocale ? chosenLocale : fallbackLocale;
	const sourceName = useResumeStore((state) => (state.resume?.id === resumeId ? state.resume.name : ""));
	const copyName = `${sourceName} — ${i18n._(localeMap[locale])}`;
	const [busy, setBusy] = useState(false);
	const active = useRef(false);
	const create = async () => {
		if (active.current || !sourceLocale || locale === sourceLocale) return;
		active.current = true;
		setBusy(true);
		try {
			if (!(await savePendingChanges(resumeId))) throw new Error(t`Save this resume's changes before copying it.`);
			const source = useResumeStore.getState().resume;
			if (source?.id !== resumeId || source.data.metadata.page.locale === locale) return;
			const language = i18n._(localeMap[locale]);
			const copy = await client.resume.duplicate({
				id: resumeId,
				name: `${source.name} — ${language}`,
				pageLocale: locale,
			});
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			handToAssistant(
				session.user.id,
				copy,
				// The board's short request; the server shows a language copy's assistant only its visible fields.
				t`Translate this resume into ${language}. Keep names, dates and numbers as they are.`,
			);
			await navigate({ to: "/builder/$resumeId", params: { resumeId: copy }, search: {} });
			onClose();
		} catch (error) {
			toast.add({ type: "error", description: getResumeErrorMessage(error) });
		} finally {
			active.current = false;
			setBusy(false);
		}
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent closeLabel={t`Close`}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Translate into…</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>The original stays unchanged. Hidden content stays untranslated.</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-1.5">
					<Label htmlFor={languageId}>
						<Trans>Language</Trans>
					</Label>
					<Combobox
						render={(props) => (
							<Button {...props} variant="secondary" className="h-10 w-full justify-start font-normal">
								<Icon name="translate" size={18} />
								{props.children}
							</Button>
						)}
						id={languageId}
						value={locale}
						disabled={busy}
						onValueChange={setChosenLocale}
						options={getLocaleOptions()
							.filter(({ value }) => value !== sourceLocale)
							.map((option) => ({
								...option,
								label: i18n._(localeMap[option.value]),
								textValue: i18n._(localeMap[option.value]),
							}))}
						aria-describedby={`${languageId}-hint`}
					/>
					<p id={`${languageId}-hint`} className="text-[13px]/[18px] text-ink-3">
						<Trans>
							Makes a copy named “{copyName}” and opens it with a request ready for the assistant. Nothing is sent until
							you send it.
						</Trans>
					</p>
				</div>
				<DialogFooter>
					<Button variant="ghost" disabled={busy} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						variant="secondary"
						disabled={busy || !sourceLocale || locale === sourceLocale}
						onClick={() => void create()}
					>
						<Trans>Create language copy</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
