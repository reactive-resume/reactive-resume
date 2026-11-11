import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { resumeFactProposals } from "@reactive-resume/resume/markdown";
import { applicationTimelineEntrySchema } from "@reactive-resume/schema/applications/data";
import { applicationPipelineSchema } from "@reactive-resume/schema/applications/lanes";
import { EMPTY_WORKSPACE, careerFactCorrectionSchema } from "@reactive-resume/schema/career";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { visitorShape } from "./board-fixtures";
import { now } from "./clock";
import { fixtureArtifact } from "./fixture-artifacts";

type Row = Record<string, unknown>;
export type FixtureState = Record<string, unknown>;
let sequence = 0;
const passwords = new Map<string, string>();
const unlocked = new Set<string>();
export function fixturePublicAccess(id: string) {
	return !passwords.has(id) || unlocked.has(id);
}
export function fixtureUnlock(id: string, password: string) {
	const accepted = passwords.get(id) === password;
	if (accepted) unlocked.add(id);
	return accepted;
}
const id = () => `fixture-${++sequence}`;
const rows = (state: FixtureState, key: string) => (state[key] ??= []) as Row[];
const find = (state: FixtureState, key: string, value: unknown) => {
	const row = rows(state, key).find((row) => row.id === value);
	if (!row) throw new Error(`Fixture ${key} not found.`);
	return row;
};
export function extendedSeed(empty: boolean) {
	sequence = 0;
	passwords.clear();
	unlocked.clear();
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
		webAccess: {
			revision: "fixture-web",
			builtInReader: true,
			configured: false,
			testResult: null,
			lastTestedAt: null,
			provider: null,
			managed: false,
			canSave: true,
			search: false,
			searxng: false,
			read: true,
		},
		forgottenFacts: [] as Row[],
		transcripts: [] as Row[],
		apiKeys: { apiKeys: [], total: 0 },
		connectedApps: { connections: [] },
	};
}
export function fixtureRead(resource: string, input: Row, state: FixtureState): { value: unknown } | undefined {
	if (resource === "workspace")
		return {
			value:
				(state.workspaces as Record<string, unknown>)[String(input.applicationId)] ?? structuredClone(EMPTY_WORKSPACE),
		};
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
			value: Array.from({ length: Math.min(Number(input.days ?? 30), 24) }, (_, index) => ({
				date: new Date(now().getTime() - (Math.min(Number(input.days ?? 30), 24) - index - 1) * 86400000)
					.toISOString()
					.slice(0, 10),
				views: (visitorShape[index] ?? 0) * 2,
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
	if (resource === "library" || resource === "offers")
		return {
			value: rows(state, "offers").filter(
				(row) =>
					(!input.applicationId || row.applicationId === input.applicationId) &&
					(!input.kind || (row.data as Row).kind === input.kind) &&
					(input.scope !== "shared" || row.applicationId === null),
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
				bySource: [...new Set(applications.map((row) => row.source))]
					.filter(Boolean)
					.map((source) => ({ source, count: applications.filter((row) => row.source === source).length })),
			},
		};
	}
	return;
}
/** Only fixture dispatch is untyped; public hooks use the router's exact input/output contracts. */
export function fixtureWrite(operation: string, input: Row, state: FixtureState): { value: unknown } | undefined {
	const [area, action] = operation.split(".");
	if (operation.startsWith("applications.lanes.")) {
		const pipeline = applicationPipelineSchema.parse(state.lanes);
		if (pipeline.revision !== input.expectedRevision)
			throw Object.assign(new Error("Lanes changed."), { code: "CONFLICT" });
		const command = operation.split(".")[2];
		const target = pipeline.lanes.find((row) => row.id === input.id && !row.retiredAt);
		if (command === "create") {
			if (pipeline.lanes.filter((row) => !row.retiredAt).length >= 40) throw new Error("Too many lanes.");
			pipeline.lanes.push({
				id: id(),
				category: input.category as (typeof pipeline.lanes)[number]["category"],
				label: String(input.label),
				color: String(input.color),
				position: pipeline.lanes.length,
				systemKey: null,
				closedReason: (input.closedReason as null) ?? null,
				retiredAt: null,
			});
		} else if (command === "reorder") {
			const ids = input.ids as string[];
			const active = pipeline.lanes.filter((row) => !row.retiredAt);
			if (
				new Set(ids).size !== active.length ||
				ids.length !== active.length ||
				active.some((row) => !ids.includes(row.id))
			)
				throw new Error("Include every active lane once.");
			for (const lane of active) lane.position = ids.indexOf(lane.id);
		} else {
			if (!target) throw new Error("Lane unavailable.");
			if (command === "update") {
				if (input.label !== undefined) target.label = String(input.label);
				if (input.color !== undefined) target.color = String(input.color);
			} else if (command === "retire") {
				const replacement = pipeline.lanes.find((row) => row.id === input.replacementId && !row.retiredAt);
				if (
					target.systemKey ||
					!replacement ||
					replacement.id === target.id ||
					replacement.category !== target.category ||
					replacement.closedReason !== target.closedReason
				)
					throw new Error("Choose a matching replacement lane.");
				target.retiredAt = now();
				for (const app of rows(state, "applications")) if (app.laneId === target.id) app.laneId = replacement.id;
			}
		}
		pipeline.revision++;
		state.lanes = applicationPipelineSchema.parse(pipeline);
		return { value: state.lanes };
	}
	if (operation === "career.correctFact") {
		const correction = careerFactCorrectionSchema.parse(input);
		const row = find(state, "facts", correction.id);
		if (Object.entries(correction.before).some(([key, value]) => row[key] !== value))
			throw Object.assign(new Error("Fact changed. Review again."), { code: "CONFLICT" });
		if (
			correction.applicationId &&
			!rows(state, "applications").some((app) => app.id === correction.applicationId && !app.trashedAt)
		)
			throw new Error("Application unavailable.");
		(row.revisions as Row[]).push({
			text: row.text,
			category: row.category,
			applicationId: row.applicationId,
			at: now().toISOString(),
		});
		const { before: _before, ...changes } = correction;
		Object.assign(row, changes, { updatedAt: now() });
		return { value: undefined };
	}
	if (operation === "ai.improve")
		return {
			value: {
				text: "Built and scaled a design system adopted by six product teams; cut interface defects by a third.",
				why: "",
				addsFacts: false,
				aiOperationIds: [],
			},
		};
	if (operation === "career.proposeResumeFacts") {
		const resume = find(state, "resumes", input.resumeId);
		return {
			value: {
				id: resume.id,
				name: resume.name,
				updatedAt: resume.updatedAt,
				...resumeFactProposals(resume.data as typeof defaultResumeData),
			},
		};
	}
	if (operation === "career.saveResumeFacts") {
		const resume = find(state, "resumes", input.resumeId);
		if (new Date(input.updatedAt as Date | string).getTime() !== new Date(resume.updatedAt as Date).getTime())
			throw Object.assign(new Error("Resume changed."), { code: "CONFLICT" });
		const quotes = new Set(
			resumeFactProposals(resume.data as typeof defaultResumeData).proposals.map((row) => row.quote),
		);
		if ((input.proposals as Row[]).some((row) => !quotes.has(String(row.quote))))
			throw new Error("Source quotation changed.");
		let saved = 0;
		let skipped = 0;
		for (const proposal of input.proposals as Row[]) {
			if (rows(state, "facts").some((row) => row.text === proposal.text)) {
				skipped++;
				continue;
			}
			rows(state, "facts").push({
				...structuredClone(rows(state, "facts")[0]),
				...proposal,
				id: id(),
				applicationId: null,
				revisions: [],
				source: { kind: "resume", id: resume.id, quote: proposal.quote },
				createdAt: now(),
				updatedAt: now(),
			});
			saved++;
		}
		return { value: { saved, skipped } };
	}
	if (operation === "career.suggestTargetRoles")
		return {
			value: {
				suggestions: [
					{ role: "Senior product designer", facts: [], resumeQuote: "Senior product designer" },
					{ role: "Design lead", facts: [], resumeQuote: null },
				],
			},
		};

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
		unlocked.delete(String(row.id));
		if (action === "setPassword") passwords.set(String(row.id), String(input.password));
		else passwords.delete(String(row.id));
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
	if (operation === "applications.import") {
		const items = input.items as Row[];
		for (const item of items)
			rows(state, "applications").push({
				...structuredClone(rows(state, "applications")[0] ?? {}),
				...item,
				id: id(),
				status: item.status ?? "saved",
				activity: [],
				tags: item.tags ?? [],
				trashedAt: null,
				createdAt: now(),
				updatedAt: now(),
			});
		return { value: { imported: items.length } };
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
		if (action === "updateInterview") {
			const entry = activity.find((row) => row.id === input.entryId && row.type === "interview");
			if (!entry) throw new Error("Interview not found.");
			Object.assign(entry, applicationTimelineEntrySchema.parse({ ...entry, ...input, id: entry.id }));
		} else if (action === "logFollowUp") {
			if (application.status === "saved" || application.status === "closed")
				throw new Error("Follow-ups require an open, sent application.");
			activity.push(
				applicationTimelineEntrySchema.parse({
					id: id(),
					type: "note",
					at: now().toISOString(),
					text: "Followed up",
					followedUp: { stageEntryId: activity.findLast((row) => row.type === "stage")?.id ?? null },
				}),
			);
		} else activity.push(applicationTimelineEntrySchema.parse({ ...input, id: id(), type: "interview" }));
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
				// Pasted text this short is only part of a posting (J5's clipped-description warning).
				postingSource:
					!String(input.input).startsWith("https:") && String(input.input).length < 200
						? { method: "paste", format: "text", truncated: false, completeness: "incomplete" }
						: null,
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
		Object.assign(row, {
			testStatus: row.provider === "ollama" ? "failure" : "success",
			lastTestedAt: now(),
			testError: row.provider === "ollama" ? "fetch failed" : null,
			testErrorKind: row.provider === "ollama" ? "network" : null,
		});
		return { value: row };
	}
	if (operation === "aiProviders.setDefault") {
		for (const row of rows(state, "aiProviders")) row.isDefault = row.id === input.id;
		return { value: find(state, "aiProviders", input.id) };
	}
	if (operation === "aiProviders.update" || operation === "aiProviders.create") {
		const safe = { ...input };
		delete safe.apiKey;
		const row =
			operation === "aiProviders.update"
				? find(state, "aiProviders", input.id)
				: {
						id: id(),
						managed: false,
						fastModel: null,
						capableModel: null,
						baseURL: null,
						enabled: true,
						isDefault: rows(state, "aiProviders").length === 0,
						testStatus: "untested",
						testError: null,
						testErrorKind: null,
						apiKeyPreview: "••••fixture",
						apiKeyFingerprint: `fixture-key-${sequence}`,
						recipientVersion: "0".repeat(64),
						lastTestedAt: null,
						lastUsedAt: null,
						createdAt: now(),
						updatedAt: now(),
					};
		if (operation === "aiProviders.create") rows(state, "aiProviders").push(row);
		else if (["provider", "model", "baseURL", "apiKey"].some((key) => key in input)) {
			for (const schedule of rows(state, "schedules")) if (schedule.aiProviderId === row.id) schedule.enabled = false;
			row.apiKeyFingerprint = `fixture-key-${++sequence}`;
			row.recipientVersion = String(sequence % 10).repeat(64);
			row.testStatus = "untested";
		}
		Object.assign(row, safe);
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
	if (operation === "career.applyReply" || operation === "career.undoReply") {
		const item = find(state, "offers", input.id);
		const data = item.data as Row;
		if (data.kind !== "reply" || !item.applicationId) throw new Error("Choose a message linked to an application.");
		const application = find(state, "applications", item.applicationId);
		const keys = ["status", "laneId", "closedReason", "followUpAt", "followUpNote"];
		if (operation === "career.undoReply") {
			const receipt = data.applied as { undo?: { before: Row; after: Row } } | null;
			if (!receipt?.undo) throw new Error("No changes to undo.");
			if (keys.some((key) => application[key] !== receipt.undo?.after[key]))
				throw new Error("Application changed. Review again.");
			Object.assign(application, receipt.undo.before);
			data.applied = null;
			return { value: { stages: [] } };
		}
		if (data.applied) return { value: { stages: [] } };
		// shortcut: composite fixture submissions and offer changes need the separate Applied/offer flows; extend when those inline storyboards are added.
		if (input.submission) throw new Error("Fixture inline submission is not implemented. Use the Applied gate.");
		const before = Object.fromEntries(keys.map((key) => [key, application[key]]));
		const changes = data.changes as Row[];
		for (const index of input.changes as number[])
			if (!changes[index] || changes[index]?.type === "offer")
				throw new Error("Fixture offer changes are not implemented. Save offer terms explicitly.");
		for (const index of input.changes as number[]) {
			const change = changes[index];
			if (!change) continue;
			if (change.type === "stage") application.status = change.stage;
			if (change.type === "follow-up") {
				application.followUpAt = change.at;
				application.followUpNote = change.note;
			}
		}
		const after = Object.fromEntries(keys.map((key) => [key, application[key]]));
		data.applied = { at: now().toISOString(), changes: input.changes, undo: { before, after, offerId: null } };
		return { value: { stages: [] } };
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
	if (operation === "auth.createApiKey") {
		const keys = state.apiKeys as { apiKeys: Row[]; total: number };
		keys.apiKeys.push({
			id: id(),
			name: input.name,
			start: "storyboard",
			prefix: null,
			enabled: true,
			createdAt: now(),
			updatedAt: now(),
			expiresAt: null,
			lastRequest: null,
			permissions: { api: input.access === "read" ? ["read"] : ["read", "write", "delete"] },
		});
		keys.total = keys.apiKeys.length;
		return { value: { key: "storyboard-only-key" } };
	}
	if (operation === "auth.apiKeys.delete") {
		const keys = state.apiKeys as { apiKeys: Row[]; total: number };
		keys.apiKeys = keys.apiKeys.filter((key) => key.id !== input.keyId);
		keys.total = keys.apiKeys.length;
		return { value: { success: true } };
	}

	return;
}
