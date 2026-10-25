import type { SavedData, SavedItem } from "./hooks";
import type { CareerProfileData } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { formatList } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError } from "./load-state";
import { defaultPair, formatMoney, matchingPlace, meetsMinimum, moneyDifference, sameTerms } from "./offer-compare";
import { useCareerTime, useNow } from "./shared";
import { orpc } from "@/libs/orpc/client";

type Offer = SavedItem & { data: SavedData<"offer"> };
type Side = "a" | "b";

const PAIR_KEY = "career:offers-pair";

const readPair = (): { a?: string; b?: string } => {
	try {
		return JSON.parse(localStorage.getItem(PAIR_KEY) ?? "{}") as { a?: string; b?: string };
	} catch {
		return {};
	}
};

const writePair = (a: string | undefined, b: string | undefined) => {
	try {
		localStorage.setItem(PAIR_KEY, JSON.stringify({ a, b }));
	} catch {
		// Private windows can refuse storage; the pair stays in the URL.
	}
};

const companyOf = (offer: Offer) => offer.application?.company ?? t`Deleted application`;
const versionLabel = (offer: Offer) => (offer.data.version === "verbal" ? t`Verbal offer` : t`Written offer`);

type OffersPageProps = { a: string | undefined; b: string | undefined };

/** C20: two saved offers side by side, in their own currency and pay period, against the user's requirements. */
export function OffersPage({ a, b }: OffersPageProps) {
	const navigate = useNavigate();
	const query = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }));
	const profileQuery = useQuery(orpc.career.profile.queryOptions());
	const offers = query.data?.filter((item): item is Offer => item.data.kind === "offer");

	const setPair = (next: { a: string | undefined; b: string | undefined }) =>
		void navigate({ to: "/dashboard/career/offers", search: next });

	// Fill the URL with a pair: the remembered one if it still exists, else the two newest from different jobs.
	useEffect(() => {
		const offers = query.data?.filter((item) => item.data.kind === "offer");
		if (!offers?.length) return;
		const exists = (id: string | undefined) => id !== undefined && offers.some((offer) => offer.id === id);
		if (exists(a) && a !== b && (exists(b) || offers.length === 1)) {
			writePair(a, b);
			return;
		}
		const stored = readPair();
		const [first, second] =
			exists(stored.a) && exists(stored.b) && stored.a !== stored.b ? [stored.a, stored.b] : defaultPair(offers);
		// No distinct second offer leaves the right column empty, never a copy of the left.
		const nextA = exists(a) ? a : first;
		const next = { a: nextA, b: exists(b) && b !== nextA ? b : nextA === second ? first : second };
		if (next.a !== a || next.b !== b)
			void navigate({ to: "/dashboard/career/offers", search: { a: next.a, b: next.b }, replace: true });
	}, [query.data, a, b, navigate]);

	if ((query.isError && !query.data) || (profileQuery.isError && !profileQuery.data))
		return (
			<CareerLoadError
				onRetry={() => {
					void query.refetch();
					void profileQuery.refetch();
				}}
			/>
		);
	if (query.isPending || profileQuery.isPending)
		return (
			<div className="grid gap-4">
				<Skeleton className="h-9 w-2/3" />
				<Skeleton className="h-[520px] rounded-xl" />
			</div>
		);

	if (!offers?.length)
		return (
			<div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-line-2 p-7 text-center">
				<h2 className="font-display text-[22px] leading-7 font-medium">
					<Trans>No offers to compare yet</Trans>
				</h2>
				<p className="max-w-[340px] text-sm text-ink-2">
					<Trans>Paste an offer into an application's Messages tab.</Trans>
				</p>
			</div>
		);

	const left = offers.find((offer) => offer.id === a);
	const right = offers.find((offer) => offer.id === b);
	const pair = [left, right].filter((offer): offer is Offer => offer !== undefined);

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-ink-2">
					<Trans>
						Compared in their original currency and pay period. Comparing doesn't share anything with the coach.
					</Trans>
				</p>
				<div className="flex gap-2">
					<Button variant="secondary" disabled={!left || !right} onClick={() => setPair({ a: b, b: a })}>
						<Icon name="arrows-left-right" size={18} />
						<Trans>Swap</Trans>
					</Button>
					<Button
						onClick={() =>
							void navigate({
								to: "/dashboard/career/coach/{-$conversationId}",
								params: { conversationId: undefined },
								search: { offers: pair.map((offer) => offer.id) },
							})
						}
					>
						<Icon name="sparkle" size={18} />
						<Trans>Plan what to ask</Trans>
					</Button>
				</div>
			</div>

			<ComparisonTable
				offers={offers}
				left={left}
				right={right}
				onChoose={(side, id) => setPair(side === "a" ? { a: id, b } : { a, b: id })}
			/>

			<div className="grid items-start gap-5 md:grid-cols-2">
				<OpenQuestions offers={pair} />
				<p className="flex gap-3 rounded-xl bg-warn-soft p-4 text-[13px] leading-[19px] text-warn-text">
					<Icon name="info" size={18} className="mt-px shrink-0" />
					<span>
						<Trans>
							<strong className="font-semibold">Totals aren't added up on purpose.</strong> Bonus and equity depend on
							conditions, and equity value is uncertain for both. Read the original offer documents before comparing
							totals.
						</Trans>
					</span>
				</p>
			</div>
		</div>
	);
}

type Note = { icon: IconName; tone: "better" | "warn" | "muted"; text: string };
type Cell = { value: ReactNode; strong?: boolean; notes: Note[] };
type Requirement = { met: boolean | null; text: string };

const rowGrid =
	"grid md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)] md:border-t md:border-line md:first:border-t-0 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]";
/** On phones each term is its own card with both offers stacked. */
const phoneCard = "max-md:rounded-xl max-md:border max-md:border-line max-md:bg-surface";

type ComparisonTableProps = {
	offers: Offer[];
	left: Offer | undefined;
	right: Offer | undefined;
	onChoose: (side: Side, id: string) => void;
};

function ComparisonTable({ offers, left, right, onChoose }: ComparisonTableProps) {
	const cells = useCells();
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const rows = [
		{ key: "base", label: t`Base salary` },
		{ key: "variable", label: t`Bonus` },
		{ key: "equity", label: t`Equity` },
		{ key: "location", label: t`Where you work` },
		{ key: "leave", label: t`Leave` },
		{ key: "learning", label: t`Learning budget` },
		{ key: "other", label: t`Other benefits` },
		{ key: "respondBy", label: t`Respond by` },
	] as const;
	const columns = [left, right].map((offer, index) => (offer ? cells(offer, index === 0 ? right : left) : undefined));
	const { locale } = useCareerTime();
	const requirements = [left, right].map((offer) => (offer && profile ? requirementsFor(offer, profile, locale) : []));
	const hasRequirements = requirements.some((list) => list.length > 0);

	return (
		<div className="grid gap-3 md:gap-0 md:overflow-hidden md:rounded-xl md:border md:border-line md:bg-surface">
			<div className={cn(rowGrid, phoneCard, "max-md:overflow-hidden")}>
				<div className="hidden md:block" />
				{(["a", "b"] as const).map((side) => {
					const offer = side === "a" ? left : right;
					const other = side === "a" ? right : left;
					return (
						<div key={side} className="border-line max-md:not-first:border-t md:border-s">
							{offer || side === "a" ? (
								<OfferHeader offer={offer} offers={offers} otherId={other?.id} onChoose={(id) => onChoose(side, id)} />
							) : (
								<div className="m-3 grid gap-1 rounded-lg border border-dashed border-line-2 p-4">
									<p className="text-sm font-semibold">
										<Trans>Save another offer to compare</Trans>
									</p>
									<p className="text-[13px] text-ink-3">
										<Trans>Paste an offer into an application's Messages tab.</Trans>
									</p>
									{offers.length > 1 && (
										<OfferHeader
											offer={undefined}
											offers={offers}
											otherId={other?.id}
											onChoose={(id) => onChoose(side, id)}
										/>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{rows.map((row) => (
				<div key={row.key} className={cn(rowGrid, phoneCard)}>
					<div className="px-[18px] pt-3 text-[13px] text-ink-2 max-md:font-semibold max-md:text-ink md:py-3">
						{row.label}
					</div>
					{columns.map((column, index) => {
						const offer = index === 0 ? left : right;
						const cell = column?.[row.key];
						return (
							<div key={index} className={cn("border-line px-[18px] py-3 md:border-s", !offer && "max-md:hidden")}>
								{offer && cell && (
									<>
										<p className="text-xs text-ink-3 md:hidden">{companyOf(offer)}</p>
										<p className={cn("text-sm leading-[21px]", cell.strong && "font-semibold")}>{cell.value}</p>
										{cell.notes.map((note) => (
											<p
												key={note.text}
												className={cn(
													"mt-1 flex items-center gap-1 text-xs",
													note.tone === "better" && "text-accent-text",
													note.tone === "warn" && "text-warn-text",
													note.tone === "muted" && "text-ink-3",
												)}
											>
												<Icon name={note.icon} size={14} className="shrink-0" />
												{note.text}
											</p>
										))}
									</>
								)}
							</div>
						);
					})}
				</div>
			))}

			{hasRequirements && (
				<div className={cn(rowGrid, phoneCard, "bg-bg")}>
					<div className="px-[18px] pt-3 text-[13px] font-semibold md:py-3">
						<Trans>Your requirements</Trans>
					</div>
					{requirements.map((list, index) => {
						const offer = index === 0 ? left : right;
						return (
							<ul
								key={index}
								className={cn(
									"grid content-start gap-1.5 border-line px-[18px] py-3 md:border-s",
									!offer && "max-md:hidden",
								)}
							>
								{offer && <li className="text-xs text-ink-3 md:hidden">{companyOf(offer)}</li>}
								{list.map((item) => (
									<li
										key={item.text}
										className={cn(
											"flex items-center gap-1.5 text-[13px]",
											item.met === true && "text-accent-text",
											item.met === false && "text-danger-text",
											item.met === null && "text-warn-text",
										)}
									>
										<Icon
											name={item.met === true ? "check-circle" : item.met === false ? "x-circle" : "question"}
											size={15}
											className="shrink-0"
										/>
										{item.text}
									</li>
								))}
							</ul>
						);
					})}
				</div>
			)}
		</div>
	);
}

type OfferHeaderProps = {
	offer: Offer | undefined;
	offers: Offer[];
	otherId: string | undefined;
	onChoose: (id: string) => void;
};

/** The column header is the picker: every application with a saved offer, and each version of it. */
function OfferHeader({ offer, offers, otherId, onChoose }: OfferHeaderProps) {
	const { when } = useCareerTime();
	const groups = new Map<string, Offer[]>();
	for (const item of offers) {
		const key = item.applicationId ?? item.id;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					offer ? (
						<button
							type="button"
							className="flex w-full items-center gap-3 px-[18px] py-4 text-start transition-colors duration-quick hover:bg-hover aria-expanded:bg-hover"
						/>
					) : (
						<Button variant="secondary" size="sm" className="mt-2 w-fit" />
					)
				}
			>
				{offer ? (
					<>
						<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-sm font-semibold">
							{companyOf(offer).charAt(0).toLocaleUpperCase()}
						</span>
						<span className="grid min-w-0 flex-1">
							<span className="truncate text-[15px] font-semibold">{companyOf(offer)}</span>
							{offer.application?.role && (
								<span className="truncate text-[13px] text-ink-2">{offer.application.role}</span>
							)}
							<span className="text-xs text-ink-3">
								{versionLabel(offer)} · {t`saved ${when(offer.createdAt)}`}
							</span>
						</span>
						<Icon name="caret-down" size={18} className="shrink-0 text-ink-3" />
					</>
				) : (
					<Trans>Choose an offer</Trans>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-72">
				{[...groups.values()].map((versions) => {
					const [first] = versions;
					if (!first) return null;
					return (
						<DropdownMenuGroup key={first.id}>
							<DropdownMenuLabel>
								{companyOf(first)}
								{first.application?.role ? ` · ${first.application.role}` : ""}
							</DropdownMenuLabel>
							{versions.map((item) => (
								<DropdownMenuItem key={item.id} disabled={item.id === otherId} onClick={() => onChoose(item.id)}>
									<span className="flex-1">
										{versionLabel(item)} · {when(item.createdAt)}
									</span>
									{item.id === offer?.id && <Icon name="check" size={16} />}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Each term of one offer, with notes against the other column where they can be compared honestly. */
function useCells() {
	const { locale, when, relative } = useCareerTime();
	const now = useNow();

	return (offer: Offer, other: Offer | undefined): Record<string, Cell> => {
		const terms = offer.data;
		const company = companyOf(offer);
		const unknown: Cell = {
			value: <span className="text-ink-3">{t`Unknown`}</span>,
			notes: [{ icon: "question", tone: "warn", text: t`Not in the offer · ask ${company}` }],
		};
		const money = (amount: number) => {
			const value = formatMoney(locale, terms.currency, amount);
			return { hour: t`${value} an hour`, month: t`${value} a month`, year: t`${value} a year` }[terms.period];
		};
		const better = (key: "base" | "variable" | "learning"): Note[] => {
			if (!other) return [];
			const difference = moneyDifference(terms, other.data, key);
			if (difference !== null && difference > 0)
				return [{ icon: "arrow-up", tone: "better", text: t`${formatMoney(locale, terms.currency, difference)} more` }];
			if (key === "base" && difference === null && other.data.base !== null && terms.base !== null)
				return [
					{
						icon: "info",
						tone: "muted",
						text:
							terms.currency === other.data.currency
								? t`Different pay period, not compared`
								: t`Different currency, not compared`,
					},
				];
			return [];
		};
		const text = (value: string): Cell => (value.trim() ? { value, notes: [] } : unknown);

		const days = terms.officeDays;
		const office =
			days === null
				? null
				: days === 0
					? terms.location
						? null
						: t`Remote`
					: plural(days, { one: "# office day a week", other: "# office days a week" });
		const place = [terms.location.trim(), office].filter(Boolean).join(" · ");

		const respondBy = terms.respondBy ? new Date(terms.respondBy) : null;
		const hoursLeft = respondBy ? (respondBy.getTime() - now.getTime()) / 3_600_000 : null;

		return {
			base: terms.base === null ? unknown : { value: money(terms.base), strong: true, notes: better("base") },
			variable:
				terms.variable === null
					? unknown
					: {
							value: money(terms.variable),
							notes: [
								...better("variable"),
								...(terms.variableConditions.trim()
									? [{ icon: "question", tone: "warn", text: terms.variableConditions } as const]
									: []),
							],
						},
			equity: terms.equity.trim()
				? {
						value: terms.equity,
						notes: [
							{
								icon: "question",
								tone: "warn",
								// A percentage of the company is worth what the valuation says, after dilution.
								text: terms.equity.includes("%") ? t`Valuation and dilution uncertain` : t`Value uncertain`,
							},
						],
					}
				: unknown,
			location: place ? { value: place, notes: [] } : unknown,
			leave: text(terms.leave),
			learning: terms.learning === null ? unknown : { value: money(terms.learning), notes: better("learning") },
			other: text(terms.other),
			respondBy:
				respondBy && hoursLeft !== null
					? {
							value: when(respondBy),
							notes: [{ icon: "clock", tone: hoursLeft < 48 ? "warn" : "muted", text: relative(respondBy, now) }],
						}
					: unknown,
		};
	};
}

/** Checks against Preferences: minimum base (same terms only), office days, places. */
function requirementsFor(offer: Offer, profile: CareerProfileData, locale: string) {
	const terms = offer.data;
	const list: Requirement[] = [];
	const { amount, currency } = profile.minBase;
	if (amount !== null) {
		const minimum = formatMoney(locale, currency, amount);
		list.push({
			met: meetsMinimum(terms, profile.minBase),
			text: sameTerms(terms, profile.minBase) ? t`${minimum} minimum` : t`${minimum} minimum, in other terms`,
		});
	}
	if (profile.maxOfficeDays !== null && terms.officeDays !== null) {
		const days = terms.officeDays;
		const limit = profile.maxOfficeDays;
		list.push({
			met: days <= limit,
			text:
				days === 0
					? t`Remote`
					: days === limit
						? plural(days, { one: "# office day, your limit", other: "# office days, your limit" })
						: days < limit
							? plural(days, { one: "# office day, under your limit", other: "# office days, under your limit" })
							: plural(days, { one: "# office day, over your limit", other: "# office days, over your limit" }),
		});
	}
	if (profile.locations.length > 0 && terms.location.trim()) {
		const match = matchingPlace(terms.location, profile.locations);
		list.push({
			met: match ? true : null,
			text: match ? terms.location : t`${terms.location}, not one of your places`,
		});
	}
	return list;
}

type OpenQuestionsProps = { offers: Offer[] };

/** What neither offer says yet, as questions to ask, led by what the user said matters. */
function OpenQuestions({ offers }: OpenQuestionsProps) {
	const { locale } = useCareerTime();
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const names = (list: Offer[]) => formatList(locale, list.map(companyOf));

	const checks: [string, (terms: Offer["data"]) => boolean][] = [
		[t`What is the base salary, and is it negotiable?`, (terms) => terms.base === null],
		[t`Is there a bonus, and what does it depend on?`, (terms) => terms.variable === null],
		[
			t`How is the bonus decided, and how much of it was paid out last year?`,
			(terms) => terms.variable !== null && terms.variableConditions.trim() !== "",
		],
		[t`Is equity part of the offer?`, (terms) => !terms.equity.trim()],
		[
			t`What is the equity worth today: strike price, latest valuation, vesting and exercise window?`,
			(terms) => terms.equity.trim() !== "",
		],
		[t`How many days a week are expected in the office?`, (terms) => terms.officeDays === null],
		[t`How many days of leave come with it?`, (terms) => !terms.leave.trim()],
		[t`Is there a learning budget?`, (terms) => terms.learning === null],
		[t`Which other benefits come with it, like pension or allowances?`, (terms) => !terms.other.trim()],
		[t`When do they need your answer?`, (terms) => terms.respondBy === null],
	];
	const questions = checks.flatMap(([question, open]) => {
		const who = offers.filter((offer) => open(offer.data));
		return who.length
			? [{ question, ask: who.length === offers.length && offers.length > 1 ? t`Ask both` : t`Ask ${names(who)}` }]
			: [];
	});

	const priorities = profile?.priorities.trim() ?? "";
	// The first sentence keeps the lead-in short; the full text is in Preferences.
	const said = priorities.length > 160 ? (priorities.split(/(?<=[.!?])\s/)[0] ?? priorities) : priorities;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(
				questions.map((item, index) => `${index + 1}. ${item.question} · ${item.ask}`).join("\n"),
			);
			toast.add({ description: t`Questions copied` });
		} catch {
			toast.add({ type: "error", description: t`Couldn't copy the questions. Select the text and copy it manually.` });
		}
	};

	return (
		<section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
			<h2 className="text-sm font-semibold">
				<Trans>Not in either offer yet</Trans>
			</h2>
			{questions.length === 0 ? (
				<p className="text-[13px] text-ink-2">
					<Trans>Both offers cover everything compared here.</Trans>
				</p>
			) : (
				<>
					<p className="text-[13px] leading-[19px] text-ink-2">
						{said
							? offers.length > 1
								? t`You said: “${said}” Ask both companies before deciding.`
								: t`You said: “${said}” Ask before deciding.`
							: t`Ask before deciding.`}
					</p>
					<ol className="grid gap-2">
						{questions.map((item, index) => (
							<li key={item.question} className="grid grid-cols-[20px_minmax(0,1fr)] text-sm leading-[21px]">
								<span className="font-mono text-xs leading-[21px] text-ink-3">{index + 1}.</span>
								<span>
									{item.question} <span className="text-xs text-ink-3">· {item.ask}</span>
								</span>
							</li>
						))}
					</ol>
					<Button variant="secondary" size="sm" className="w-fit" onClick={() => void copy()}>
						<Icon name="copy" size={16} />
						<Trans>Copy questions</Trans>
					</Button>
				</>
			)}
		</section>
	);
}
