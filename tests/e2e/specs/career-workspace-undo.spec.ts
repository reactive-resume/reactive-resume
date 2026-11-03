import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { createAuthenticatedContext } from "../fixtures/auth";
import { createAccount } from "../fixtures/data";
import { deleteE2EUser } from "../fixtures/db";
import { expect, test } from "../fixtures/test";

let database: Pool;
test.beforeAll(() => {
	if (!process.env.DATABASE_URL) throw new Error("Disposable DATABASE_URL required");
	database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
});
test.afterAll(async () => await database.end());

async function workspace(
	page: Page,
	answers = Array.from({ length: 14 }, (_, index) => ({
		id: `fictional-${index}`,
		question: `Fictional question ${index}`,
		answer: "Fictional answer. ".repeat(300),
		factIds: [],
	})),
) {
	const response = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Northwind", role: "Product engineer", status: "saved" },
	});
	await expect(response).toBeOK();
	const id = (await response.json()) as string;
	const saved = await page.request.patch(`/api/openapi/career/workspace/${id}`, {
		data: { answers, expected: { answers: [] } },
	});
	await expect(saved).toBeOK();
	return { id, answers: (await saved.json()).answers as typeof answers };
}

async function removeFirst(page: Page) {
	await page.getByRole("button", { name: "Question options", exact: true }).first().click();
	await page.getByRole("menuitem", { name: "Remove question", exact: true }).click();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
}

for (const mode of ["reload", "close"] as const)
	test(`acknowledged question removal survives ${mode} without sending the whole large workspace`, async ({
		authPage: page,
		account,
	}) => {
		const saved = await workspace(page);
		const remaining = saved.answers.slice(1);
		expect(
			Buffer.byteLength(JSON.stringify({ answers: remaining, expected: { answers: saved.answers } })),
		).toBeGreaterThan(60 * 1024);
		await page.goto(`/dashboard/applications/${saved.id}/apply`);

		await removeFirst(page);
		if (mode === "reload") await page.reload();
		else await Promise.all([page.waitForEvent("close"), page.close({ runBeforeUnload: true })]);
		// SQL is read before reopening a closed page: no recovery replay can manufacture persistence.
		await expect
			.poll(async () => {
				const result = await database.query(
					`select w.data->'answers' as answers from career_workspace w join "user" u on u.id = w.user_id where w.application_id=$1 and u.email=$2`,
					[saved.id, account.email],
				);
				return result.rows[0]?.answers;
			})
			.toEqual(remaining);
	});

test("question removal preserves another client's independent answer edit", async ({ authPage: page }) => {
	const saved = await workspace(page);
	await page.goto(`/dashboard/applications/${saved.id}/apply`);
	await removeFirst(page);
	const newer = saved.answers.map((answer, index) =>
		index === 1 ? { ...answer, answer: "Fictional newer answer", question: "Fictional newer question" } : answer,
	);
	await expect(
		await page.request.patch(`/api/openapi/career/workspace/${saved.id}`, {
			data: { answers: newer, expected: { answers: saved.answers } },
		}),
	).toBeOK();
	const committed = page.waitForResponse(
		(response) => response.url().includes("/career/deleteWorkspaceAnswer") && response.ok(),
	);
	const response = await committed;
	const bytes = response.request().postDataBuffer()?.byteLength ?? 0;
	expect(bytes).toBeGreaterThan(0);
	expect(bytes).toBeLessThan(60 * 1024);
	await expect
		.poll(async () => (await (await page.request.get(`/api/openapi/career/workspace/${saved.id}`)).json()).answers)
		.toEqual(newer.slice(1));
	await expect(page.getByText("Fictional newer question", { exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByText("Fictional question 0", { exact: true })).toHaveCount(0);
});

test("prepared question removal rejects a stale target and shows its current wording", async ({ authPage: page }) => {
	const saved = await workspace(page);
	await page.goto(`/dashboard/applications/${saved.id}/apply`);
	await removeFirst(page);
	const newer = saved.answers.map((answer, index) =>
		index === 0 ? { ...answer, question: "Fictional updated question" } : answer,
	);
	await expect(
		await page.request.patch(`/api/openapi/career/workspace/${saved.id}`, {
			data: { answers: newer, expected: { answers: saved.answers } },
		}),
	).toBeOK();
	const conflict = page.waitForResponse(
		(response) => response.url().includes("/career/deleteWorkspaceAnswer") && response.status() === 409,
	);
	await conflict;
	await expect(page.getByText("Fictional updated question", { exact: true })).toBeVisible();
	const current = await page.request.get(`/api/openapi/career/workspace/${saved.id}`);
	await expect(current).toBeOK();
	expect((await current.json()).answers).toEqual(newer);
});

test("question Undo cancels deletion and cannot recreate an answer erased elsewhere", async ({
	authPage: page,
}, info) => {
	const title = "Tell us about improving a team workflow.";
	const saved = await workspace(page, [
		{
			id: "fictional-0",
			question: title,
			answer: "I introduced a shared onboarding checklist and reviewed it with the support team.",
			factIds: [],
		},
		{
			id: "fictional-1",
			question: "Why would you like to join Northwind?",
			answer: "I enjoy building reliable tools that make everyday work easier.",
			factIds: [],
		},
	]);
	await page.goto(`/dashboard/applications/${saved.id}/apply`);
	await removeFirst(page);
	await page.screenshot({ path: info.outputPath("question-removal-undo.png"), fullPage: true, animations: "disabled" });
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByText(title, { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
	await removeFirst(page);
	const updatedQuestion = "Fictional question added on another device.";
	const newer = [
		...saved.answers,
		{ id: "external-third", question: updatedQuestion, answer: "Fictional new answer.", factIds: [] },
	];
	await expect(
		await page.request.patch(`/api/openapi/career/workspace/${saved.id}`, {
			data: { answers: newer, expected: { answers: saved.answers } },
		}),
	).toBeOK();
	await expect(
		await page.request.delete(`/api/openapi/career/workspace/${saved.id}/answers/fictional-0`, {
			data: { expected: saved.answers[0] },
		}),
	).toBeOK();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByText(updatedQuestion, { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Question options", exact: true })).toHaveCount(2);
	await expect(page.getByText(title, { exact: true })).toHaveCount(0);
	await page.reload();
	await expect(page.getByText(title, { exact: true })).toHaveCount(0);
	const current = await page.request.get(`/api/openapi/career/workspace/${saved.id}`);
	await expect(current).toBeOK();
	expect((await current.json()).answers).toEqual(newer.slice(1));
});

test("owned answer deletion returns the immutable submission receipt, including an idempotent repeat", async ({
	authPage: page,
	account,
	browser,
	request,
}, info) => {
	const saved = await workspace(page);
	await expect(
		await page.request.patch(`/api/openapi/career/workspace/${saved.id}`, {
			data: { checklist: [1, 3], expected: { checklist: [] } },
		}),
	).toBeOK();
	await expect(
		await page.request.post(`/api/openapi/career/workspace/${saved.id}/submit`, {
			data: { answers: saved.answers, expectedAnswers: saved.answers },
		}),
	).toBeOK();
	const before = await (await page.request.get(`/api/openapi/career/workspace/${saved.id}`)).json();
	expect(before.submissionReview).toMatchObject({ checklist: [1, 3], answerVersionId: expect.any(String) });
	const stranger = createAccount(info);
	const other = await createAuthenticatedContext(browser, request, stranger, String(info.project.use.baseURL));
	try {
		const denied = await other.request.delete(`/api/openapi/career/workspace/${saved.id}/answers/fictional-0`, {
			data: { expected: saved.answers[0] },
		});
		expect(denied.status()).toBe(404);
		expect(await denied.text()).not.toContain("Fictional answer.");
		const untouched = await page.request.get(`/api/openapi/career/workspace/${saved.id}`);
		await expect(untouched).toBeOK();
		expect(await untouched.json()).toMatchObject({ answers: saved.answers, submissionReview: before.submissionReview });
		for (const _attempt of ["remove", "repeat"]) {
			const removed = await page.request.delete(`/api/openapi/career/workspace/${saved.id}/answers/fictional-0`, {
				data: { expected: saved.answers[0] },
			});
			await expect(removed).toBeOK();
			expect(await removed.json()).toMatchObject({
				answers: saved.answers.slice(1),
				submissionReview: before.submissionReview,
			});
		}
		const current = await page.request.get(`/api/openapi/career/workspace/${saved.id}`);
		await expect(current).toBeOK();
		expect(await current.json()).toMatchObject({
			answers: saved.answers.slice(1),
			submissionReview: before.submissionReview,
		});
		const rows = await database.query(
			`select w.submission_review, w.data from career_workspace w join "user" u on u.id=w.user_id where w.application_id=$1 and u.email=$2`,
			[saved.id, account.email],
		);
		expect(rows.rows[0].submission_review).toEqual(before.submissionReview);
		expect(rows.rows[0].data).not.toHaveProperty("submissionReview");
	} finally {
		await other.close();
		await deleteE2EUser(stranger);
	}
});
