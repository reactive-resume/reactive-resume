import type { Locale } from "@reactive-resume/utils/locale";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { languageCopyRequest } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { toast } from "@reactive-resume/ui/components/toast";
import { handToAssistant } from "./handoff";
import { savePendingChanges, useResumeStore } from "@/features/resume/builder/draft";
import { getResumeErrorMessage } from "@/libs/error-message";
import { localeMap, selectableLocales } from "@/libs/locale";
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
			handToAssistant(session.user.id, copy, languageCopyRequest(locale));
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
						<Trans>
							The original stays unchanged. Send the copy for translations to review. Hidden content stays untranslated.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<label htmlFor={languageId}>
					<Trans>Language</Trans>
				</label>
				<NativeSelect
					id={languageId}
					value={locale}
					disabled={busy}
					onChange={(event) => setChosenLocale(event.target.value as Locale)}
				>
					{selectableLocales
						.filter((code) => code !== sourceLocale)
						.map((code) => (
							<option key={code} value={code}>
								{i18n._(localeMap[code])}
							</option>
						))}
				</NativeSelect>
				<DialogFooter>
					<Button disabled={busy || !sourceLocale || locale === sourceLocale} onClick={() => void create()}>
						<Trans>Create language copy</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
