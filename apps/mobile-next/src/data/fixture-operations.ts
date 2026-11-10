import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { now } from "./clock";
import { fixtureArtifact } from "./fixture-artifacts";

type Row = Record<string, unknown>;
export type FixtureState = Record<string, unknown>;
let sequence = 0;
const id = () => `fixture-${++sequence}`;
const rows = (state: FixtureState, key: string) => (state[key] ??= []) as Row[];
const find = (state: FixtureState, key: string, value: unknown) => {
	const row = rows(state, key).find((row) => row.id === value);
	if (!row) throw new Error(`Fixture ${key} not found.`);
	return row;
};
export function extendedSeed(empty: boolean) {
	sequence = 0;
	return {
		conversations: [] as Row[],
		conversationMessages: {} as Record<string, Row[]>,
		attachments: [] as Row[],
		feedbackLinks: empty
			? []
			: ["Careers office", "Maria, mentor"].map((label, index) => ({
					id: `feedback-${index}`,
					resumeId: "resume-product",
					resumeName: "Product designer",
					label,
					url: `https://rxresu.me/feedback/fixture-${index}`,
					status: "active",
					allowComments: index === 0,
					applicationIds: [],
					expiresAt: index === 0 ? new Date(now().getTime() + 23 * 86400000) : null,
					revokedAt: null,
					lastViewedAt: null,
					createdAt: now(),
					commentCount: index === 0 ? 3 : 0,
					openCommentCount: index === 0 ? 3 : 0,
					comments: [],
					events: [],
				})),
		customDomain: null,
		forgottenFacts: [] as Row[],
		transcripts: [] as Row[],
		apiKeys: { apiKeys: [], total: 0 },
		connectedApps: { connections: [] },
	};
}
export function fixtureRead(resource: string, input: Row, state: FixtureState): { value: unknown } | undefined {
	if (resource === "documentPage") {
		const all = rows(state, "documents").filter((row) => Boolean(row.trashedAt) === Boolean(input.trashed));
		const filtered = all.filter(
			(row) =>
				(!input.type || input.type === "all" || row.type === input.type) &&
				(!input.q || String(row.name).toLowerCase().includes(String(input.q).toLowerCase())),
		);
		return {
			value: {
				items: filtered.slice(Number(input.offset ?? 0), Number(input.offset ?? 0) + Number(input.limit ?? 100)),
				total: filtered.length,
				counts: {
					resume: all.filter((row) => row.type === "resume").length,
					letter: all.filter((row) => row.type === "letter").length,
				},
				tags: [...new Set(all.flatMap((row) => row.tags as string[]))].sort(),
				hasPublic: all.some((row) => row.isPublic),
			},
		};
	}
	if (resource === "resumeVersion" || resource === "letterVersion")
		return { value: find(state, resource === "resumeVersion" ? "versions" : "letterVersions", input.versionId) };
	if (resource === "visitorStatistics")
		return {
			value: {
				isPublic: find(state, "resumes", input.id).isPublic,
				views: 128,
				downloads: 14,
				lastViewedAt: now(),
				lastDownloadedAt: now(),
			},
		};
	if (resource === "dailyVisitors")
		return {
			value: Array.from({ length: Number(input.days ?? 30) }, (_, index) => ({
				date: new Date(now().getTime() - (Number(input.days ?? 30) - index - 1) * 86400000).toISOString().slice(0, 10),
				views: index < 28 ? 4 : 8,
				downloads: index < 14 ? 1 : 0,
			})),
		};
	if (resource === "feedbackLinks")
		return { value: rows(state, resource).filter((row) => !input.resumeId || row.resumeId === input.resumeId) };
	if (resource === "feedbackLink") return { value: find(state, "feedbackLinks", input.id) };
	if (resource === "conversation") {
		const thread = find(state, "conversations", input.id);
		const messages = (state.conversationMessages as Record<string, Row[]>)[String(input.id)] ?? [];
		const document = thread.sourceResumeId ? find(state, "resumes", thread.sourceResumeId) : null;
		return {
			value: {
				thread,
				messages,
				attachments: rows(state, "attachments").filter((row) => row.threadId === input.id),
				document: document ? { kind: "resume", id: document.id, name: document.name, locked: document.isLocked } : null,
				isReadOnly: false,
				history: { cutoffAt: null, withheld: [] },
				interrupted: [],
			},
		};
	}
	if (resource === "library")
		return {
			value: rows(state, "offers").filter(
				(row) =>
					(!input.applicationId || row.applicationId === input.applicationId) &&
					(!input.kind || (row.data as Row).kind === input.kind),
			),
		};
	if (resource === "applicationStats") {
		const applications = rows(state, "applications").filter((row) => !row.trashedAt);
		return {
			value: {
				total: applications.length,
				byStage: [...new Set(applications.map((row) => row.status))].map((status) => ({
					status,
					count: applications.filter((row) => row.status === status).length,
				})),
				bySource: [],
			},
		};
	}
	return;
}
/** Only fixture dispatch is untyped; public hooks use the router's exact input/output contracts. */
export function fixtureWrite(operation: string, input: Row, state: FixtureState): { value: unknown } | undefined {
	const [area, action] = operation.split(".");
	if (["resume", "coverLetters"].includes(area ?? "") && ["create", "import", "duplicate"].includes(action ?? "")) {
		const letter = area === "coverLetters";
		const source = action === "duplicate" ? find(state, letter ? "letters" : "resumes", input.id) : undefined;
		const data = structuredClone(input.data ?? source?.data ?? defaultResumeData);
		const application = input.applicationId ? find(state, "applications", input.applicationId) : null;
		const resume = input.resumeId ? find(state, "resumes", input.resumeId) : null;
		const document = {
			name: "Untitled",
			slug: id(),
			data,
			aiOperationIds: [],
			tags: [],
			hasPassword: false,
			showDownloadButtons: true,
			allowWordDownload: false,
			...(letter
				? {
						recipient: "",
						content: "",
						layout: "structured",
						recipientName: null,
						recipientCompany: application?.company ?? null,
						greeting: null,
						signOff: null,
						letterDate: now().toISOString().slice(0, 10),
						senderLinked: !!resume,
						designLinked: !!resume,
						style: copyCoverLetterStyle((resume?.data ?? defaultResumeData) as typeof defaultResumeData),
						sourceResumeId: resume?.id ?? null,
						sourceApplicationId: application?.id ?? null,
						revision: 1,
					}
				: {}),
			...(source ? structuredClone(source) : {}),
			...input,
			id: id(),
			createdAt: now(),
			updatedAt: now(),
			isLocked: false,
			isPublic: false,
			isPrimary: false,
		};
		rows(state, letter ? "letters" : "resumes").push(document);
		rows(state, "documents").push({
			...document,
			type: letter ? "letter" : "resume",
			editedAt: now(),
			trashedAt: null,
			application,
			recipient: letter ? (application?.company ?? null) : null,
		});
		return { value: letter ? document : document.id };
	}
	if (operation === "documents.copyForJob") {
		const existing = rows(state, "resumes").find((row) => row.id === input.newId);
		if (existing) {
			const summary = find(state, "documents", existing.id);
			const application = existing.applicationId
				? rows(state, "applications").find((row) => row.id === existing.applicationId && !row.trashedAt)
				: null;
			if (
				summary.trashedAt ||
				(existing.applicationId && (!application || (summary.application as Row | null)?.id !== application.id)) ||
				existing.copyRequest !== JSON.stringify(input)
			)
				throw new Error("Copy request changed.");
			return { value: existing.id };
		}
		const source = find(state, "resumes", input.resumeId);
		if (source.isLocked) throw new Error("Unlock this document before copying.");
		const application = input.application
			? {
					...(input.application as Row),
					id: id(),
					status: "saved",
					activity: [],
					createdAt: now(),
					updatedAt: now(),
					trashedAt: null,
				}
			: input.applicationId
				? find(state, "applications", input.applicationId)
				: null;
		const copy = {
			...structuredClone(source),
			id: input.newId ?? id(),
			copyRequest: JSON.stringify(input),
			name: input.name ?? `${source.name} — ${application?.company ?? "Copy"}`,
			applicationId: application?.id ?? null,
			isPublic: false,
			isPrimary: false,
			hasPassword: false,
			updatedAt: now(),
		};
		if (input.application && application) rows(state, "applications").push({ ...application, resumeId: copy.id });
		rows(state, "resumes").push(copy);
		rows(state, "documents").push({ ...copy, type: "resume", editedAt: now(), application, trashedAt: null });
		return { value: copy.id };
	}
	if (operation === "documents.setLocked" || operation === "documents.linkApplication") {
		const row = find(state, input.type === "letter" ? "letters" : "resumes", input.id);
		const summary = find(state, "documents", input.id);
		if (row.isLocked && action !== "setLocked") throw new Error("Unlock this document before editing.");
		if (action === "setLocked") {
			row.isLocked = input.isLocked;
			summary.isLocked = input.isLocked;
		} else {
			const application = input.applicationId ? find(state, "applications", input.applicationId) : null;
			row[input.type === "letter" ? "sourceApplicationId" : "applicationId"] = input.applicationId;
			summary.application = application;
		}
		return { value: null };
	}
	if (action?.endsWith("Version")) {
		const letter = area === "coverLetters";
		const key = letter ? "letterVersions" : "versions";
		const document = find(state, letter ? "letters" : "resumes", input.resumeId ?? input.id);
		if (document.isLocked) throw new Error("Unlock this document before editing.");
		if (action === "createVersion") {
			const version = {
				id: id(),
				kind: "named",
				name: input.name,
				createdAt: now(),
				resumeId: document.id,
				coverLetterId: document.id,
				data: structuredClone(letter ? document : document.data),
				aiOperationIds: [],
				aiUsage: null,
			};
			rows(state, key).unshift(version);
			return { value: version };
		}
		const version = find(state, key, input.versionId);
		if ((action === "renameVersion" || action === "deleteVersion") && version.kind !== "named")
			throw new Error("Only named versions can be changed.");
		if (action === "renameVersion") {
			version.name = input.name;
			return { value: version };
		}
		if (action === "deleteVersion") {
			rows(state, key).splice(rows(state, key).indexOf(version), 1);
			return { value: undefined };
		}
		if (action === "restoreVersion") {
			rows(state, key).unshift({
				id: id(),
				kind: "restore",
				name: null,
				createdAt: now(),
				data: structuredClone(letter ? document : document.data),
			});
			if (letter)
				Object.assign(document, structuredClone(version.data), {
					revision: Number(document.revision) + 1,
					updatedAt: now(),
				});
			else Object.assign(document, { data: structuredClone(version.data), updatedAt: now() });
			return { value: document };
		}
	}
	if (operation === "resume.setPassword" || operation === "resume.removePassword") {
		const row = find(state, "resumes", input.id);
		row.hasPassword = action === "setPassword";
		return { value: undefined };
	}
	if (operation === "applications.create") {
		const row = {
			...structuredClone(rows(state, "applications")[0] ?? {}),
			...input,
			id: id(),
			status: input.status ?? "saved",
			activity: [],
			trashedAt: null,
			createdAt: now(),
			updatedAt: now(),
		};
		rows(state, "applications").push(row);
		return { value: row.id };
	}
	if (operation === "applications.bulkUpdate") {
		const targets = rows(state, "applications").filter((row) => (input.ids as string[]).includes(String(row.id)));
		const updated: Row[] = [];
		for (const row of targets) {
			const expected = (input.expectedStages as Row[] | undefined)?.find((item) => item.id === row.id);
			if (expected && ["status", "laneId", "closedReason"].some((key) => key in expected && row[key] !== expected[key]))
				continue;
			if (input.status) row.status = input.status;
			if ("laneId" in input) row.laneId = input.laneId;
			if ("closedReason" in input) row.closedReason = input.closedReason;
			if (input.addTags) row.tags = [...new Set([...((row.tags as string[]) ?? []), ...(input.addTags as string[])])];
			updated.push(row);
		}
		return {
			value: {
				updated: updated.length,
				stages: updated.map((row) => ({
					id: row.id,
					status: row.status,
					laneId: row.laneId ?? null,
					closedReason: row.closedReason ?? null,
					stageEntryId: null,
				})),
			},
		};
	}
	if (
		operation === "applications.addInterview" ||
		operation === "applications.updateInterview" ||
		operation === "applications.logFollowUp"
	) {
		const application = find(state, "applications", input.id);
		const activity = application.activity as Row[];
		if (action === "updateInterview") Object.assign(activity.find((row) => row.id === input.interviewId) ?? {}, input);
		else activity.push({ ...input, id: id(), type: action === "logFollowUp" ? "follow_up" : "interview" });
		return { value: application };
	}
	if (operation === "applications.ai.parsePosting")
		return {
			value: {
				company: "Lumen",
				role: "Senior product designer",
				location: "Lisbon",
				salary: "",
				requirements: [],
				jobDescription: input.input,
				sourceUrl: String(input.input).startsWith("https:") ? input.input : null,
				postingSource: null,
				enrichmentWarning: null,
				filledBy: "page",
			},
		};
	if (operation === "career.markNotificationRead" || operation === "career.dismissOpportunity") {
		const key = action === "markNotificationRead" ? "notifications" : "opportunities";
		const row = find(state, key, input.id);
		row[action === "markNotificationRead" ? "readAt" : "dismissedAt"] = now();
		return { value: undefined };
	}
	if (operation === "career.trackOpportunity") {
		const opportunity = find(state, "opportunities", input.id);
		return {
			value: {
				company: opportunity.company,
				role: opportunity.role,
				location: opportunity.location,
				sourceUrl: opportunity.url,
				jobDescription: opportunity.snippet,
				status: "saved",
			},
		};
	}
	if (operation === "career.forgetFact") {
		const fact = find(state, "facts", input.id);
		rows(state, "facts").splice(rows(state, "facts").indexOf(fact), 1);
		rows(state, "forgottenFacts").push({ count: 1, at: now() });
		return { value: undefined };
	}
	if (
		operation === "career.deleteStory" ||
		operation === "career.deleteSavedItem" ||
		operation === "career.deleteSchedule"
	) {
		const key = action === "deleteStory" ? "stories" : action === "deleteSchedule" ? "schedules" : "offers";
		const row = find(state, key, input.id);
		rows(state, key).splice(rows(state, key).indexOf(row), 1);
		return { value: undefined };
	}
	if (operation === "feedback.create") {
		const row = {
			...input,
			id: id(),
			resumeName: find(state, "resumes", input.resumeId).name,
			url: `https://rxresu.me/feedback/${id()}`,
			status: "active",
			createdAt: now(),
			revokedAt: null,
			lastViewedAt: null,
			commentCount: 0,
			openCommentCount: 0,
			comments: [],
			events: [],
		};
		rows(state, "feedbackLinks").push(row);
		return { value: row };
	}
	if (operation === "feedback.revoke") {
		const row = find(state, "feedbackLinks", input.id);
		row.status = "revoked";
		row.revokedAt = now();
		return { value: row };
	}
	if (operation === "feedback.resolveComment") {
		const row = find(state, "feedbackLinks", input.id);
		const comment = (row.comments as Row[]).find((comment) => comment.id === input.commentId);
		if (!comment) throw new Error("Fixture comment not found.");
		comment.resolvedAt = input.resolved ? now() : null;
		return { value: comment };
	}
	if (operation === "agent.threads.start") {
		const thread = {
			id: id(),
			title: input.scope === "career" ? "Coach" : "Tailor this to the Lumen posting",
			status: "active",
			scope: input.scope ?? "document",
			applicationId: input.applicationId ?? null,
			sourceResumeId: input.resumeId ?? null,
			workingResumeId: null,
			coverLetterId: input.coverLetterId ?? null,
			aiProviderId: input.aiProviderId ?? "work-openai",
			resumeName: "Product designer",
			coverLetterName: null,
			providerLabel: "Work OpenAI",
			editsProposed: 0,
			editsAccepted: 0,
			activeRunId: null,
			lastMessageAt: now(),
			archivedAt: null,
			deletedAt: null,
			createdAt: now(),
			updatedAt: now(),
		};
		rows(state, "conversations").push(thread);
		return { value: thread };
	}
	if (operation === "agent.threads.update") {
		const row = find(state, "conversations", input.id);
		Object.assign(row, input);
		return { value: row };
	}
	if (operation === "agent.threads.delete") {
		const all = rows(state, "conversations");
		all.splice(all.indexOf(find(state, "conversations", input.id)), 1);
		return { value: undefined };
	}
	if (operation === "agent.attachments.create") {
		const row: Row = {
			...input,
			id: id(),
			messageId: null,
			size: (String(input.data).length * 3) / 4,
			createdAt: now(),
		};
		delete row.data;
		rows(state, "attachments").push(row);
		return { value: row };
	}
	if (operation === "agent.attachments.delete") {
		const all = rows(state, "attachments");
		all.splice(all.indexOf(find(state, "attachments", input.id)), 1);
		return { value: undefined };
	}
	if (operation === "agent.messages.stop") return { value: undefined };
	if (operation === "agent.messages.setEditStatus") {
		const message = (state.conversationMessages as Record<string, Row[]>)[String(input.threadId)]?.find(
			(row) => row.id === input.messageId,
		);
		const part = (message?.parts as Row[] | undefined)?.find((row) => row.toolCallId === input.toolCallId);
		const proposals = ((part?.output as Row | undefined)?.edits ?? []) as Row[];
		const decisions = input.edits as Row[];
		for (const decision of decisions) {
			const proposal = proposals.find((proposal) => proposal.id === decision.id);
			if (!proposal || (decision.after !== undefined && decision.after !== proposal.after))
				throw new Error("Proposal changed. Review again.");
		}
		for (const decision of decisions) {
			const proposal = proposals.find((proposal) => proposal.id === decision.id);
			if (proposal) proposal.status = decision.status;
		}
		return {
			value: {
				editsProposed: proposals.length,
				editsAccepted: proposals.filter((proposal) => proposal.status === "accepted").length,
			},
		};
	}
	if (operation === "auth.exportData") return { value: structuredClone(state) };
	if (operation === "auth.updateProfile") {
		Object.assign(state.account as Row, input);
		return { value: state.account };
	}
	if (operation === "aiProviders.test") {
		const row = find(state, "aiProviders", input.id);
		Object.assign(row, { testStatus: "success", lastTestedAt: now(), testError: null, testErrorKind: null });
		return { value: row };
	}
	if (operation === "aiProviders.setDefault") {
		for (const row of rows(state, "aiProviders")) row.isDefault = row.id === input.id;
		return { value: undefined };
	}
	if (operation === "aiProviders.update") {
		const row = find(state, "aiProviders", input.id);
		Object.assign(row, input);
		return { value: row };
	}
	if (operation === "aiProviders.create") {
		const row = { ...input, id: id(), createdAt: now(), updatedAt: now() };
		rows(state, "aiProviders").push(row);
		return { value: row };
	}
	if (operation === "career.generate") {
		const task = input.task as Row;
		if (task.task === "answer")
			return { value: { item: null, answer: { text: task.answer || task.question, factIds: [], note: null } } };
		const data = fixtureArtifact(task);
		const item = {
			id: id(),
			userId: "alex",
			applicationId: input.applicationId ?? null,
			interviewId: task.interviewId ?? null,
			title: "headline" in data ? data.headline : "title" in data ? data.title : "",
			data,
			evidence: { factIds: [], storyIds: [] },
			jobId: null,
			inputVersion: "fixture",
			aiOperationId: null,
			aiUsage: null,
			createdAt: now(),
			updatedAt: now(),
		};
		rows(state, "offers").unshift(item);
		return { value: { item, answer: null } };
	}
	if (operation === "career.createOffer") {
		const item = {
			id: input.id ?? id(),
			userId: "alex",
			applicationId: input.applicationId ?? null,
			interviewId: null,
			title: input.title ?? "",
			data: { kind: "offer", ...input },
			evidence: { factIds: [], storyIds: [] },
			jobId: null,
			inputVersion: "fixture",
			aiOperationId: null,
			createdAt: now(),
			updatedAt: now(),
		};
		rows(state, "offers").push(item);
		return { value: item };
	}
	if (operation === "career.updateOffer") {
		const item = find(state, "offers", input.id);
		const data = item.data as Row;
		for (const [key, value] of Object.entries(input.expected as Row))
			if (JSON.stringify(data[key]) !== JSON.stringify(value)) throw new Error("Offer changed. Review again.");
		Object.assign(data, input.terms);
		return { value: item };
	}
	if (operation === "customDomain.set") {
		state.customDomain = {
			hostname: input.hostname,
			verified: false,
			target: "rxresu.me",
			txtName: "_rxresu",
			txtValue: "fixture",
			records: [],
			lastCheckedAt: null,
		};
		return { value: state.customDomain };
	}
	if (operation === "customDomain.verify") {
		if (state.customDomain) Object.assign(state.customDomain, { verified: true, lastCheckedAt: now() });
		return { value: state.customDomain };
	}
	if (operation === "customDomain.remove") {
		state.customDomain = null;
		return { value: undefined };
	}
	if (operation === "aiProviders.delete") {
		const all = rows(state, "aiProviders");
		all.splice(all.indexOf(find(state, "aiProviders", input.id)), 1);
		return { value: undefined };
	}
	if (operation === "auth.apiKeys.delete") {
		const keys = state.apiKeys as { apiKeys: Row[]; total: number };
		keys.apiKeys = keys.apiKeys.filter((key) => key.id !== input.keyId);
		keys.total = keys.apiKeys.length;
		return { value: { success: true } };
	}

	return;
}
