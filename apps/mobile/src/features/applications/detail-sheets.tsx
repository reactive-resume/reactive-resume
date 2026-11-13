import type { Application, ApplicationRow } from "./model";
// J6's sheets: Edit details, Link a resume or letter, and (after "I accepted this offer") closing the other open
// applications as "I accepted another offer", with a way to reopen them from the hero until dismissed.
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { useApplicationActions } from "./actions";
import { attachPostingPdf, openPostingPdf, pickPostingPdf, PostingPdfError, removePostingPdf } from "./posting-file";
import { useApplications, useDataActions, useDocuments, useLocalValue } from "@/data";
import { BottomSheet, Button, Checkbox, Icon, layout, ListRow, showToast, TextField, TextLink } from "@/ui";

/** ⋯ › Edit details: role, company, location and salary, saved together. */
export function EditDetailsSheet({ app, onClose }: { app: Application; onClose: () => void }) {
	const { write } = useDataActions();
	const queryClient = useQueryClient();
	const [role, setRole] = useState(app.role);
	const [company, setCompany] = useState(app.company);
	const [location, setLocation] = useState(app.location ?? "");
	const [salary, setSalary] = useState(app.salary ?? "");
	const dirty =
		role !== app.role || company !== app.company || location !== (app.location ?? "") || salary !== (app.salary ?? "");
	const save = async () => {
		if (!role.trim() || !company.trim()) return;
		try {
			await write("applications", "applications.update", {
				id: app.id,
				role: role.trim(),
				company: company.trim(),
				location: location.trim() || null,
				salary: salary.trim() || null,
			});
			await queryClient.invalidateQueries();
		} catch {
			showToast({ message: t`Couldn't update the application. Try again.` });
			return;
		}
		onClose();
		showToast({ message: t`Details saved` });
	};
	return (
		<BottomSheet title={t`Edit details`} height={560} onClose={onClose} dirty={dirty} keyboard closeIconSize={24}>
			<View style={{ paddingTop: 8, paddingHorizontal: layout.screenMargin, gap: 16 }}>
				<TextField label={t`Role`} value={role} onChangeText={setRole} testID="edit-role" />
				<TextField label={t`Company`} value={company} onChangeText={setCompany} />
				<TextField label={t`Location`} value={location} onChangeText={setLocation} />
				<TextField label={t`Salary`} value={salary} onChangeText={setSalary} />
				<Button
					label={t`Save`}
					tone="primary"
					size="lg"
					block
					disabled={!role.trim() || !company.trim()}
					onPress={() => void save()}
					testID="edit-save"
				/>
			</View>
		</BottomSheet>
	);
}

type PostingSheetProps = { app: Application; onClose: () => void };

/** The posting's link and the employer's original PDF, kept in case the posting changes or disappears. */
export function PostingSheet({ app, onClose }: PostingSheetProps) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const run = async (action: () => Promise<void>, failure: string) => {
		setBusy(true);
		try {
			await action();
			await queryClient.invalidateQueries();
		} catch (error) {
			showToast({ message: error instanceof PostingPdfError ? error.message : failure });
		} finally {
			setBusy(false);
		}
	};
	const attach = () =>
		run(
			async () => {
				const file = await pickPostingPdf();
				if (!file) return;
				await attachPostingPdf(app.id, file);
				showToast({ message: t`Posting PDF attached` });
			},
			t`Couldn't attach the posting PDF. Try again.`,
		);
	const remove = () =>
		run(
			async () => {
				await removePostingPdf(app.id);
				showToast({ message: t`Posting PDF removed` });
			},
			t`Couldn't remove the posting PDF. Try again.`,
		);
	const open = () =>
		run(
			() => openPostingPdf(app.postingFileUrl ?? "", app.postingFileName ?? t`Posting`),
			t`Couldn't open the posting PDF. Try again.`,
		);
	return (
		<BottomSheet title={t`Posting`} height={440} onClose={onClose} closeIconSize={24}>
			<View style={{ paddingTop: 8 }}>
				{app.sourceUrl ? (
					<ListRow
						title={t`Job posting link`}
						secondary={app.sourceUrl}
						leading={<Icon name="link-simple" size={24} color="ink2" />}
						trailing="caret"
						onPress={() => void openBrowserAsync(app.sourceUrl ?? "")}
					/>
				) : null}
				{app.postingFileUrl ? (
					<>
						<ListRow
							title={t`Original posting PDF`}
							secondary={app.postingFileName ?? undefined}
							leading={<Icon name="file-pdf" size={24} color="ink2" />}
							trailing="caret"
							last
							disabled={busy}
							onPress={() => void open()}
						/>
						<View style={{ flexDirection: "row", gap: 24, paddingHorizontal: layout.screenMargin, paddingTop: 12 }}>
							<TextLink label={t`Replace PDF`} onPress={busy ? undefined : () => void attach()} />
							<TextLink label={t`Remove PDF`} onPress={busy ? undefined : () => void remove()} />
						</View>
					</>
				) : (
					<ListRow
						title={t`Attach the posting PDF`}
						secondary={t`Keep a copy in case it changes or is taken down`}
						leading={<Icon name="file-pdf" size={24} color="ink2" />}
						last
						disabled={busy}
						onPress={() => void attach()}
					/>
				)}
			</View>
		</BottomSheet>
	);
}

/** ⋯ › Link a resume or letter: the one the application uses for Apply, Fit and "What did you send?". */
export function LinkDocumentSheet({ app, onClose }: { app: Application; onClose: () => void }) {
	const documents = useDocuments();
	const { write } = useDataActions();
	const queryClient = useQueryClient();
	const link = async (doc: { id: string; type: "resume" | "letter"; name: string }) => {
		try {
			await write(
				"applications",
				"applications.update",
				doc.type === "resume" ? { id: app.id, resumeId: doc.id } : { id: app.id, coverLetterId: doc.id },
			);
			await queryClient.invalidateQueries();
		} catch {
			showToast({ message: t`Couldn't update the application. Try again.` });
			return;
		}
		onClose();
		showToast({ message: t`Linked “${doc.name}”` });
	};
	const rows = documents.data ?? [];
	return (
		<BottomSheet title={t`Link a resume or letter`} height={560} onClose={onClose} closeIconSize={24}>
			<View style={{ paddingTop: 8 }}>
				{rows.map((doc, i) => {
					const linked = doc.type === "resume" ? app.resumeId === doc.id : app.coverLetterId === doc.id;
					return (
						<ListRow
							key={`${doc.type}:${doc.id}`}
							title={doc.name}
							secondary={doc.type === "resume" ? t`Resume` : t`Letter`}
							leading={<Icon name={doc.type === "resume" ? "file-text" : "envelope-simple"} size={24} color="ink2" />}
							trailing={linked ? <Icon name="check" size={20} color="accentText" /> : undefined}
							accessibilityState={{ selected: linked }}
							last={i === rows.length - 1}
							onPress={() => void link(doc)}
						/>
					);
				})}
			</View>
		</BottomSheet>
	);
}

/** Open applications other than this one: what "I accepted this offer" offers to close. */
export function useOtherOpen(app: Application) {
	const applications = useApplications();
	return (applications.data ?? []).filter((row) => row.id !== app.id && row.status !== "closed");
}

/** Closed for another offer from this application's hero: their ids, until dismissed. */
export function useClosedForOffer(app: Application) {
	return useLocalValue<{ ids: string[]; dismissed: boolean }>(`closed-for-offer:${app.id}`, {
		ids: [],
		dismissed: false,
	});
}

/** "Close the other 4 applications…": all ticked; untick any; Close 4 as I accepted another offer. */
export function CloseOthersSheet({
	app,
	others,
	onClose,
}: {
	app: Application;
	others: ApplicationRow[];
	onClose: () => void;
}) {
	const actions = useApplicationActions();
	const record = useClosedForOffer(app);
	const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
	const picked = others.filter((row) => !unticked.has(row.id));
	const [saving, setSaving] = useState(false);
	const closeAll = async () => {
		setSaving(true);
		const closed: string[] = [];
		try {
			for (const row of picked) {
				await actions.close(row.id, "accepted-other", undefined, row.status, false);
				closed.push(row.id);
			}
		} catch {
			showToast({ message: t`Couldn't close the application. Try again.` });
		} finally {
			setSaving(false);
		}
		if (closed.length) record.set({ ids: closed, dismissed: false });
		if (closed.length === picked.length) {
			onClose();
			showToast({ message: closed.length === 1 ? t`Closed 1 application` : t`Closed ${closed.length} applications` });
		}
	};
	return (
		<BottomSheet title={t`Close the other applications`} height={640} onClose={onClose} closeIconSize={24}>
			<View style={{ flex: 1 }}>
				{others.map((row, i) => (
					<ListRow
						key={row.id}
						top={i === 0}
						last={i === others.length - 1}
						title={row.company}
						secondary={row.role}
						leading={<Checkbox value={!unticked.has(row.id)} interactive={false} saves={false} />}
						accessibilityRole="checkbox"
						accessibilityState={{ checked: !unticked.has(row.id) }}
						onPress={() =>
							setUnticked((current) => {
								const next = new Set(current);
								if (next.has(row.id)) next.delete(row.id);
								else next.add(row.id);
								return next;
							})
						}
					/>
				))}
				<View style={{ paddingTop: 16, paddingHorizontal: layout.screenMargin }}>
					<Button
						label={t`Close ${picked.length} as I accepted another offer`}
						tone="primary"
						size="lg"
						block
						disabled={!picked.length || saving}
						onPress={() => void closeAll()}
						testID="close-others-confirm"
					/>
				</View>
			</View>
		</BottomSheet>
	);
}
