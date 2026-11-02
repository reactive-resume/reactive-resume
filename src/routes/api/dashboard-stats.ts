/**
 * REST endpoint for the main Polymath app to fetch resume-specific dashboard stats.
 *
 * Authenticated via the shared INTERNAL_API_SECRET header.
 *
 * GET /api/dashboard-stats?tenantId=...&scope=po&sectionIds=id1,id2&activeUnitId=...&email=...
 */

import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";
import {
	getAllOrgUnits,
	getDescendantOrgUnitIds,
	getEngLabsLearnerProfilesByEmails,
	getEngLabsUserByEmail,
	getInstructorPackages,
	getInstructorSections,
	getOfficerOrgUnitIds,
	getOfficerSections,
	getPlacementPackages,
	getSectionsByIds,
	getStudentsBySections,
	getTenantIdForOrgUnits,
	getUnitSchemaTypes,
} from "@/integrations/eng-labs";
import type { EngLabsLearnerProfile } from "@/integrations/eng-labs/types";
import { getSubmissionDatesByResumeIds } from "@/integrations/orpc/router/dashboard";
import { env } from "@/utils/env";

// ── Helper functions (same as dashboard.ts oRPC procedure) ──

async function getResumesForUsers(userIds: string[]) {
	if (userIds.length === 0) return [];
	return db
		.select()
		.from(schema.resume)
		.where(and(inArray(schema.resume.userId, userIds), eq(schema.resume.isPrimary, true)));
}

async function getCommentCountsByResumeIds(resumeIds: string[]) {
	if (resumeIds.length === 0) return new Map<string, number>();
	const comments = await db
		.select({ resumeId: schema.resumeComment.resumeId })
		.from(schema.resumeComment)
		.where(inArray(schema.resumeComment.resumeId, resumeIds));
	const counts = new Map<string, number>();
	for (const c of comments) {
		counts.set(c.resumeId, (counts.get(c.resumeId) ?? 0) + 1);
	}
	return counts;
}

async function getLatestEvaluationsByResumeIds(resumeIds: string[]) {
	if (resumeIds.length === 0) return new Map<string, number | null>();
	const evaluations = await db
		.select({
			resumeId: schema.resumeEvaluation.resumeId,
			overallScore: schema.resumeEvaluation.overallScore,
			evaluatedAt: schema.resumeEvaluation.evaluatedAt,
		})
		.from(schema.resumeEvaluation)
		.where(inArray(schema.resumeEvaluation.resumeId, resumeIds))
		.orderBy(desc(schema.resumeEvaluation.evaluatedAt));
	const latest = new Map<string, number | null>();
	for (const e of evaluations) {
		if (!latest.has(e.resumeId)) latest.set(e.resumeId, e.overallScore);
	}
	return latest;
}

// ── Main handler ──

async function handler({ request }: { request: Request }) {
	// Auth: require internal API secret
	const secret = request.headers.get("x-internal-secret");
	if (!env.INTERNAL_API_SECRET || secret !== env.INTERNAL_API_SECRET) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const tenantIdFromQuery = url.searchParams.get("tenantId");
	const scope = url.searchParams.get("scope") || "po";
	const sectionIdsParam = url.searchParams.get("sectionIds") || "";
	const activeUnitId = url.searchParams.get("activeUnitId") || undefined;
	const email = url.searchParams.get("email") || undefined;

	if (!tenantIdFromQuery) {
		return Response.json({ error: "tenantId is required" }, { status: 400 });
	}

	try {
		let tenantId = tenantIdFromQuery;
		const sectionIds = sectionIdsParam ? sectionIdsParam.split(",").filter(Boolean) : [];
		const engLabsUser = email ? await getEngLabsUserByEmail(email) : null;
		if ((!tenantId || tenantId === "default") && engLabsUser?.tenantId) {
			tenantId = engLabsUser.tenantId;
		}

		let sectionRows: any[] = [];
		if (scope === "faculty" && engLabsUser?.id) {
			sectionRows = await getInstructorSections(engLabsUser.id);
		}
		if (sectionRows.length === 0 && sectionIds.length > 0) {
			sectionRows = await getSectionsByIds(sectionIds);
		}
		if (sectionRows.length > 0) {
			const ouTenant = await getTenantIdForOrgUnits(sectionRows.map((s: any) => s.id));
			if (ouTenant && (!tenantId || tenantId === "default")) {
				tenantId = ouTenant;
			}
		}

		// 1. Resolve packages + organisation
		let filterPackages: any[] = [];
		let resolvedOrganisationId: string | null = null;

		if (scope === "faculty" && engLabsUser?.id) {
			filterPackages = await getInstructorPackages(engLabsUser.id);
		}
		if (filterPackages.length === 0 && tenantId !== "default") {
			const pool = await import("@/integrations/eng-labs/client").then((m) => m.getEngLabsPool());
			if (pool) {
				const { rows } = await pool.query<{ organisation_id: string }>(
					`SELECT organisation_id FROM placement_packages WHERE tenant_id = $1 LIMIT 1`,
					[tenantId],
				);
				if (rows[0]) {
					resolvedOrganisationId = rows[0].organisation_id;
					filterPackages = await getPlacementPackages(tenantId, resolvedOrganisationId);
				}
				if (!resolvedOrganisationId) {
					const { rows: ouRows } = await pool.query<{ organisation_id: string }>(
						`SELECT organisation_id FROM organisation_units WHERE tenant_id = $1 LIMIT 1`,
						[tenantId],
					);
					if (ouRows[0]) resolvedOrganisationId = ouRows[0].organisation_id;
				}
			}
		} else if (filterPackages.length > 0) {
			resolvedOrganisationId = filterPackages[0].organisationId;
		}

		// 2. Org units + unit types
		const [unitTypes, allOrgUnits] = await Promise.all([
			resolvedOrganisationId && tenantId !== "default"
				? getUnitSchemaTypes(tenantId, resolvedOrganisationId)
				: Promise.resolve([]),
			resolvedOrganisationId && tenantId !== "default"
				? getAllOrgUnits(tenantId, resolvedOrganisationId)
				: Promise.resolve([]),
		]);

		if (sectionRows.length === 0 && tenantId !== "default") {
			// Officers are tenant-wide; see getOfficerSections for why this must not be derived
			// from placement_instructor_unit_assignments.
			sectionRows = scope === "po" ? await getOfficerSections(tenantId) : [];
		}

		// Scope for faculty
		let scopedOrgUnits = allOrgUnits;
		if (scope === "faculty" && sectionRows.length > 0) {
			const relevantIds = new Set(sectionRows.map((s: any) => s.id));
			scopedOrgUnits = allOrgUnits.filter((u: any) => relevantIds.has(u.id));
		}

		const normEmail = (e: string) => e.trim().toLowerCase();

		let activeDescendantSet: Set<string> | null = null;
		if (activeUnitId) {
			if (tenantId !== "default") {
				activeDescendantSet = new Set(await getDescendantOrgUnitIds([activeUnitId], tenantId));
			} else {
				const childIds = new Set<string>();
				const queue = [activeUnitId];
				while (queue.length > 0) {
					const current = queue.shift()!;
					childIds.add(current);
					for (const u of scopedOrgUnits as any[]) {
						if (u.parentId === current) queue.push(u.id);
					}
				}
				activeDescendantSet = childIds;
			}
		}

		let placementBoundarySet: Set<string> | null = null;
		if (scope === "po" && tenantId !== "default") {
			// Must match the tenant-wide section resolution above, or the boundary check below
			// filters out the students those sections just admitted.
			const pIds = await getOfficerOrgUnitIds(tenantId);
			placementBoundarySet = pIds.length > 0 ? new Set(pIds) : null;
		}

		let instructorSubtreeSet: Set<string> | null = null;
		if (scope === "faculty") {
			if (sectionRows.length === 0) {
				instructorSubtreeSet = new Set();
			} else if (tenantId !== "default") {
				instructorSubtreeSet = new Set(
					await getDescendantOrgUnitIds(
						sectionRows.map((s: any) => s.id),
						tenantId,
					),
				);
			} else {
				instructorSubtreeSet = new Set(sectionRows.map((s: any) => s.id));
			}
		}

		function profilePassesFilters(p: EngLabsLearnerProfile): boolean {
			if (placementBoundarySet && !p.unitIds.some((id) => placementBoundarySet.has(id))) return false;
			if (instructorSubtreeSet !== null && !p.unitIds.some((id) => instructorSubtreeSet.has(id))) return false;
			if (activeDescendantSet && !p.unitIds.some((id) => activeDescendantSet.has(id))) return false;
			return true;
		}

		let resumeUsers: (typeof schema.user.$inferSelect)[] = [];
		if (tenantId !== "default") {
			const resumeUsersByTenant = await db.select().from(schema.user).where(eq(schema.user.tenantId, tenantId));

			const tenantEmailSet = new Set(resumeUsersByTenant.map((u) => normEmail(u.email)));
			let extraEmails: string[] = [];
			if (sectionRows.length > 0) {
				const inSections = await getStudentsBySections(
					sectionRows.map((s: { id: string }) => s.id),
					tenantId,
				);
				extraEmails = [
					...new Set(inSections.map((s) => normEmail(s.email)).filter((e) => e.length > 0 && !tenantEmailSet.has(e))),
				];
			}

			const resumeUsersExtra =
				extraEmails.length > 0
					? await db
							.select()
							.from(schema.user)
							.where(inArray(sql<string>`lower(trim(${schema.user.email}))`, extraEmails))
					: [];

			const byId = new Map<string, typeof schema.user.$inferSelect>();
			for (const u of resumeUsersByTenant) byId.set(u.id, u);
			for (const u of resumeUsersExtra) {
				if (!byId.has(u.id)) byId.set(u.id, u);
			}
			resumeUsers = [...byId.values()];
		}

		const profiles = await getEngLabsLearnerProfilesByEmails(
			resumeUsers.map((u) => normEmail(u.email)),
			tenantId,
		);
		const profileByEmail = new Map<string, EngLabsLearnerProfile>(profiles.map((p) => [normEmail(p.email), p]));

		const emailToLocalUser = new Map<string, (typeof resumeUsers)[number]>();
		const engLabsStudents: Array<{
			id: string;
			name: string;
			email: string;
			rollNumber: string | null;
			sectionId: string;
			sectionName?: string;
		}> = [];

		for (const ru of resumeUsers) {
			const p = profileByEmail.get(normEmail(ru.email));
			if (!p || !profilePassesFilters(p)) continue;
			emailToLocalUser.set(normEmail(ru.email), ru);
			const primarySection = p.enrollmentUnitId ?? p.unitIds[0] ?? "";
			engLabsStudents.push({
				id: p.id,
				name: p.name,
				email: p.email,
				rollNumber: p.rollNumber,
				sectionId: primarySection,
			});
		}

		const localUserIds = engLabsStudents.flatMap((s) => {
			const u = emailToLocalUser.get(normEmail(s.email));
			return u ? [u.id] : [];
		});

		const resumes = await getResumesForUsers(localUserIds);
		const resumeIds = resumes.map((r) => r.id);

		// 6. Get resume feedback data
		const [commentCounts, latestScores, submissionDates] = await Promise.all([
			getCommentCountsByResumeIds(resumeIds),
			getLatestEvaluationsByResumeIds(resumeIds),
			getSubmissionDatesByResumeIds(resumeIds),
		]);

		// 7. Build per-student resume data
		const resumesByUserId = new Map<string, typeof resumes>();
		for (const r of resumes) {
			const existing = resumesByUserId.get(r.userId) ?? [];
			existing.push(r);
			resumesByUserId.set(r.userId, existing);
		}

		const students = engLabsStudents.map((student) => {
			const localUser = emailToLocalUser.get(normEmail(student.email));
			const p = profileByEmail.get(normEmail(student.email));
			const userResumes = localUser ? (resumesByUserId.get(localUser.id) ?? []) : [];
			const engLabsUnitIds = p?.unitIds?.length ? p.unitIds : student.sectionId ? [student.sectionId] : [];
			return {
				engLabsId: student.id,
				name: student.name,
				email: student.email,
				rollNumber: student.rollNumber,
				sectionId: student.sectionId,
				sectionName: student.sectionName ?? null,
				engLabsUnitIds,
				resumeAppUserId: localUser?.id ?? null,
				resumes: userResumes.map((r) => {
					const score = latestScores.get(r.id) ?? null;
					const comments = commentCounts.get(r.id) ?? 0;
					const isSubmitted = submissionDates.has(r.id);
					let status: string = "not_reviewed";
					if (score !== null) status = "evaluated";
					else if (isSubmitted) status = "submitted";
					else if (comments > 0) status = "has_comments";
					return {
						id: r.id,
						name: r.name,
						updatedAt: r.updatedAt,
						evaluationScore: score,
						commentCount: comments,
						isSubmitted,
						status,
						reviewStatus: (r as any).reviewStatus ?? "DRAFT",
						locked: (r as any).locked ?? false,
					};
				}),
			};
		});

		// 8. Section-level stats with resume status breakdown
		const sectionStats = scopedOrgUnits.map((unit: any) => {
			const descendantSectionIds = new Set<string>();
			const queue = [unit.id];
			const processed = new Set<string>();
			while (queue.length > 0) {
				const currentId = queue.shift()!;
				if (processed.has(currentId)) continue;
				processed.add(currentId);
				if (sectionRows.some((s: any) => s.id === currentId)) descendantSectionIds.add(currentId);
				for (const u of allOrgUnits as any[]) {
					if (u.parentId === currentId) queue.push(u.id);
				}
			}
			const unitStudents = students.filter((s) => {
				const ids = s.engLabsUnitIds.length > 0 ? s.engLabsUnitIds : [s.sectionId];
				return ids.some((id) => descendantSectionIds.has(id));
			});
			const unitResumes = unitStudents.flatMap((s) => s.resumes);

			const byStatus = (statuses: string[]) => unitResumes.filter((r) => statuses.includes(r.reviewStatus)).length;
			const scores = unitResumes.filter((r) => r.evaluationScore !== null).map((r) => r.evaluationScore!);

			return {
				id: unit.id,
				name: unit.name,
				unitType: unit.type,
				stats: {
					totalStudents: unitStudents.length,
					totalResumes: unitResumes.length,
					evaluatedResumes: byStatus([
						"FACULTY_VERIFIED",
						"FINALIZED_BY_FACULTY",
						"PO_REVISION_REQUESTED",
						"RESUBMITTED_TO_PO",
						"PO_VERIFIED",
						"APPROVED",
					]),
					submittedResumes: byStatus(["FINALIZED_BY_FACULTY", "RESUBMITTED_TO_PO", "APPROVED"]),
					passedFaculty: byStatus([
						"FINALIZED_BY_FACULTY",
						"PO_REVISION_REQUESTED",
						"RESUBMITTED_TO_PO",
						"PO_VERIFIED",
						"APPROVED",
					]),
					poVerifiedResumes: byStatus(["PO_VERIFIED"]),
					approvedResumes: byStatus(["APPROVED"]),
					completionRate:
						unitResumes.length > 0
							? Math.round(
									(byStatus([
										"FACULTY_VERIFIED",
										"FINALIZED_BY_FACULTY",
										"PO_REVISION_REQUESTED",
										"RESUBMITTED_TO_PO",
										"PO_VERIFIED",
										"APPROVED",
									]) /
										unitResumes.length) *
										100,
								)
							: 0,
					averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
				},
			};
		});

		// 9. Aggregate stats
		const allResumes = students.flatMap((s) => s.resumes);
		const allEvaluated = allResumes.filter((r) => r.evaluationScore !== null);
		const allScores = allEvaluated.map((r) => r.evaluationScore!);
		const totalComments = allResumes.reduce((sum, r) => sum + r.commentCount, 0);

		// 10. Recent activity
		const recentEvaluations =
			resumeIds.length > 0
				? await db
						.select()
						.from(schema.resumeEvaluation)
						.where(inArray(schema.resumeEvaluation.resumeId, resumeIds))
						.orderBy(desc(schema.resumeEvaluation.createdAt))
						.limit(5)
				: [];

		const recentComments =
			resumeIds.length > 0
				? await db
						.select()
						.from(schema.resumeComment)
						.where(inArray(schema.resumeComment.resumeId, resumeIds))
						.orderBy(desc(schema.resumeComment.createdAt))
						.limit(5)
				: [];

		const resumeIdToEmail = new Map<string, string>();
		for (const student of students) {
			for (const r of student.resumes) {
				resumeIdToEmail.set(r.id, student.email);
			}
		}

		// ── Derived stats matching the TPO overview UI exactly ──

		// Card 1-2: cohort = eng-labs learners in scope ∩ Polymath `user` (resume builder enrolled)
		const totalStudents = students.length;
		const enrolledInResumeBuilder = totalStudents;
		const totalResumes = allResumes.length;
		const withPrimaryResume = students.filter((s) => s.resumes.length > 0).length;
		const primaryResumeRate =
			enrolledInResumeBuilder > 0 ? Math.round((withPrimaryResume / enrolledInResumeBuilder) * 1000) / 10 : 0;

		// Submission Breakdown (left column of charts)
		const withResumes = withPrimaryResume;
		const noResumes = totalStudents - withResumes;
		const pendingReview = students.filter((s) =>
			s.resumes.some((r) => r.isSubmitted && r.evaluationScore === null),
		).length;
		const evaluated = students.filter((s) => s.resumes.some((r) => r.evaluationScore !== null)).length;

		// Card 3: Submission Rate = students with resumes / total students
		const submissionRate = totalStudents > 0 ? Math.round((withResumes / totalStudents) * 1000) / 10 : 0;

		// Card 4: Evaluation Rate = evaluated / students with resumes
		const evaluationRate = withResumes > 0 ? Math.round((evaluated / withResumes) * 1000) / 10 : 0;

		// Card 5: Avg Score (out of 5)
		const averageScore =
			allScores.length > 0 ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10 : null;

		// Card 6: ATS Checks (total across all students)
		let totalAtsChecks = 0;
		try {
			const [atsResult] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.atsScoreHistory);
			totalAtsChecks = atsResult?.count ?? 0;
		} catch {
			/* ats_score_history table may not exist */
		}

		// Score Distribution (right column chart) — buckets of 0-1, 1-2, 2-3, 3-4, 4-5
		const scoreDistribution = [
			{ bucket: "0-1", min: 0, max: 1, count: 0 },
			{ bucket: "1-2", min: 1, max: 2, count: 0 },
			{ bucket: "2-3", min: 2, max: 3, count: 0 },
			{ bucket: "3-4", min: 3, max: 4, count: 0 },
			{ bucket: "4-5", min: 4, max: 5, count: 0 },
		];
		for (const score of allScores) {
			for (const b of scoreDistribution) {
				if (score >= b.min && score < b.max) {
					b.count++;
					break;
				}
				if (b.max === 5 && score === 5) {
					b.count++;
					break;
				}
			}
		}

		return Response.json({
			// ── Pre-computed overview stats (matches TPO dashboard cards exactly) ──
			overviewStats: {
				// Row 1: 6 stat cards
				totalStudents,
				enrolledInResumeBuilder,
				withPrimaryResume,
				primaryResumeRate,
				totalResumes,
				submissionRate, // % — "0.2%" in the UI
				evaluationRate, // % — "100.0%" in the UI
				averageScore, // out of 5 — "3.0/5" in the UI
				totalAtsChecks, // integer — "4" in the UI

				// Submission Breakdown (left column)
				withResumes, // students who have at least 1 resume
				noResumes, // students with no resume
				pendingReview, // submitted but not yet evaluated
				evaluated, // has evaluation score

				// Donut Chart (center column)
				donutChart: {
					submitted: withResumes,
					notSubmitted: noResumes,
					total: totalStudents,
				},

				// Score Distribution bar chart (right column)
				scoreDistribution,
			},

			// ── Full data for drill-down ──
			sections: sectionStats,
			students,
			aggregateStats: {
				totalStudents,
				enrolledInResumeBuilder,
				withPrimaryResume,
				primaryResumeRate,
				totalResumes,
				totalEvaluations: allEvaluated.length,
				totalSubmitted: allResumes.filter((r) => r.isSubmitted).length,
				totalComments,
				completionRate: totalResumes > 0 ? Math.round((allEvaluated.length / totalResumes) * 100) : 0,
				averageScore,
			},
			recentActivity: {
				recentEvaluations: recentEvaluations.map((e) => {
					const email = resumeIdToEmail.get(e.resumeId);
					const student = email ? engLabsStudents.find((s) => s.email === email) : null;
					return {
						id: e.id,
						resumeId: e.resumeId,
						overallScore: e.overallScore,
						evaluatedAt: e.evaluatedAt,
						studentName: student?.name ?? null,
					};
				}),
				recentComments: recentComments.map((c) => {
					const email = resumeIdToEmail.get(c.resumeId);
					const student = email ? engLabsStudents.find((s) => s.email === email) : null;
					return {
						id: c.id,
						resumeId: c.resumeId,
						content: c.content,
						createdAt: c.createdAt,
						studentName: student?.name ?? null,
					};
				}),
			},
			packages: filterPackages,
			unitTypes:
				scope === "faculty" && sectionRows.length > 0
					? [...new Set(scopedOrgUnits.map((u: any) => u.type))].sort()
					: unitTypes,
			allOrgUnits: scopedOrgUnits,
		});
	} catch (error) {
		console.error("[dashboard-stats] Error:", error);
		return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
	}
}

export const Route = createFileRoute("/api/dashboard-stats")({
	server: {
		handlers: {
			GET: handler,
		},
	},
});
