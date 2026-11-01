import type { SavedData, SavedItem } from "./hooks";
import type { ApplicationSummary } from "@/features/applications/types";
import type { CareerProfileData } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { selectOfferPair } from "@reactive-resume/schema/career-offer";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { formatList } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError } from "./load-state";
import { formatMoney, matchingPlace, meetsMinimum, moneyDifference, sameTerms } from "./offer-compare";
import { OfferEntry, OfferForm } from "./offer-entry";
import { useCareerTime, useNow, withUndo } from "./shared";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

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
const outcomeLabel = (offer: Offer) =>
	offer.application?.closedReason === "accepted"
		? t`Accepted`
		: offer.application?.status === "closed"
			? t`Closed`
			: offer.application?.status === "offer"
				? t`Offer`
				: t`In progress`;
const isDeciding = (offer: Offer) => offer.application?.status !== "closed";
const versionLabel = (offer: Offer) => (offer.data.version === "verbal" ? t`Verbal offer` : t`Written offer`);

type OfferStageApplicationsProps = { offers: Offer[]; applications: ApplicationSummary[] };

/**
 * Applications in the Offer stage that have no saved terms yet. They're listed so none is missed, each with its own
 * Add offer form; nothing is compared until the user enters the terms.
 */
function OfferStageApplications({ offers, applications }: OfferStageApplicationsProps) {
	const withTerms = new Set(offers.map((offer) => offer.applicationId));
	const pending = applications.filter(
		(application) => application.status === "offer" && !withTerms.has(application.id),
	);
	if (pending.length === 0) return null;

	return (
		<section aria-labelledby="offer-stage" className="grid gap-2.5">
			<div className="grid gap-0.5">
				<h2 id="offer-stage" className="text-[17px] font-semibold">
					<Trans>In the Offer stage, terms not added</Trans>
				</h2>
				<p className="text-sm text-ink-2">
					<Trans>Add each offer's terms to compare it. Nothing is filled in for you.</Trans>
				</p>
			</div>
			<ul className="grid gap-2">
				{pending.map((application) => (
					<li
						key={application.id}
						className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4"
					>
						<div className="grid min-w-0 gap-0.5">
							<p className="truncate text-sm font-semibold">{application.company}</p>
							<p className="truncate text-[13px] text-ink-2">{application.role}</p>
						</div>
						<OfferEntry application={{ id: application.id, company: application.company, role: application.role }} />
					</li>
				))}
			</ul>
		</section>
	);
}

type OffersPageProps = { a: string | undefined; b: string | undefined };

/** C20: two saved offers side by side, in their own currency and pay period, against the user's requirements. */
export function OffersPage({ a, b }: OffersPageProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const query = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }));
	const profileQuery = useQuery(orpc.career.profile.queryOptions());
	const applications = useQuery(applicationsListQueryOptions());
	const [hidden, setHidden] = useState<string[]>([]);
	const [editing, setEditing] = useState<string | null>(null);
	const offers = query.data?.filter((item): item is Offer => item.data.kind === "offer" && !hidden.includes(item.id));

	// Deleting waits out its Undo toast, as everywhere else saved work is deleted.
	const remove = (offer: Offer) => {
		setHidden((ids) => [...ids, offer.id]);
		withUndo({
			description: t`Offer deleted`,
			onUndo: () => setHidden((ids) => ids.filter((id) => id !== offer.id)),
			commit: () =>
				client.career
					.deleteSavedItem({ id: offer.id })
					.catch((error: unknown) => {
						setHidden((ids) => ids.filter((id) => id !== offer.id));
						toastError(error, t`Couldn't delete that offer. Try again.`);
					})
					.finally(() => void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() })),
		});
	};

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
		const next = selectOfferPair(offers, { a, b }, readPair());
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

	const applicationOffers = (
		<>
			{applications.isError && (
				<CareerLoadError
					onRetry={() => {
						void applications.refetch();
					}}
				/>
			)}
			{applications.isPending ? (
				<Skeleton className="h-20 rounded-xl" />
			) : (
				applications.data && <OfferStageApplications offers={offers ?? []} applications={applications.data} />
			)}
		</>
	);

	if (!offers?.length)
		return (
			<div className="grid gap-5">
				{applicationOffers}
				{applications.data && (
					<OfferEntry
						primary
						frame={(action) =>
							applications.isError ? (
								action
							) : (
								<EmptyState
									title={<Trans>No offers to compare yet</Trans>}
									description={
										<Trans>
											Add offer terms manually, including accepted offers, or use optional AI extraction in Messages.
											Closing as accepted does not record terms.
										</Trans>
									}
									action={action}
								/>
							)
						}
					/>
				)}
			</div>
		);

	const left = offers.find((offer) => offer.id === a);
	const right = offers.find((offer) => offer.id === b);
	const pair = [left, right].filter((offer): offer is Offer => offer !== undefined);
	const sameApplication = !!left?.applicationId && left.applicationId === right?.applicationId;
	const earlier = sameApplication
		? offers.filter((offer) => pair.some((item) => item.id === offer.id)).at(-1)
		: undefined;

	const edited = offers.find((offer) => offer.id === editing);

	return (
		<div className="grid gap-5">
			{applicationOffers}
			{earlier && <h2 className="text-base font-semibold">{t`Changes since ${versionLabel(earlier)}`}</h2>}
			{edited ? (
				<OfferForm
					key={edited.id}
					offer={edited}
					{...(edited.applicationId && edited.application
						? {
								application: {
									id: edited.applicationId,
									company: edited.application.company,
									role: edited.application.role,
								},
							}
						: {})}
					onClose={() => setEditing(null)}
				/>
			) : applications.data ? (
				<OfferEntry />
			) : null}
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
				onEdit={(offer) => {
					setEditing(offer.id);
					window.scrollTo({ top: 0, behavior: "smooth" });
				}}
				onDelete={remove}
			/>

			<div className="grid items-start gap-5 md:grid-cols-2">
				<OpenQuestions
					offers={
						sameApplication
							? offers.filter((offer) => pair.some((selected) => selected.id === offer.id)).slice(0, 1)
							: pair
					}
				/>
				<p className="flex gap-3 rounded-xl bg-warn-soft p-4 text-[13px] leading-[19px] text-warn-text">
					<Icon name="info" size={18} className="mt-px shrink-0" />
					<span>
						<Trans>
							<strong className="font-semibold">Totals aren't added up on purpose.</strong> Bonus and equity depend on
							conditions, and equity value is uncertain. Read the original offer documents before comparing totals.
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
	onEdit: (offer: Offer) => void;
	onDelete: (offer: Offer) => void;
};

function ComparisonTable({ offers, left, right, onChoose, onEdit, onDelete }: ComparisonTableProps) {
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
								<OfferHeader
									offer={offer}
									offers={offers}
									otherId={other?.id}
									onChoose={(id) => onChoose(side, id)}
									onEdit={onEdit}
									onDelete={onDelete}
								/>
							) : (
								<div className="m-3 grid gap-1 rounded-lg border border-dashed border-line-2 p-4">
									<p className="text-sm font-semibold">
										<Trans>Save another offer to compare</Trans>
									</p>
									<p className="text-[13px] text-ink-3">
										<Trans>
											Add offer terms manually, including accepted offers, or use optional AI extraction in Messages.
											Closing as accepted does not record terms.
										</Trans>
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
	onEdit?: (offer: Offer) => void;
	onDelete?: (offer: Offer) => void;
};

/** Where the terms came from, so a blank reads as what it is. */
const originLabel = (offer: Offer) =>
	offer.data.origin === "message"
		? offer.data.editedAt
			? t`Read from a message, edited by you`
			: t`Read from a message`
		: offer.data.origin === "manual"
			? t`Entered by you`
			: null;

/**
 * The column header is the picker: every application with a saved offer, and each version of it, and where the open
 * offer is corrected or deleted.
 */
function OfferHeader({ offer, offers, otherId, onChoose, onEdit, onDelete }: OfferHeaderProps) {
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
								{versionLabel(offer)} · {t`saved ${when(offer.createdAt)}`} · {outcomeLabel(offer)} ·{" "}
								{offers
									.filter((item) => item.applicationId === offer.applicationId)
									.findIndex((item) => item.id === offer.id) + 1}
							</span>
							{originLabel(offer) && <span className="text-xs text-ink-3">{originLabel(offer)}</span>}
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
								{first.application?.role ? ` · ${first.application.role}` : ""} · {outcomeLabel(first)}
							</DropdownMenuLabel>
							{versions.map((item) => (
								<DropdownMenuItem key={item.id} disabled={item.id === otherId} onClick={() => onChoose(item.id)}>
									<span className="flex-1">
										{versionLabel(item)} · {when(item.createdAt)} · {versions.indexOf(item) + 1}
										{item.id === first.id ? ` · ${t`Latest`}` : ""}
									</span>
									{item.id === offer?.id && <Icon name="check" size={16} />}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					);
				})}
				{offer && onEdit && onDelete && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => onEdit(offer)}>
							<Icon name="pencil-simple" size={18} />
							<Trans>Edit terms</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem variant="destructive" onClick={() => onDelete(offer)}>
							<Icon name="trash" size={18} />
							<Trans>Delete offer</Trans>
						</DropdownMenuItem>
					</>
				)}
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
		// A blank is only "not in the message" if nobody checked it by hand; typed-in blanks were left blank.
		const blank =
			terms.origin === "message" && !terms.editedAt
				? t`Not found in the message`
				: terms.origin
					? t`Left blank`
					: t`Not recorded`;
		const unknown: Cell = {
			value: <span className="text-ink-3">{isDeciding(offer) ? blank : t`Not recorded`}</span>,
			notes: isDeciding(offer) ? [{ icon: "question", tone: "warn", text: t`Ask ${company}` }] : [],
		};
		const money = (amount: number) => {
			const value = formatMoney(locale, terms.currency, amount);
			return { hour: t`${value} an hour`, month: t`${value} a month`, year: t`${value} a year` }[terms.period];
		};
		const better = (key: "base" | "variable" | "learning"): Note[] => {
			if (!other) return [];
			const difference = moneyDifference(terms, other.data, key);
			if (
				offer.applicationId &&
				offer.applicationId === other.applicationId &&
				difference !== null &&
				difference !== 0
			) {
				const delta = `${difference > 0 ? "+" : "−"}${formatMoney(locale, terms.currency, Math.abs(difference))}`;
				const version = versionLabel(other);
				return [{ icon: "info", tone: "muted", text: t`${delta} vs ${version}` }];
			}
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
					? terms.variableConditions.trim()
						? // A percentage or a condition without an amount: shown as written, never turned into money.
							{
								value: terms.variableConditions,
								notes: [{ icon: "question", tone: "warn", text: t`No amount stated · value uncertain` }],
							}
						: unknown
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
							notes: isDeciding(offer)
								? [{ icon: "clock", tone: hoursLeft < 48 ? "warn" : "muted", text: relative(respondBy, now) }]
								: [],
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
		[
			t`Is there a bonus, and what does it depend on?`,
			(terms) => terms.variable === null && !terms.variableConditions.trim(),
		],
		[
			t`How is the bonus decided, and how much of it was paid out last year?`,
			(terms) => terms.variableConditions.trim() !== "",
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
		const who = offers.filter((offer) => isDeciding(offer) && open(offer.data));
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
				{offers.length > 1 ? <Trans>Not in either offer yet</Trans> : <Trans>Open questions</Trans>}
			</h2>
			{questions.length === 0 ? (
				<p className="text-[13px] text-ink-2">
					<Trans>No questions to ask before deciding.</Trans>
				</p>
			) : (
				<>
					<p className="text-[13px] leading-[19px] text-ink-2">
						{said
							? offers.filter(isDeciding).length > 1
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
