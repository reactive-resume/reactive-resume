/**
 * Dashboard oRPC Endpoints
 *
 * Provides:
 * - Student feedback dashboard (with comments per resume)
 * - Faculty/PO section-scoped dashboard (with package grouping)
 * - Student detail endpoint (for faculty's detail panel)
 * - Submit resume for review (student action)
 */

import { ORPCError } from "@orpc/client";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/integrations/drizzle";
import { db } from "@/integrations/drizzle/client";
import {
	filterEmailsWithResumeBuilderAccess,
	getAllOrgUnits,
	getDescendantOrgUnitIds,
	getEngLabsLearnerProfilesByEmails,
	getEngLabsUserByEmail,
	getInstructorPackages,
	getInstructorSections,
	getMenteeStudents,
	getOfficerOrgUnitIds,
	getOfficerSections,
	getPlacementPackages,
	getPlacementScopedSections,
	getSectionPackageIds,
	getSectionsByIds,
	getStudentEnrollmentInfo,
	getStudentsBySections,
	getTenantIdForOrgUnits,
	getUnitSchemaTypes,
} from "@/integrations/eng-labs";
import type { EngLabsLearnerProfile, OrgUnitRow, PlacementPackage, Section } from "@/integrations/eng-labs/types";
import { REVIEW_VERDICTS, reviewSummaryEmail } from "@/schema/resume/comment-anchor";
import { derror, dlog } from "@/utils/debug";
import { env } from "@/utils/env";
import { ActorType, canChangeReviewStatus, PO_STAGE_BLOCKED_MESSAGE } from "@/utils/roles";
import { protectedProcedure } from "../context";
import { assertReviewStaff, forbidden, requireReviewer } from "../helpers/review-access";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the tenantId server-side from the authenticated user's eng-labs identity.
 * The client-supplied `input.tenantId` (sourced from localStorage `sso_context`) drifts and is
 * not trustworthy for tenant scoping or persistence. Always prefer the eng-labs user's tenant;
 * fall back to the client value only when the user has no eng-labs row at all (legacy accounts).
 */
/**
 * Map an eng-labs user type onto the actor recorded against a review action.
 *
 * Eng-labs has more user types than the review workflow cares about; anything with authority over a
 * whole tenant acts as a Placement Officer, and every other staff member acts as faculty. Defaulting
 * to INSTRUCTOR is the safe direction: an unrecognised type gets the narrower permissions.
 */
function toActorType(engLabsUserType: string): ActorType {
	if (engLabsUserType === "PLACEMENT_OFFICER") return ActorType.PLACEMENT_OFFICER;
	if (engLabsUserType === "ADMIN" || engLabsUserType === "PLATFORM_ADMIN" || engLabsUserType === "SUPER_ADMIN") {
		return ActorType.ADMIN;
	}
	return ActorType.INSTRUCTOR;
}

async function resolveServerTenantId(email: string, fallback?: string): Promise<string | undefined> {
	const u = await getEngLabsUserByEmail(email);
	return u?.tenantId ?? fallback;
}

/** History rows reference eng-labs users on the platform database; the resume-app id is the fallback for anyone else. */
async function actorId(user: { id: string; email: string }): Promise<string> {
	return (await getEngLabsUserByEmail(user.email))?.id ?? user.id;
}

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

/** The reviewer's own top-level comments per resume, by status. Replies are left out: they stay OPEN forever. */
async function getMyCommentStatsByResumeIds(resumeIds: string[], authorId: string | undefined) {
	const stats = new Map<string, { OPEN: number; ADDRESSED: number; RESOLVED: number }>();
	if (resumeIds.length === 0 || !authorId) return stats;
	const comments = await db
		.select({ resumeId: schema.resumeComment.resumeId, status: schema.resumeComment.status })
		.from(schema.resumeComment)
		.where(
			and(
				inArray(schema.resumeComment.resumeId, resumeIds),
				eq(schema.resumeComment.authorId, authorId),
				isNull(schema.resumeComment.parentId),
			),
		);

	for (const c of comments) {
		// Comments from before review rounds existed are PUBLISHED or DRAFT: open, as the student's feedback list shows them.
		const status = c.status === "PUBLISHED" || c.status === "DRAFT" ? "OPEN" : c.status;
		if (status !== "OPEN" && status !== "ADDRESSED" && status !== "RESOLVED") continue;
		const s = stats.get(c.resumeId) ?? { OPEN: 0, ADDRESSED: 0, RESOLVED: 0 };
		s[status]++;
		stats.set(c.resumeId, s);
	}
	return stats;
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
		if (!latest.has(e.resumeId)) {
			latest.set(e.resumeId, e.overallScore);
		}
	}
	return latest;
}

/**
 * When each resume was first submitted, keyed by resume id.
 *
 * This used to read only the newest history row and return a boolean, so a resume that was
 * submitted and then verified reported false — the verdict is the newer row. On this tenant that
 * marked 245 of 461 submitted resumes as never submitted. The earliest SUBMITTED row is both the
 * answer to "was it submitted" and the date the validation report prints.
 */
export async function getSubmissionDatesByResumeIds(resumeIds: string[]) {
	if (resumeIds.length === 0) return new Map<string, Date>();

	const history = await db
		.select({ resumeId: schema.resumeHistory.resumeId, createdAt: schema.resumeHistory.createdAt })
		.from(schema.resumeHistory)
		.where(and(inArray(schema.resumeHistory.resumeId, resumeIds), eq(schema.resumeHistory.action, "SUBMITTED")))
		.orderBy(schema.resumeHistory.createdAt);

	const dates = new Map<string, Date>();
	for (const h of history) if (!dates.has(h.resumeId)) dates.set(h.resumeId, h.createdAt);
	return dates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Student Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export const studentDashboard = protectedProcedure
	.route({
		method: "GET",
		path: "/resumes/dashboard/student",
		tags: ["Dashboard"],
		operationId: "getStudentDashboard",
		summary: "Get student dashboard data",
		description: "Returns student's resumes along with feedback summaries and overall performance metrics.",
	})
	.input(
		z.object({
			userId: z.string().describe("Ignored: always the signed-in student (kept for older clients)"),
			engLabsUserId: z.string().optional().describe("Ignored: resolved from the signed-in user"),
			tenantId: z.string().optional().describe("Tenant ID (optional)"),
		}),
	)
	.handler(async ({ context }) => {
		// Always the caller's own dashboard: the client-sent userId / engLabsUserId are not trusted.
		const resumes = await db.select().from(schema.resume).where(eq(schema.resume.userId, context.user.id));
		const engLabsUser = await getEngLabsUserByEmail(context.user.email);

		const resumeIds = resumes.map((r) => r.id);
		const [commentCounts, latestScores, submissionDates, enrollment] = await Promise.all([
			getCommentCountsByResumeIds(resumeIds),
			getLatestEvaluationsByResumeIds(resumeIds),
			getSubmissionDatesByResumeIds(resumeIds),
			engLabsUser ? getStudentEnrollmentInfo(engLabsUser.id) : Promise.resolve(null),
		]);

		const resumesWithFeedback = resumes.map((resume) => {
			const commentCount = commentCounts.get(resume.id) ?? 0;
			const evaluationScore = latestScores.get(resume.id) ?? null;
			const isSubmitted = submissionDates.has(resume.id);
			return {
				...resume,
				feedback: {
					totalComments: commentCount,
					evaluationScore,
					isSubmitted,
				},
			};
		});

		const totalComments = resumesWithFeedback.reduce((sum, r) => sum + r.feedback.totalComments, 0);
		const scored = resumesWithFeedback.filter((r) => r.feedback.evaluationScore !== null);
		const averageScore =
			scored.length > 0 ? scored.reduce((sum, r) => sum + (r.feedback.evaluationScore ?? 0), 0) / scored.length : null;

		return {
			user: { id: context.user.id },
			enrollment,
			resumes: resumesWithFeedback,
			stats: {
				totalResumes: resumes.length,
				withFeedback: resumesWithFeedback.filter((r) => r.feedback.totalComments > 0).length,
				totalComments,
				evaluationsReceived: scored.length,
				averageScore,
			},
		};
	});

type SectionsDashboardStudent = {
	sectionId: string;
	/** Every eng-labs org unit this learner is tied to (enrollment + mappings). */
	engLabsUnitIds: string[];
	resumes: Array<{ evaluationScore: number | null; reviewStatus?: string }>;
};

/** Placement package for a dashboard row — from instructor assignment or org parent. */
function resolveSectionPackageMeta(
	unitId: string,
	descendantSectionIds: Set<string>,
	sectionRows: Section[],
): { packageId: string | null; packageName: string | null } {
	const direct = sectionRows.find((s) => s.id === unitId);
	if (direct?.packageId) {
		return { packageId: direct.packageId, packageName: direct.packageName };
	}
	for (const s of sectionRows) {
		if (descendantSectionIds.has(s.id) && s.packageId) {
			return { packageId: s.packageId, packageName: s.packageName };
		}
	}
	return { packageId: null, packageName: null };
}

function computeUnitStatsRow(
	unit: { id: string; name: string; type: string },
	descendantSectionIds: Set<string>,
	students: SectionsDashboardStudent[],
	packageMeta: { packageId: string | null; packageName: string | null },
	/**
	 * Real placement packages this row's learners belong to, unioned over its descendant sections.
	 * The package filter matches against this, NOT packageId — see getSectionPackageIds.
	 */
	packageIdsBySection: Record<string, string[]> = {},
	/** Parent org unit (department / stream) name, rendered as the card subtitle. */
	parentName: string | null = null,
) {
	const unitStudents = students.filter((s) => {
		const ids = s.engLabsUnitIds.length > 0 ? s.engLabsUnitIds : [s.sectionId];
		return ids.some((id) => descendantSectionIds.has(id));
	});
	const unitResumes = unitStudents.flatMap((s) => s.resumes);

	const verified = unitResumes.filter((r) =>
		[
			"FACULTY_VERIFIED",
			"FINALIZED_BY_FACULTY",
			"PO_REVISION_REQUESTED",
			"RESUBMITTED_TO_PO",
			"PO_VERIFIED",
			"APPROVED",
		].includes((r as { reviewStatus?: string }).reviewStatus ?? "DRAFT"),
	);

	// Everything a student has handed over, whoever holds it now. SUBMITTED_TO_FACULTY belongs here:
	// leaving it out made the section cards report resumes sitting with faculty as "in Draft", which
	// on this tenant is most of them, and hid the backlog the cards exist to show.
	const finalized = unitResumes.filter((r) =>
		[
			"SUBMITTED_TO_FACULTY",
			"FACULTY_REVISION_REQUESTED",
			"FACULTY_VERIFIED",
			"FINALIZED_BY_FACULTY",
			"SUBMITTED_TO_PO",
			"PO_REVISION_REQUESTED",
			"RESUBMITTED_TO_PO",
			"PO_VERIFIED",
			"APPROVED",
		].includes((r as { reviewStatus?: string }).reviewStatus ?? "DRAFT"),
	);

	const clearedFaculty = unitResumes.filter((r) =>
		["FINALIZED_BY_FACULTY", "PO_REVISION_REQUESTED", "RESUBMITTED_TO_PO", "PO_VERIFIED", "APPROVED"].includes(
			(r as { reviewStatus?: string }).reviewStatus ?? "DRAFT",
		),
	);

	const poVerified = unitResumes.filter((r) => (r as { reviewStatus?: string }).reviewStatus === "PO_VERIFIED");

	const approved = unitResumes.filter((r) => (r as { reviewStatus?: string }).reviewStatus === "APPROVED");

	const scores = unitResumes.filter((r) => r.evaluationScore !== null).map((r) => r.evaluationScore!);

	const packageIds = [
		...new Set([...descendantSectionIds].flatMap((sectionId) => packageIdsBySection[sectionId] ?? [])),
	];

	return {
		id: unit.id,
		name: unit.name,
		unitType: unit.type,
		packageId: packageMeta.packageId,
		packageName: packageMeta.packageName,
		packageIds,
		parentName,
		stats: {
			totalStudents: unitStudents.length,
			totalResumes: unitResumes.length,
			evaluatedResumes: verified.length,
			submittedResumes: finalized.length,
			passedFaculty: clearedFaculty.length,
			poVerifiedResumes: poVerified.length,
			approvedResumes: approved.length,
			completionRate: unitResumes.length > 0 ? Math.round((verified.length / unitResumes.length) * 100) : 0,
			averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
		},
	};
}

/** `units` plus every ancestor of them found in `all`. */
function withAncestors(units: OrgUnitRow[], all: OrgUnitRow[]) {
	const byId = new Map(all.map((u) => [u.id, u]));
	const out = new Map(units.map((u) => [u.id, u]));
	for (const unit of units) {
		let parent = byId.get(unit.parentId ?? "");
		while (parent && !out.has(parent.id)) {
			out.set(parent.id, parent);
			parent = byId.get(parent.parentId ?? "");
		}
	}
	return [...out.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Section-Scoped Dashboard (Faculty & PO)
// ─────────────────────────────────────────────────────────────────────────────

export const sectionsDashboard = protectedProcedure
	.route({
		method: "GET",
		path: "/resumes/dashboard/sections",
		tags: ["Dashboard"],
		operationId: "getSectionsDashboard",
		summary: "Get section-scoped dashboard data",
		description:
			"Returns students, resumes, and metrics scoped to the given sections, grouped by package. Used by Faculty (assigned sections) and PO (all sections).",
	})
	.input(
		z.object({
			sectionIds: z.array(z.string()).describe("Organisation unit IDs from SSO JWT (fallback)"),
			tenantId: z.string().describe("Eng-labs tenant ID"),
			activeUnitId: z.string().optional().describe("Selected org unit ID(s) for filtering students, comma-separated"),
			scope: z.enum(["faculty", "po"]).describe("Determines section scoping"),
		}),
	)
	.handler(async ({ context, input }) => {
		const { activeUnitId, scope } = input;
		const reqId = `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

		dlog("handler", "sections:request:received", {
			reqId,
			userEmail: context.user.email,
			input: {
				scope,
				activeUnitId,
				sectionIdsCount: input.sectionIds.length,
				clientTenantId: input.tenantId,
			},
		});

		try {
			// 1. Resolve the authenticated user in eng-labs + actual tenantId.
			// The eng-labs user's tenantId is authoritative — client-supplied input.tenantId can drift
			// (e.g., stale SSO localStorage, cross-tenant testing) and would mis-scope every query below.
			const engLabsUser = await getEngLabsUserByEmail(context.user.email);
			// Staff only: students and accounts missing from eng-labs get no roster and cannot pick a tenant.
			if (!engLabsUser || (engLabsUser.userType ?? "LEARNER") === "LEARNER") throw forbidden();
			let tenantId = engLabsUser?.tenantId ?? input.tenantId;

			dlog("handler", "sections:auth:resolved", {
				reqId,
				engLabsUserFound: !!engLabsUser,
				engLabsUserId: engLabsUser?.id ?? null,
				engLabsTenantId: engLabsUser?.tenantId ?? null,
				resolvedTenantId: tenantId,
			});

			// 2. Resolve assigned sections BEFORE packages/org tree — faculty SSO often has tenantId "default"
			//    and no org resolution until we know real tenant from organisation_units.
			let sections: Section[] = [];
			// Faculty scope = unit-assigned students UNION personally mentored students, mirroring
			// FacultyScopeService.facultyStudentIds in eng-labs. Null for PO/admin, who are tenant-wide.
			// When set, it is the authoritative cohort: section membership alone over-collects, because
			// a section is routinely split between two faculty by roll range.
			let facultyStudentIds: Set<string> | null = null;
			// Sections the faculty owns outright. Students in these count wholly; students in
			// mentee-derived sections count only if personally mentored.
			const unitAssignedSectionIds = new Set<string>();
			if (scope === "faculty" && engLabsUser?.id) {
				const unitSections = await getInstructorSections(engLabsUser.id);
				for (const s of unitSections) unitAssignedSectionIds.add(s.id);
				// tenantId may still be "default" here (faculty SSO); resolve it from the unit
				// assignments first so the mentee query is correctly scoped.
				let menteeTenantId = engLabsUser.tenantId ?? tenantId;
				if ((!menteeTenantId || menteeTenantId === "default") && unitSections.length > 0) {
					menteeTenantId = (await getTenantIdForOrgUnits(unitSections.map((s) => s.id))) ?? menteeTenantId;
				}
				const mentees =
					menteeTenantId && menteeTenantId !== "default" ? await getMenteeStudents(engLabsUser.id, menteeTenantId) : [];

				facultyStudentIds = new Set(mentees.map((m) => m.id));

				// A mentor-only faculty has no unit assignment, so their section cards have to come from
				// the classes their mentees actually sit in — otherwise every tab renders blank.
				const menteeSectionIds = [...new Set(mentees.map((m) => m.sectionId).filter(Boolean))];
				const menteeSections =
					menteeSectionIds.length > 0
						? (await getSectionsByIds(menteeSectionIds)).filter((s) => !unitSections.some((u) => u.id === s.id))
						: [];
				sections = [...unitSections, ...menteeSections];

				// Unit-assigned students belong to this faculty too. Their ids are resolved after the
				// tenant is final (step 11 cohort build) — recorded here so that step knows to add them.
				dlog("handler", "sections:faculty:scope-resolved", {
					reqId,
					unitSections: unitSections.length,
					menteeSections: menteeSections.length,
					mentees: mentees.length,
				});
			}
			if (sections.length === 0 && input.sectionIds.length > 0) {
				sections = await getSectionsByIds(input.sectionIds);
				// Retained for all scopes, faculty included. It only fires when the server derived no
				// scope at all — no unit assignments AND no mentees — so for a correctly configured
				// faculty it is unreachable. When it does fire, the cohort filter is dropped as well:
				// leaving an empty facultyStudentIds in place would return sections with zero students,
				// which is worse than the pre-existing behaviour this preserves.
				// Note this means scope is client-supplied in that case; it is a deliberate fallback,
				// not an enforcement boundary.
				facultyStudentIds = null;
				dlog("handler", "sections:fallback:by-ids", { reqId, count: sections.length, scope });
			}
			if (sections.length > 0) {
				const ouTenant = await getTenantIdForOrgUnits(sections.map((s) => s.id));
				if (ouTenant && (!tenantId || tenantId === "default")) {
					dlog("handler", "sections:tenant:upgraded-from-orgunits", { reqId, from: tenantId, to: ouTenant });
					tenantId = ouTenant;
				}
			}

			// 3. Get placement packages for the filter UI
			let filterPackages: PlacementPackage[] = [];
			let resolvedOrganisationId: string | null = null;

			if (engLabsUser?.id) {
				if (scope === "faculty") {
					filterPackages = await getInstructorPackages(engLabsUser.id);
				}
			}
			// PO/admin always get all packages for the org; faculty fallback to all if no assigned packages
			if (filterPackages.length === 0 && tenantId && tenantId !== "default") {
				// Derive organisationId from the first available placement package or org unit
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
					// If no packages, try to get organisation_id from org units
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

			// 4. Get unit schema types + all org units for the filter UI
			const [unitTypes, allOrgUnits] = await Promise.all([
				resolvedOrganisationId && tenantId && tenantId !== "default"
					? getUnitSchemaTypes(tenantId, resolvedOrganisationId)
					: Promise.resolve([] as string[]),
				resolvedOrganisationId && tenantId && tenantId !== "default"
					? getAllOrgUnits(tenantId, resolvedOrganisationId)
					: Promise.resolve([] as OrgUnitRow[]),
			]);

			// 5. PO/admin: every section with learners under an org that owns a placement package.
			// Tenant-wide on purpose — an officer supervises the whole tenant, so this must not be
			// narrowed by placement_instructor_unit_assignments (see getOfficerSections).
			if (sections.length === 0 && scope === "po" && tenantId && tenantId !== "default") {
				sections = await getOfficerSections(tenantId);
			}

			// 6. For faculty scope, restrict allOrgUnits to only units relevant to their assigned sections
			let scopedOrgUnits = allOrgUnits;
			if (scope === "faculty" && sections.length > 0) {
				const relevantIds = new Set(sections.map((s) => s.id));
				scopedOrgUnits = allOrgUnits.filter((u) => relevantIds.has(u.id));
			}

			// 7. Derive unit types present in the scoped units (overrides full-org unitTypes for faculty).
			//     When allOrgUnits failed to load, scopedOrgUnits is empty — fall back to instructor sections' types
			//     so the Sections tab filter matches real rows.
			const scopedUnitTypes =
				scope === "faculty" && sections.length > 0
					? scopedOrgUnits.length > 0
						? [...new Set(scopedOrgUnits.map((u) => u.type))].sort()
						: [...new Set(sections.map((s) => s.type))].sort()
					: unitTypes;

			const normEmail = (e: string) => e.trim().toLowerCase();

			// 8–9. Cohort (resume DB first): all `user` rows for this tenant → eng-labs LEARNER profiles with
			//     every org link (enrollment + user_mappings). Filters:
			//     • PO: optional placement subtree (skip if none configured).
			//     • Faculty: instructor-assigned org units + all descendants in tenant.
			//     • activeUnitId: subtree of selected department/stream/class.
			//     This matches department-only and class-only enrollments for default overview and filters.
			let activeDescendantSet: Set<string> | null = null;
			if (activeUnitId) {
				const activeUnitIds = activeUnitId.split(",");
				if (tenantId && tenantId !== "default") {
					activeDescendantSet = new Set(await getDescendantOrgUnitIds(activeUnitIds, tenantId));
				} else {
					const queue = activeUnitIds.filter((id) => scopedOrgUnits.some((u) => u.id === id));
					if (queue.length > 0) {
						const childIds = new Set<string>();
						while (queue.length > 0) {
							const current = queue.shift()!;
							childIds.add(current);
							for (const u of scopedOrgUnits) {
								if (u.parentId === current) queue.push(u.id);
							}
						}
						activeDescendantSet = childIds;
					}
				}
			}

			let placementBoundarySet: Set<string> | null = null;
			if (scope === "po" && tenantId && tenantId !== "default") {
				// Must match the tenant-wide section resolution above: a boundary still derived from
				// placement_instructor_unit_assignments would re-filter out the students those
				// sections just admitted (profilePassesFilters rejects a learner whose unitIds fall
				// outside this set).
				const pIds = await getOfficerOrgUnitIds(tenantId);
				placementBoundarySet = pIds.length > 0 ? new Set(pIds) : null;
			}

			let instructorSubtreeSet: Set<string> | null = null;
			if (scope === "faculty") {
				if (sections.length === 0) {
					instructorSubtreeSet = new Set();
				} else if (tenantId && tenantId !== "default") {
					instructorSubtreeSet = new Set(
						await getDescendantOrgUnitIds(
							sections.map((s) => s.id),
							tenantId,
						),
					);
				} else {
					instructorSubtreeSet = new Set(sections.map((s) => s.id));
				}
			}

			function profilePassesFilters(p: EngLabsLearnerProfile): boolean {
				if (placementBoundarySet && !p.unitIds.some((id) => placementBoundarySet.has(id))) return false;
				if (instructorSubtreeSet !== null && !p.unitIds.some((id) => instructorSubtreeSet.has(id))) return false;
				if (activeDescendantSet && !p.unitIds.some((id) => activeDescendantSet.has(id))) return false;
				return true;
			}

			// Cohort: source of truth is eng-labs. "Total Students" is the deduplicated set of learners
			// in scope who have **active resume-builder access** (a non-expired `user_quota_grants` row
			// for `RESUME_CREATE`). Better Auth `user` rows enrich each learner with resume data when
			// the learner has signed up; learners without a Better Auth row appear with empty resumes.
			//   • Faculty scope = learners in the faculty's assigned sections.
			//   • Admin / PO scope = learners across the tenant's placement-scoped packages, deduped.
			// See CLAUDE.md "Dashboard scoping rules" for the canonical product spec.
			const cohortEmailSet = new Set<string>();
			if (sections.length > 0 && tenantId && tenantId !== "default") {
				const inSections = await getStudentsBySections(
					sections.map((s) => s.id),
					tenantId,
				);
				// Unit-assigned sections contribute all their students; mentee-derived sections contribute
				// only the mentees. Both are folded into facultyStudentIds so every downstream count —
				// overview totals, inbox, per-section cards, students tab — uses one cohort.
				if (facultyStudentIds) {
					for (const s of inSections) {
						if (unitAssignedSectionIds.has(s.sectionId)) facultyStudentIds.add(s.id);
					}
				}
				for (const s of inSections) {
					// Section membership alone over-collects for faculty who own half a section.
					if (facultyStudentIds && !facultyStudentIds.has(s.id)) continue;
					const e = normEmail(s.email);
					if (e) cohortEmailSet.add(e);
				}
			}

			// Admin/PO also seed cohort from Better Auth tenant users (signed-up learners not yet linked
			// to a placement section). Faculty stays strictly within their assigned sections.
			let resumeUsers: (typeof schema.user.$inferSelect)[] = [];
			if (tenantId && tenantId !== "default") {
				if (scope === "faculty") {
					resumeUsers =
						cohortEmailSet.size > 0
							? await db
									.select()
									.from(schema.user)
									.where(inArray(sql<string>`lower(trim(${schema.user.email}))`, [...cohortEmailSet]))
							: [];
				} else {
					const resumeUsersByTenant = await db.select().from(schema.user).where(eq(schema.user.tenantId, tenantId));
					for (const u of resumeUsersByTenant) cohortEmailSet.add(normEmail(u.email));

					const allEmails = [...cohortEmailSet];
					resumeUsers =
						allEmails.length > 0
							? await db
									.select()
									.from(schema.user)
									.where(inArray(sql<string>`lower(trim(${schema.user.email}))`, allEmails))
							: [];
				}
			}

			// Restrict the cohort to learners with active resume-builder access. Returns null when
			// eng-labs isn't configured — in that case we leave the cohort untouched (no filter).
			const cohortBeforeAccess = cohortEmailSet.size;
			const accessEmails = await filterEmailsWithResumeBuilderAccess([...cohortEmailSet]);
			if (accessEmails !== null) {
				for (const email of [...cohortEmailSet]) {
					if (!accessEmails.has(email)) cohortEmailSet.delete(email);
				}
			}

			const profiles = await getEngLabsLearnerProfilesByEmails([...cohortEmailSet], tenantId);
			const profileByEmail = new Map<string, EngLabsLearnerProfile>(profiles.map((p) => [normEmail(p.email), p]));
			const localUserByEmail = new Map(resumeUsers.map((u) => [normEmail(u.email), u]));

			const emailToLocalUser = new Map<string, (typeof resumeUsers)[number]>();
			const engLabsStudents: import("@/integrations/eng-labs/types").StudentInfo[] = [];

			dlog("handler", "sections:cohort-funnel", {
				reqId,
				scope,
				sectionsResolved: sections.length,
				cohortBeforeAccess,
				accessEmailsCount: accessEmails === null ? "no-filter" : accessEmails.size,
				cohortAfterAccess: cohortEmailSet.size,
				profilesCount: profiles.length,
			});

			for (const p of profiles) {
				if (!profilePassesFilters(p)) continue;
				const email = normEmail(p.email);
				const localUser = localUserByEmail.get(email);
				if (localUser) emailToLocalUser.set(email, localUser);
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

			// 10. Get resumes for matched users
			const resumes = await getResumesForUsers(localUserIds);
			const resumeIds = resumes.map((r) => r.id);

			// 9. Get feedback data + submission status
			const [commentCounts, latestScores, submissionDates, myComments] = await Promise.all([
				getCommentCountsByResumeIds(resumeIds),
				getLatestEvaluationsByResumeIds(resumeIds),
				getSubmissionDatesByResumeIds(resumeIds),
				getMyCommentStatsByResumeIds(resumeIds, engLabsUser?.id),
			]);

			// 10. Build per-user resume data
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
						const submittedAt = submissionDates.get(r.id) ?? null;
						const isSubmitted = submittedAt !== null;

						let status: "not_reviewed" | "submitted" | "evaluated" | "has_comments" = "not_reviewed";
						if (score !== null) status = "evaluated";
						else if (isSubmitted) status = "submitted";
						else if (comments > 0) status = "has_comments";

						return {
							id: r.id,
							name: r.name,
							updatedAt: r.updatedAt,
							evaluationScore: score,
							commentCount: comments,
							myComments: myComments.get(r.id) ?? null,
							isSubmitted,
							// When the student first handed it over, for the validation report's date column.
							submittedAt,
							status,
							reviewStatus: (r as any).reviewStatus ?? "DRAFT",
							locked: (r as any).locked ?? false,
							unlockReason: (r as any).unlockReason ?? null,
						};
					}),
				};
			});

			// 11. Calculate stats for ALL org units (hierarchical aggregation).
			// Package membership is resolved from enrolments, once for every section in scope, because
			// a section's own packageId is a parent-org-unit id and cannot be filtered against.
			const packageIdsBySection = await getSectionPackageIds(
				sections.map((s) => s.id),
				tenantId ?? "",
			);
			// Department/stream name per unit, for the card subtitle. Taken from the org-unit tree
			// rather than Section.packageName, which holds a package name for unit-assigned faculty
			// and a parent-unit name for everyone else — the subtitle should read the same for all.
			const orgUnitNameById = new Map(allOrgUnits.map((u) => [u.id, u.name] as const));
			const parentNameOf = (parentId: string | null | undefined) =>
				(parentId ? orgUnitNameById.get(parentId) : null) ?? null;

			let unitStats = scopedOrgUnits.map((unit) => {
				// Find all descendant CLASS-level section IDs for this unit
				const descendantSectionIds = new Set<string>();
				const queue = [unit.id];
				const processed = new Set<string>();

				while (queue.length > 0) {
					const currentId = queue.shift()!;
					if (processed.has(currentId)) continue;
					processed.add(currentId);

					// If it's a leaf section, add it
					const isSection = sections.some((s) => s.id === currentId);
					if (isSection) descendantSectionIds.add(currentId);

					// Find children in allOrgUnits to continue recursion
					for (const u of allOrgUnits) {
						if (u.parentId === currentId) queue.push(u.id);
					}
				}

				return computeUnitStatsRow(
					{ id: unit.id, name: unit.name, type: unit.type },
					descendantSectionIds,
					students,
					resolveSectionPackageMeta(unit.id, descendantSectionIds, sections),
					packageIdsBySection,
					parentNameOf(unit.parentId),
				);
			});

			// Faculty: when org-unit tree never loaded (or IDs don't intersect), scopedOrgUnits is empty but
			// getInstructorSections still returned rows — build one card per assigned section so the UI isn't blank.
			if (unitStats.length === 0 && scope === "faculty" && sections.length > 0) {
				unitStats = sections.map((sec) =>
					computeUnitStatsRow(
						{ id: sec.id, name: sec.name, type: sec.type },
						new Set([sec.id]),
						students,
						{ packageId: sec.packageId, packageName: sec.packageName },
						packageIdsBySection,
						// No org-unit tree in this fallback, so the parent name has to come from the
						// section row itself.
						parentNameOf(sec.parentUnitId) ?? sec.packageName,
					),
				);
			}

			// 12. Aggregate stats. Cohort is now eng-labs-driven (every assigned learner counts in
			// totalStudents), so `enrolledInResumeBuilder` is specifically those who have a Better Auth
			// `user` row (resumeAppUserId set after the join above).
			const allResumes = students.flatMap((s) => s.resumes);
			const allEvaluated = allResumes.filter((r) => r.evaluationScore !== null);
			const allScores = allEvaluated.map((r) => r.evaluationScore!);
			const totalComments = allResumes.reduce((sum, r) => sum + r.commentCount, 0);
			const allSubmitted = allResumes.filter((r) => r.isSubmitted);
			const enrolledInResumeBuilder = students.filter((s) => s.resumeAppUserId !== null).length;
			const withPrimaryResume = students.filter((s) => s.resumes.length > 0).length;

			// 13. Recent activity — strictly this cohort's own resumes.
			// An empty resumeIds means "this cohort has no resumes", NOT "no filter". Passing
			// undefined to .where() drops the predicate entirely and returns the newest rows in
			// the whole table, across every tenant: a faculty member whose students had no
			// resumes was shown another faculty's students' feedback, with the student name
			// rendering as "Student" because the enrichment map could not resolve it.
			const [recentEvaluations, recentComments] =
				resumeIds.length > 0
					? await Promise.all([
							db
								.select()
								.from(schema.resumeEvaluation)
								.where(inArray(schema.resumeEvaluation.resumeId, resumeIds))
								.orderBy(desc(schema.resumeEvaluation.createdAt))
								.limit(5),
							db
								.select()
								.from(schema.resumeComment)
								.where(inArray(schema.resumeComment.resumeId, resumeIds))
								.orderBy(desc(schema.resumeComment.createdAt))
								.limit(5),
						])
					: [[], []];

			const resumeIdToEmail = new Map<string, string>();
			for (const student of students) {
				for (const r of student.resumes) {
					resumeIdToEmail.set(r.id, student.email);
				}
			}

			const enrichedEvaluations = recentEvaluations.map((e) => {
				const email = resumeIdToEmail.get(e.resumeId);
				const student = email ? engLabsStudents.find((s) => s.email === email) : null;
				return {
					id: e.id,
					resumeId: e.resumeId,
					overallScore: e.overallScore,
					evaluatedAt: e.evaluatedAt,
					studentName: student?.name ?? null,
				};
			});

			const enrichedComments = recentComments.map((c) => {
				const email = resumeIdToEmail.get(c.resumeId);
				const student = email ? engLabsStudents.find((s) => s.email === email) : null;
				return {
					id: c.id,
					resumeId: c.resumeId,
					content: c.content,
					createdAt: c.createdAt,
					studentName: student?.name ?? null,
				};
			});

			const response = {
				// Filter UI data (scoped to instructor's sections for faculty role, plus their parents so the
				// Branch filter has departments; picking one still only shows the instructor's own students)
				packages: filterPackages,
				unitTypes: scopedUnitTypes,
				allOrgUnits: scope === "faculty" ? withAncestors(scopedOrgUnits, allOrgUnits) : scopedOrgUnits,
				// Section-level stats (CLASS leaf nodes)
				sections: unitStats,
				students,
				/** eng-labs id of the viewer; comments store it as authorId ("my comments" on the Overview). */
				reviewerId: engLabsUser?.id ?? null,
				aggregateStats: {
					totalStudents: students.length,
					totalResumes: allResumes.length,
					/** Learners in scope who have a Polymath `user` row (eng-labs ∩ resume DB). Same as totalStudents. */
					enrolledInResumeBuilder,
					/** How many of those have at least one primary resume document (`resume.is_primary`). */
					withPrimaryResume,
					/** % of resume-builder enrollees with a primary resume. */
					primaryResumeRate:
						enrolledInResumeBuilder > 0 ? Math.round((withPrimaryResume / enrolledInResumeBuilder) * 1000) / 10 : 0,
					totalEvaluations: allEvaluated.length,
					totalSubmitted: allSubmitted.length,
					totalComments,
					completionRate: allResumes.length > 0 ? Math.round((allEvaluated.length / allResumes.length) * 100) : 0,
					averageScore: allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null,
				},
				recentActivity: {
					recentEvaluations: enrichedEvaluations,
					recentComments: enrichedComments,
				},
			};

			dlog("handler", "sections:response:ready", {
				reqId,
				packagesCount: response.packages.length,
				unitTypesCount: response.unitTypes.length,
				allOrgUnitsCount: response.allOrgUnits.length,
				sectionsCount: response.sections.length,
				studentsCount: response.students.length,
				aggregate: response.aggregateStats,
				recentEvaluationsCount: response.recentActivity.recentEvaluations.length,
				recentCommentsCount: response.recentActivity.recentComments.length,
			});

			return response;
		} catch (err) {
			derror("handler", "sections:request:failed", err, { reqId });
			throw err;
		}
	});

// ─────────────────────────────────────────────────────────────────────────────
// Student Detail (for faculty's detail panel)
// ─────────────────────────────────────────────────────────────────────────────

export const studentResumes = protectedProcedure
	.route({
		method: "GET",
		path: "/resumes/dashboard/student-resumes",
		tags: ["Dashboard"],
		operationId: "getStudentResumes",
		summary: "Get full resume detail for a student",
		description:
			"Returns all resumes for a student with comments, evaluations, and history. Used by faculty detail panel.",
	})
	.input(
		z.object({
			resumeAppUserId: z.string().describe("Local resume app user ID of the student"),
		}),
	)
	.handler(async ({ context, input }) => {
		const resumes = await db
			.select()
			.from(schema.resume)
			.where(and(eq(schema.resume.userId, input.resumeAppUserId), eq(schema.resume.isPrimary, true)))
			.orderBy(desc(schema.resume.updatedAt));
		// Full resumes + feedback: staff of the student's tenant only.
		if (resumes.length === 0) await requireReviewer(context.user.email);
		else
			await assertReviewStaff(
				context.user,
				resumes.map((r) => r.id),
			);

		const resumesWithDetail = await Promise.all(
			resumes.map(async (resume) => {
				const [comments, evaluations, history] = await Promise.all([
					db
						.select()
						.from(schema.resumeComment)
						.where(eq(schema.resumeComment.resumeId, resume.id))
						.orderBy(schema.resumeComment.createdAt),
					db
						.select({
							id: schema.resumeEvaluation.id,
							overallScore: schema.resumeEvaluation.overallScore,
							evaluatedAt: schema.resumeEvaluation.evaluatedAt,
						})
						.from(schema.resumeEvaluation)
						.where(eq(schema.resumeEvaluation.resumeId, resume.id))
						.orderBy(desc(schema.resumeEvaluation.evaluatedAt)),
					db
						.select({
							id: schema.resumeHistory.id,
							action: schema.resumeHistory.action,
							actorType: schema.resumeHistory.actorType,
							createdAt: schema.resumeHistory.createdAt,
							currentData: schema.resumeHistory.currentData,
						})
						.from(schema.resumeHistory)
						.where(eq(schema.resumeHistory.resumeId, resume.id))
						.orderBy(desc(schema.resumeHistory.createdAt))
						.limit(20),
				]);

				const latestScore = evaluations[0]?.overallScore ?? null;
				const isSubmitted = history.some((h) => h.action === "SUBMITTED");

				return {
					id: resume.id,
					name: resume.name,
					updatedAt: resume.updatedAt,
					evaluationScore: latestScore,
					isSubmitted,
					comments: comments.map((c) => ({
						id: c.id,
						content: c.content,
						authorId: c.authorId,
						status: c.status,
						parentId: c.parentId,
						createdAt: c.createdAt,
					})),
					reviewStatus: (resume as any).reviewStatus,
					locked: (resume as any).locked ?? false,
					unlockReason: (resume as any).unlockReason ?? null,
					evaluations: evaluations.slice(0, 3),
					history,
				};
			}),
		);

		return { resumes: resumesWithDetail };
	});

// ─────────────────────────────────────────────────────────────────────────────
// Submit Resume for Review (Student action)
// ─────────────────────────────────────────────────────────────────────────────

export const submitResume = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/dashboard/submit",
		tags: ["Dashboard"],
		operationId: "submitResumeForReview",
		summary: "Submit a resume for faculty review",
		description: "Student marks a resume as submitted for review. Visible to faculty as a pending review item.",
	})
	.input(
		z.object({
			resumeId: z.string(),
			studentId: z.string().describe("eng-labs student ID").optional(),
			tenantId: z.string().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { updateResumeStatus } = await import("@/integrations/drizzle/services/resume-feedback.service");

		// Fetch current status to decide if it's an initial submission or a re-submission to PO
		const [currentResume] = await db.select().from(schema.resume).where(eq(schema.resume.id, input.resumeId)).limit(1);
		if (!currentResume) throw new ORPCError("NOT_FOUND", { message: "Resume not found." });
		if (currentResume.userId !== context.user.id) {
			throw new ORPCError("FORBIDDEN", { message: "You can only submit your own resume." });
		}
		// Only from a draft or a revision request: a submission must not undo a reviewer's verdict.
		if (!["DRAFT", "FACULTY_REVISION_REQUESTED", "PO_REVISION_REQUESTED"].includes(currentResume.reviewStatus)) {
			throw new ORPCError("FORBIDDEN", { message: "This resume is already with a reviewer." });
		}

		let nextStatus: any = "SUBMITTED_TO_FACULTY";
		if (currentResume?.reviewStatus === "PO_REVISION_REQUESTED") {
			nextStatus = "RESUBMITTED_TO_PO";
		}

		const tenantId = (await resolveServerTenantId(context.user.email, input.tenantId)) ?? "default";

		await updateResumeStatus({
			resumeId: input.resumeId,
			studentId: input.studentId ?? currentResume?.userId ?? "unknown",
			tenantId,
			status: nextStatus,
			changedBy: await actorId(context.user),
			actorType: "LEARNER",
		});

		return { success: true };
	});

// ─────────────────────────────────────────────────────────────────────────────
// PO Individual Approval Action
// ─────────────────────────────────────────────────────────────────────────────

export const approveResume = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/dashboard/approve",
		tags: ["Dashboard"],
		summary: "Approve a resume (PO action)",
	})
	.input(
		z.object({
			resumeId: z.string(),
			studentId: z.string().optional(),
			tenantId: z.string().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { updateResumeStatus } = await import("@/integrations/drizzle/services/resume-feedback.service");
		await assertReviewStaff(context.user, input.resumeId);

		const tenantId = await resolveServerTenantId(context.user.email, input.tenantId);

		await updateResumeStatus({
			resumeId: input.resumeId,
			studentId: input.studentId,
			tenantId,
			status: "PO_VERIFIED",
			changedBy: await actorId(context.user),
			actorType: "PLACEMENT_OFFICER",
		});

		return { success: true };
	});

// ─────────────────────────────────────────────────────────────────────────────
// Manual Lock/Unlock Toggle
// ─────────────────────────────────────────────────────────────────────────────

export const toggleResumeLock = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/dashboard/lock",
		tags: ["Dashboard"],
		summary: "Lock or unlock a resume manually",
	})
	.input(
		z.object({
			resumeId: z.string(),
			isLocked: z.boolean(),
			reason: z.string().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { toggleLock } = await import("@/integrations/drizzle/services/resume-feedback.service");
		await assertReviewStaff(context.user, input.resumeId);

		await toggleLock({
			resumeId: input.resumeId,
			isLocked: input.isLocked,
			reason: input.reason,
		});

		return { success: true };
	});

// ─────────────────────────────────────────────────────────────────────────────
// Update Resume Status (Faculty/PO action)
// ─────────────────────────────────────────────────────────────────────────────

export const updateStatus = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/dashboard/status",
		tags: ["Dashboard"],
		operationId: "updateResumeStatus",
		summary: "Update resume review status",
	})
	.input(
		z.object({
			resumeId: z.string(),
			studentId: z.string(),
			tenantId: z.string(),
			status: z.enum([
				"FACULTY_REVISION_REQUESTED",
				"FACULTY_VERIFIED",
				"FINALIZED_BY_FACULTY",
				"PO_REVISION_REQUESTED",
				"PO_VERIFIED",
				"APPROVED",
			]),
			expectedStatus: z
				.string()
				.optional()
				.describe("Review status the reviewer was looking at; rejects the write if it has moved on since."),
		}),
	)
	.handler(async ({ context, input }) => {
		const { updateResumeStatus } = await import("@/integrations/drizzle/services/resume-feedback.service");
		const reviewerType = await assertReviewStaff(context.user, input.resumeId);

		// The actor is the signed-in reviewer, not a guess from the status being set. Deriving it from
		// the target meant faculty setting PO_VERIFIED were recorded as a Placement Officer, which both
		// falsified the audit trail and made the stage rule below unenforceable.
		const actorType = toActorType(reviewerType);

		const [current] = await db
			.select({ reviewStatus: schema.resume.reviewStatus })
			.from(schema.resume)
			.where(eq(schema.resume.id, input.resumeId))
			.limit(1);
		const currentStatus = current?.reviewStatus ?? "DRAFT";

		// Faculty cannot move a resume the Placement Officer has taken on; the PO can move any of them.
		if (!canChangeReviewStatus(actorType, currentStatus)) {
			throw new ORPCError("CONFLICT", { message: PO_STAGE_BLOCKED_MESSAGE });
		}

		// Someone else reviewed it while this reviewer had the page open. Refuse rather than overwrite:
		// both verdicts email the student, and the loser's message would contradict the stored status.
		if (input.expectedStatus && input.expectedStatus !== currentStatus) {
			throw new ORPCError("CONFLICT", {
				message: `This resume moved to ${currentStatus} while you were reviewing it. Reload to see the latest.`,
				data: { currentStatus },
			});
		}

		const tenantId = await resolveServerTenantId(context.user.email, input.tenantId);

		await updateResumeStatus({
			resumeId: input.resumeId,
			studentId: input.studentId,
			tenantId,
			status: input.status as any,
			changedBy: await actorId(context.user),
			actorType,
		});

		const verdict = REVIEW_VERDICTS[input.status];
		// Not awaited: the verdict is saved; a slow mail server shouldn't hold up the reviewer (errors are logged).
		if (verdict) void emailReviewSummary(input.resumeId, context.user.name, verdict === "approved");

		return { success: true };
	});

/** Emails the student once per review, listing every open comment with a link straight to it. */
async function emailReviewSummary(resumeId: string, reviewerName: string, approved: boolean) {
	try {
		const { sendEmail } = await import("@/integrations/email/service");
		const [row] = await db
			.select({ name: schema.resume.name, studentName: schema.user.name, email: schema.user.email })
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.user.id, schema.resume.userId))
			.where(eq(schema.resume.id, resumeId))
			.limit(1);
		if (!row) return;

		const comments = await db
			.select()
			.from(schema.resumeComment)
			.where(eq(schema.resumeComment.resumeId, resumeId))
			.orderBy(schema.resumeComment.createdAt);
		const open = comments.filter((c) => !c.parentId && c.status !== "RESOLVED");

		const mail = reviewSummaryEmail({
			studentName: row.studentName,
			reviewerName: reviewerName || "Your reviewer",
			resumeName: row.name,
			approved,
			comments: open,
			builderUrl: `${env.APP_URL}/resume/builder/${resumeId}`,
		});
		await sendEmail({ to: row.email, ...mail });
	} catch (error) {
		console.error("[REVIEW] Failed to email the review summary:", error);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Update Resumes (Faculty/PO action)
// ─────────────────────────────────────────────────────────────────────────────

export const bulkUpdateResumes = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/dashboard/bulk-status",
		tags: ["Dashboard"],
		operationId: "bulkUpdateResumes",
		summary: "Bulk update resume review statuses",
	})
	.input(
		z.object({
			resumes: z.array(z.object({ id: z.string(), studentId: z.string() })),
			tenantId: z.string(),
			status: z.enum(["FINALIZED_BY_FACULTY", "SUBMITTED_TO_PO", "PO_VERIFIED", "APPROVED"]),
		}),
	)
	.handler(async ({ context, input }) => {
		const { bulkUpdateSectionResumes } = await import("@/integrations/drizzle/services/resume-feedback.service");
		await assertReviewStaff(
			context.user,
			input.resumes.map((r) => r.id),
		);

		const actorType =
			input.status === "APPROVED" || input.status === "PO_VERIFIED" ? "PLACEMENT_OFFICER" : "INSTRUCTOR";

		const tenantId = (await resolveServerTenantId(context.user.email, input.tenantId)) ?? input.tenantId;

		await bulkUpdateSectionResumes({
			resumes: input.resumes,
			tenantId,
			toStatus: input.status as any,
			changedBy: await actorId(context.user),
			actorType,
		});

		return { success: true };
	});

// ─────────────────────────────────────────────────────────────────────────────
// Forward Resume to PO
// ─────────────────────────────────────────────────────────────────────────────

export const forwardResume = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/{resumeId}/forward",
		tags: ["Dashboard"],
		operationId: "forwardResumeToPO",
		summary: "Forward a resume to Placement Officer",
	})
	.input(
		z.object({
			resumeId: z.string(),
			studentId: z.string(),
			tenantId: z.string(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { addToHistory } = await import("@/integrations/drizzle/services/resume-feedback.service");
		await assertReviewStaff(context.user, input.resumeId);

		const tenantId = (await resolveServerTenantId(context.user.email, input.tenantId)) ?? input.tenantId;

		await addToHistory({
			resumeId: input.resumeId,
			studentId: input.studentId,
			tenantId,
			action: "FORWARDED",
			changedBy: await actorId(context.user),
			actorType: "INSTRUCTOR",
		});

		return { success: true };
	});

// ─────────────────────────────────────────────────────────────────────────────
// Sections List (for org unit switcher)
// ─────────────────────────────────────────────────────────────────────────────

export const sectionsList = protectedProcedure
	.route({
		method: "GET",
		path: "/resumes/dashboard/sections-list",
		tags: ["Dashboard"],
		operationId: "listSections",
		summary: "List organisation unit sections",
	})
	.input(
		z.object({
			sectionIds: z.array(z.string()).optional(),
			tenantId: z.string(),
		}),
	)
	.handler(async ({ context, input }) => {
		let sections: Section[] = [];

		const engLabsUser = await getEngLabsUserByEmail(context.user.email);

		// Server-resolved tenant wins over client-supplied input.tenantId (which can drift via stale SSO localStorage).
		let tenantId = engLabsUser?.tenantId ?? input.tenantId;

		if (engLabsUser?.id) {
			sections = await getInstructorSections(engLabsUser.id);
		}
		if (sections.length === 0 && input.sectionIds?.length) {
			sections = await getSectionsByIds(input.sectionIds);
		}
		if (sections.length > 0) {
			const ouTenant = await getTenantIdForOrgUnits(sections.map((s) => s.id));
			if (ouTenant && (!tenantId || tenantId === "default")) {
				tenantId = ouTenant;
			}
		}

		if (sections.length === 0 && tenantId && tenantId !== "default") {
			sections = engLabsUser?.id ? [] : await getPlacementScopedSections(tenantId);
		}

		return { sections };
	});

// ─────────────────────────────────────────────────────────────────────────────
// Review Resume (Faculty — fetch resume + full feedback for review page)
// ─────────────────────────────────────────────────────────────────────────────

export const reviewResume = protectedProcedure
	.route({
		method: "GET",
		path: "/resumes/dashboard/review",
		tags: ["Dashboard"],
		operationId: "reviewResume",
		summary: "Get full resume detail for faculty review",
		description: "Returns resume metadata, comments, evaluations, and history for faculty review page.",
	})
	.input(z.object({ resumeId: z.string() }))
	.handler(async ({ context, input }) => {
		const { getEvaluationsByResumeId } = await import("@/integrations/drizzle/services/resume-feedback.service");
		await assertReviewStaff(context.user, input.resumeId);

		const [resume, comments, evaluations, history] = await Promise.all([
			db.select().from(schema.resume).where(eq(schema.resume.id, input.resumeId)).limit(1),
			db
				.select()
				.from(schema.resumeComment)
				.where(eq(schema.resumeComment.resumeId, input.resumeId))
				.orderBy(schema.resumeComment.createdAt),
			getEvaluationsByResumeId(input.resumeId),
			db
				.select()
				.from(schema.resumeHistory)
				.where(eq(schema.resumeHistory.resumeId, input.resumeId))
				.orderBy(desc(schema.resumeHistory.createdAt))
				.limit(30),
		]);

		if (resume.length === 0) throw new Error("Resume not found");

		const r = resume[0];
		const isSubmitted = history[0]?.action === "SUBMITTED";
		const latestScore = evaluations[0]?.overallScore ?? null;

		return {
			resume: {
				id: r.id,
				name: r.name,
				slug: r.slug,
				tags: r.tags,
				isLocked: r.isLocked,
				userId: r.userId,
				data: r.data,
				updatedAt: r.updatedAt,
				createdAt: r.createdAt,
				reviewStatus: (r as any).reviewStatus,
				isSubmitted,
				latestScore,
			},
			comments: comments.map((c) => ({
				id: c.id,
				content: c.content,
				authorId: c.authorId,
				status: c.status,
				parentId: c.parentId,
				anchor: c.anchor,
				severity: c.severity,
				suggestion: c.suggestion,
				snapshot: c.snapshot,
				createdAt: c.createdAt,
			})),
			evaluations: evaluations.slice(0, 5),
			history,
		};
	});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Router
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PO Section Review — send section back to faculty with notes + optional voice note
// ─────────────────────────────────────────────────────────────────────────────

export const poReviewSection = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/dashboard/po-review-section",
		tags: ["Dashboard"],
		operationId: "poReviewSection",
		summary: "PO sends section back to faculty with review notes",
		description:
			"Saves PO review notes and an optional voice note URL, then bulk-resets all submitted resumes in the section back to FINALIZED_BY_FACULTY so the faculty can address the feedback and resubmit.",
	})
	.input(
		z.object({
			sectionId: z.string().describe("eng-labs section / org-unit ID"),
			tenantId: z.string(),
			facultyId: z.string().optional().describe("eng-labs ID of the faculty who submitted this section"),
			reviewNotes: z.string().min(1, "Review notes are required"),
			voiceNoteUrl: z.string().optional().describe("Storage URL of the recorded voice note"),
			resumes: z.array(z.object({ id: z.string(), studentId: z.string() })),
		}),
	)
	.handler(async ({ context, input }) => {
		const { createPoSectionReview, bulkUpdateSectionResumes } = await import(
			"@/integrations/drizzle/services/resume-feedback.service"
		);
		await requireReviewer(context.user.email);
		if (input.resumes.length > 0)
			await assertReviewStaff(
				context.user,
				input.resumes.map((r) => r.id),
			);

		const tenantId = (await resolveServerTenantId(context.user.email, input.tenantId)) ?? input.tenantId;

		// 1. Persist the review record
		await createPoSectionReview({
			sectionId: input.sectionId,
			tenantId,
			facultyId: input.facultyId,
			poId: context.user.id,
			reviewNotes: input.reviewNotes,
			voiceNoteUrl: input.voiceNoteUrl,
			resumeIds: input.resumes.map((r) => r.id),
		});

		// 2. Bulk-reset all resumes back to FINALIZED_BY_FACULTY so faculty can address and resubmit
		await bulkUpdateSectionResumes({
			resumes: input.resumes,
			tenantId,
			toStatus: "FINALIZED_BY_FACULTY",
			changedBy: await actorId(context.user),
			actorType: "PLACEMENT_OFFICER",
		});

		return { success: true };
	});

// ─────────────────────────────────────────────────────────────────────────────
// Get PO Section Reviews (faculty reads feedback)
// ─────────────────────────────────────────────────────────────────────────────

export const updatePoSectionReview = protectedProcedure
	.route({
		method: "PATCH",
		path: "/resumes/dashboard/po-section-reviews/{id}",
		tags: ["Dashboard"],
		operationId: "updatePoSectionReview",
		summary: "Edit an existing PO section review",
	})
	.input(
		z.object({
			id: z.string(),
			reviewNotes: z.string().min(1, "Review notes are required"),
			voiceNoteUrl: z.string().optional().nullable(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { updatePoSectionReview: updateReview } = await import(
			"@/integrations/drizzle/services/resume-feedback.service"
		);
		// Only the officer who wrote the note can edit it.
		const [review] = await db
			.select({ poId: schema.poSectionReview.poId })
			.from(schema.poSectionReview)
			.where(eq(schema.poSectionReview.id, input.id))
			.limit(1);
		if (!review) throw new ORPCError("NOT_FOUND", { message: "Review not found." });
		if (review.poId !== context.user.id) {
			throw new ORPCError("FORBIDDEN", { message: "Only the placement officer who wrote this can edit it." });
		}
		return updateReview(input.id, {
			reviewNotes: input.reviewNotes,
			voiceNoteUrl: input.voiceNoteUrl,
		});
	});

export const getPoSectionReviews = protectedProcedure
	.route({
		method: "GET",
		path: "/resumes/dashboard/po-section-reviews",
		tags: ["Dashboard"],
		operationId: "getPoSectionReviews",
		summary: "Get PO section review history for a section",
	})
	.input(
		z.object({
			sectionId: z.string(),
			tenantId: z.string(),
		}),
	)
	.output(
		z.array(
			z.object({
				id: z.string(),
				sectionId: z.string(),
				tenantId: z.string(),
				facultyId: z.string().nullable(),
				poId: z.string(),
				reviewNotes: z.string(),
				voiceNoteUrl: z.string().nullable(),
				resumeIds: z.array(z.string()),
				createdAt: z.date(),
			}),
		),
	)
	.handler(async ({ context, input }) => {
		const { getPoSectionReviews: getSectionReviews } = await import(
			"@/integrations/drizzle/services/resume-feedback.service"
		);
		await requireReviewer(context.user.email);
		const tenantId = (await resolveServerTenantId(context.user.email, input.tenantId)) ?? input.tenantId;
		return getSectionReviews(input.sectionId, tenantId);
	});

export const dashboardRouter = {
	student: studentDashboard,
	sections: sectionsDashboard,
	studentResumes,
	submitResume,
	reviewResume,
	forward: forwardResume,
	sectionsList,
	updateStatus,
	bulkUpdateResumes,
	approveResume,
	toggleResumeLock,
	poReviewSection,
	updatePoSectionReview,
	getPoSectionReviews,
};
