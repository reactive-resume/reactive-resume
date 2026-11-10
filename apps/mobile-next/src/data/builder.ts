import type { MutationInputs, MutationOutput } from "./resources";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { useMemo } from "react";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { usePlatformActions } from "./actions";
import { postingTerms } from "./board-fixtures";
import { dataClient } from "./client";
import { now } from "./clock";
import { useDataBackend } from "./provider";
import { useApplication } from "./provider";
import { assertDataScope } from "./scope";

export function useJobMatch(data: ResumeData | null, applicationId: string | null, pasted = "") {
	const application = useApplication(applicationId ?? "");
	const { backend } = useDataBackend();
	const app = applicationId ? application.data : undefined;
	const posting = applicationId ? (app?.jobDescription ?? "") : pasted;
	const engine = useQuery({
		queryKey: ["ats-pdf-engine"],
		queryFn: () => import("@reactive-resume/resume/ats-pdf"),
		enabled: !!posting,
		staleTime: Infinity,
	});
	const result = useMemo(() => {
		if (!data || !posting) return null;
		const resumeText = buildMarkdown(data);
		const hidden = new Set(data.metadata.check?.hiddenTerms ?? []);
		const terms =
			backend.kind === "fake" && app?.id === "lumen"
				? postingTerms.map((label) => ({
						label,
						term: label.toLowerCase(),
						jdCount: 1,
						resumeCount: Number(resumeText.toLowerCase().includes(label.toLowerCase())),
						weight: 1,
					}))
				: engine.data
						?.matchJobDescription({
							jobDescription: posting,
							resumeText,
							company: app?.company,
							location: app?.location ?? undefined,
							role: app?.role,
						})
						.terms.map((term) => ({ ...term, label: term.term }));
		if (!terms) return null;
		const visible = terms.filter((term) => !hidden.has(term.term));
		return {
			found: visible.filter((term) => term.resumeCount > 0),
			missing: visible.filter((term) => term.resumeCount === 0),
			total: terms.length,
		};
	}, [data, posting, app, backend.kind, engine.data]);
	return {
		application: app ?? null,
		posting,
		result,
		loading: !!applicationId && application.isPending,
		reading: !!posting && engine.isPending,
	};
}
export function useCheckReport(data: ResumeData | undefined) {
	const { backend } = useDataBackend();
	return useMemo(() => {
		if (!data) return { report: undefined };
		const report = checkReport(data);
		return backend.kind === "fake"
			? {
					report: {
						...report,
						score: 86,
						passedRules: 4,
						findings: report.findings.map((f) =>
							f.code === "TIGHT_LINE_HEIGHT" ? { ...f, params: { ...f.params, minimum: 1.2 } } : f,
						),
					},
					verdict: t`Mostly readable`,
				}
			: { report };
	}, [data, backend.kind]);
}

export function checkReport(data: ResumeData) {
	return lintResumeForAts(data, { now: now() });
}
export function useImprove() {
	const actions = usePlatformActions();
	const { scope } = useDataBackend();
	const active = useRef<AbortController | null>(null);
	const [state, setState] = useState<{
		owner: string | null;
		progress: "idle" | "working" | "stopped" | "complete" | "failed";
		original: string;
		proposal?: MutationOutput<"ai.improve">;
		failure?: unknown;
	}>({ owner: scope, progress: "idle", original: "" });
	useEffect(
		() => () => {
			active.current?.abort();
			active.current = null;
		},
		[scope],
	);
	return {
		...(state.owner === scope ? state : { progress: "idle" as const, original: "" }),
		stop() {
			active.current?.abort();
			active.current = null;
			setState((old) => ({ ...old, progress: "stopped" }));
		},
		async improve(input: MutationInputs["ai.improve"]) {
			active.current?.abort();
			const flight = new AbortController();
			active.current = flight;
			setState({ owner: scope, progress: "working", original: input.line });
			try {
				const proposal = await actions.run("ai.improve", input, flight.signal);
				if (active.current === flight) setState({ owner: scope, progress: "complete", original: input.line, proposal });
				return proposal;
			} catch (failure) {
				if (active.current === flight)
					setState({
						owner: scope,
						progress: flight.signal.aborted ? "stopped" : "failed",
						original: input.line,
						failure,
					});
				throw failure;
			}
		},
	};
}
export function validatePhoto(size: number, type: string) {
	if (!Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) throw new Error(t`Choose a photo up to 10 MB.`);
	if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(type))
		throw new Error(t`Unsupported photo format.`);
}
/** Progress describes phases: oRPC does not report byte progress. No document is changed until caller accepts URL. */
export function usePhotoUpload() {
	const { scope, backend } = useDataBackend();
	const [progress, setProgress] = useState<"idle" | "reading" | "uploading" | "complete" | "failed">("idle");
	return {
		progress,
		async upload(uri: string, signal?: AbortSignal) {
			if (!scope) throw new Error(t`Sign in again.`);
			try {
				setProgress("reading");
				const file = new File(uri);
				validatePhoto(file.size, file.type);
				signal?.throwIfAborted();
				assertDataScope(scope);
				setProgress("uploading");
				const result =
					backend.kind === "fake"
						? { url: uri, path: "fixture-photo", contentType: file.type }
						: await dataClient.storage.uploadFile(
								Object.assign(file, { webkitRelativePath: "", lastModified: file.lastModified ?? 0 }),
								{ context: { scope }, ...(signal ? { signal } : {}) },
							);
				assertDataScope(scope);
				signal?.throwIfAborted();
				setProgress("complete");
				return result;
			} catch (error) {
				setProgress("failed");
				throw error;
			}
		},
	};
}
