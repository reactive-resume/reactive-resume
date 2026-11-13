import type { SavedData, SavedItem } from "./hooks";
import type { ApplicationSummary } from "@/features/applications/types";
import type { CareerProfileData } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { annualBaseHint, selectOfferPair } from "@reactive-resume/schema/career-offer";
import { Alert } from "@reactive-resume/ui/components/alert";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
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
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { formatList } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { formatDateOnly } from "@reactive-resume/utils/timezone";
import { CareerCrumb } from "./career-crumb";
import { CareerLoadError } from "./load-state";
import { formatBonus, formatMoney, matchingPlace, meetsMinimum, moneyDifference } from "./offer-compare";
import { OfferEntry, OfferForm, OfferSheet } from "./offer-entry";
import { flash, useCareerTime, useNow, withQueryUndo } from "./shared";
import { DataTable, DataTableBody, DataTableCell, DataTableRow } from "@/components/calm/data-table";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { Columns, Page, PageBody, PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { Combobox } from "@/components/ui/combobox";
import { companyInitials } from "@/features/applications/components/list-view";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

type Offer = SavedItem & { data: SavedData<"offer"> };

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

/** Where the terms came from, so a blank reads as what it is. */
const originLabel = (offer: Offer) =>
	offer.data.origin === "message"
		? offer.data.editedAt
			? t`Read from a message, edited by you`
			: t`Read from a message`
		: offer.data.origin === "manual"
			? t`Entered by you`
			: null;

/** The calendar day in the account's timezone, as a day count: deadlines are "tomorrow" by date, not by hours. */
const dayNumber = (value: Date, timeZone: string) => {
	const [year = 0, month = 1, day = 1] = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	})
		.format(value)
		.split("-")
		.map(Number);
	return Date.UTC(year, month - 1, day) / 86_400_000;
};

const shortDay = { weekday: "short", day: "numeric", month: "short" } as const;

/** "in 6 days", "tomorrow", "today" for a date, by calendar day in the account's timezone. */
function useRelativeDay() {
	const { locale, timeZone } = useCareerTime();
	const now = useNow();
	return (value: Date | string) => {
		const days = dayNumber(new Date(value), timeZone) - dayNumber(now, timeZone);
		return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
	};
}

/** The deadline leads: when the answer is due, or that no date was given. A decided offer says how it ended. */
function ReplyBadge({ offer, className }: { offer: Offer; className?: string }) {
	const { format } = useCareerTime();
	const relativeDay = useRelativeDay();
	if (!isDeciding(offer)) return <Badge className={className}>{outcomeLabel(offer)}</Badge>;
	const respondBy = offer.data.respondBy;
	if (!respondBy)
		return (
			<Badge className={className}>
				<Trans>No reply date given</Trans>
			</Badge>
		);
	const day = format(respondBy, shortDay);
	const relative = relativeDay(respondBy);
	return (
		<Badge variant="warn" className={className}>
			<Icon name="clock" />
			{t`Reply by ${day} · ${relative}`}
		</Badge>
	);
}

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
		<section aria-labelledby="offer-stage">
			<SectionHeading id="offer-stage" note={<Trans>Add each offer's terms to compare it</Trans>}>
				<Trans>In the Offer stage, terms not added</Trans>
			</SectionHeading>
			<ul className="flex flex-col">
				{pending.map((application) => (
					<li
						key={application.id}
						className="flex min-h-(--row) flex-wrap items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
					>
						<div className="grid min-w-0 gap-px">
							<p className="truncate t-row-title">{application.company}</p>
							<p className="truncate t-small text-ink-3">{application.role}</p>
						</div>
						<OfferEntry application={{ id: application.id, company: application.company, role: application.role }} />
					</li>
				))}
			</ul>
		</section>
	);
}

type OffersPageProps = { a: string | undefined; b: string | undefined; highlight?: string | undefined };

type OfferMessagesProps = { applications: ApplicationSummary[] };

function OfferMessages({ applications }: OfferMessagesProps) {
	const navigate = useNavigate();
	if (!applications.length) return null;
	return (
		<Combobox
			render={<Button variant="secondary" aria-label={t`Messages`} />}
			value={null}
			placeholder={t`Messages`}
			options={applications.map((application) => ({
				value: application.id,
				label: `${application.company} · ${application.role}`,
			}))}
			onValueChange={(applicationId) => {
				if (applicationId)
					void navigate({
						to: "/dashboard/applications/$applicationId/{-$tab}",
						params: { applicationId, tab: "messages" },
					});
			}}
		/>
	);
}

/** Shown only beside two offers, and only with an AI connection: without one the button is left out, not greyed. */
function CoachLink({ offerIds }: { offerIds: string[] }) {
	const { hasUsableProvider } = useHasUsableAiProvider();
	if (!hasUsableProvider) return null;
	return (
		<Link
			to="/dashboard/career/coach/{-$conversationId}"
			params={{ conversationId: undefined }}
			search={{ offers: offerIds }}
			className={cn(buttonVariants({ variant: "ghost" }), "max-sm:hidden")}
		>
			<Icon name="sparkle" />
			<Trans>Talk it through with the coach</Trans>
		</Link>
	);
}

/**
 * Offers (C3, C8): one saved offer reads as a page, two as columns, each in its own currency and pay period and
 * checked against the user's requirements.
 */
export function OffersPage({ a, b, highlight }: OffersPageProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const query = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }));
	const profileQuery = useQuery(orpc.career.profile.queryOptions());
	const applications = useQuery(applicationsListQueryOptions());
	const { format, timeZone } = useCareerTime();
	const now = useNow();
	const flashed = useRef<string | null>(null);
	useEffect(() => {
		if (!highlight || !query.data?.some((offer) => offer.id === highlight) || flashed.current === highlight) return;
		const element = document.querySelector(`[data-offer="${CSS.escape(highlight)}"]`);
		if (!element) return;
		flashed.current = highlight;
		flash(element);
	}, [highlight, query.data]);
	const [hidden, setHidden] = useState<string[]>([]);
	const [editing, setEditing] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const offers = query.data?.filter((item): item is Offer => item.data.kind === "offer" && !hidden.includes(item.id));

	// Deleting waits out its Undo toast, as everywhere else saved work is deleted.
	const remove = (offer: Offer) => {
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.savedItems.key(),
			description: t`Offer deleted`,
			errorMessage: t`Couldn't delete that offer. Try again.`,
			prepare: () => prepareRpc(client.career.deleteSavedItem, { id: offer.id }),
			hide: () => setHidden((ids) => [...ids, offer.id]),
			restore: () => setHidden((ids) => ids.filter((id) => id !== offer.id)),
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

	const failed = (query.isError && !query.data) || (profileQuery.isError && !profileQuery.data);
	const loading = !failed && (query.isPending || profileQuery.isPending);
	const ready = !failed && !loading && offers !== undefined;

	const left = offers?.find((offer) => offer.id === a);
	const right = offers?.find((offer) => offer.id === b);
	// Two versions of one offer aren't two offers: the page shows one and says what changed between them.
	const sameApplication = !!left?.applicationId && left.applicationId === right?.applicationId;
	const comparing = left && right && !sameApplication ? ([left, right] as const) : undefined;
	const shown = comparing ? undefined : (left ?? right);
	const edited = offers?.find((offer) => offer.id === editing);
	const menu = { offers: offers ?? [], onEdit: (offer: Offer) => setEditing(offer.id), onDelete: remove };

	// The offer whose answer is due first leads the line under the title.
	const due = comparing
		?.filter((offer) => isDeciding(offer) && offer.data.respondBy)
		.toSorted((x, y) => String(x.data.respondBy).localeCompare(String(y.data.respondBy)))[0];
	const dueCompany = due ? companyOf(due) : "";
	const relativeDay = useRelativeDay();
	const dueDate = due?.data.respondBy ? new Date(due.data.respondBy) : null;
	const dueSoon = dueDate && dayNumber(dueDate, timeZone) - dayNumber(now, timeZone) <= 1;
	const dueDay = dueDate ? (dueSoon ? relativeDay(dueDate) : format(dueDate, shortDay)) : "";

	return (
		<Page>
			<PageBody>
				<PageHeader
					crumb={<CareerCrumb />}
					title={<Trans>Offers</Trans>}
					actions={
						<>
							{comparing && <CoachLink offerIds={comparing.map((offer) => offer.id)} />}
							{applications.data && (
								<OfferEntry
									primary={ready && offers.length === 0}
									initialOpen={adding}
									onDone={() => setAdding(false)}
								/>
							)}
							<PhoneHeaderActions />
						</>
					}
				/>
				{/* calm: request to lead — PageHeader's subtitle is a flex row, which splits a sentence around its link. */}
				<p className="pt-0.5 text-sm text-ink-3">
					{!ready ? undefined : comparing ? (
						<>
							<Trans>Two offers, each in its own currency and pay period.</Trans>
							{due && <> {t`${dueCompany} needs an answer by ${dueDay}.`}</>}
						</>
					) : shown ? (
						<>
							<Trans>
								One offer so far. Add another to{" "}
								<button
									type="button"
									className="inline rounded-xs font-medium text-accent-text hover:underline"
									onClick={() => setAdding(true)}
								>
									compare them side by side
								</button>
								.
							</Trans>
						</>
					) : undefined}
				</p>

				{failed ? (
					<div className="pt-4">
						<CareerLoadError
							onRetry={() => {
								void query.refetch();
								void profileQuery.refetch();
							}}
						/>
					</div>
				) : loading ? (
					<div className="grid gap-4 pt-4">
						<Skeleton className="h-[90px] rounded-xl" />
						<Skeleton className="h-[420px] rounded-xl" />
					</div>
				) : (
					<>
						{applications.isError && (
							<div className="pt-4">
								<CareerLoadError onRetry={() => void applications.refetch()} />
							</div>
						)}
						{applications.isPending ? (
							<Skeleton className="mt-4 h-14 rounded-md" />
						) : (
							applications.data && <OfferStageApplications offers={offers ?? []} applications={applications.data} />
						)}

						{comparing ? (
							<Comparison pair={comparing} menu={menu} onPair={setPair} />
						) : shown ? (
							<OneOffer offer={shown} menu={menu} onPair={setPair} />
						) : (
							!applications.isError && (
								<EmptyState
									className="mt-6"
									title={<Trans>No offers to compare yet</Trans>}
									description={
										<Trans>
											Add offer terms manually, including accepted offers, or paste the offer email in an application's
											Messages tab and choose Read it for me to use AI. Closing as accepted does not record terms.
										</Trans>
									}
									secondary={<OfferMessages applications={applications.data ?? []} />}
								/>
							)
						)}
					</>
				)}

				<OfferSheet open={!!edited} onClose={() => setEditing(null)}>
					{edited && (
						<OfferForm
							key={edited.id}
							sheet
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
					)}
				</OfferSheet>
			</PageBody>
		</Page>
	);
}

type Pair = { a: string | undefined; b: string | undefined };
type MenuProps = { offers: Offer[]; onEdit: (offer: Offer) => void; onDelete: (offer: Offer) => void };

type OfferMenuProps = MenuProps & {
	offer: Offer;
	/** The offer in the other column, which can't be chosen twice. */
	otherId?: string | undefined;
	onChoose: (id: string) => void;
};

/** An offer's ⋯: every saved offer and each version of it to show instead, then Edit terms and Delete. */
function OfferMenu({ offer, offers, otherId, onChoose, onEdit, onDelete }: OfferMenuProps) {
	const { format } = useCareerTime();
	const company = companyOf(offer);
	const groups = new Map<string, Offer[]>();
	for (const item of offers) {
		const key = item.applicationId ?? item.id;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<IconButton icon="dots-three" size="icon-sm" label={t`More for the ${company} offer`} />}
			/>
			<DropdownMenuContent align="end" className="w-72">
				{offers.length > 1 &&
					[...groups.values()].map((versions) => {
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
											{versionLabel(item)} · {format(item.createdAt, shortDay)}
											{item.id === first.id ? ` · ${t`Latest`}` : ""}
										</span>
										{item.id === offer.id && <Icon name="check" size={16} />}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
						);
					})}
				{offers.length > 1 && <DropdownMenuSeparator />}
				<DropdownMenuItem onClick={() => onEdit(offer)}>
					<Icon name="pencil-simple" />
					<Trans>Edit terms</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem variant="destructive" onClick={() => onDelete(offer)}>
					<Icon name="trash" />
					<Trans>Delete offer</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type Note = { icon: IconName; tone: "better" | "warn" | "muted"; text: string };
type Cell = { value: ReactNode; plain: string | null; strong?: boolean; notes: Note[] };

/** A worded badge beside or under a term: a gap to ask about, or what is better and by how much. */
function TermNote({ note }: { note: Note }) {
	if (note.tone === "muted") return <span className="t-caption text-ink-3">{note.text}</span>;
	return (
		<Badge variant={note.tone === "better" ? "accent" : "warn"} className="h-auto min-h-5 whitespace-normal">
			<Icon name={note.icon} />
			{note.text}
		</Badge>
	);
}

const TERM_ROWS = () =>
	[
		{ key: "base", label: t`Base salary` },
		{ key: "variable", label: t`Bonus` },
		{ key: "equity", label: t`Equity` },
		{ key: "location", label: t`Where you work` },
		{ key: "leave", label: t`Leave` },
		{ key: "learning", label: t`Learning budget` },
		{ key: "other", label: t`Other benefits` },
		{ key: "startDate", label: t`Starts` },
	] as const;

type OneOfferProps = { offer: Offer; menu: MenuProps; onPair: (pair: Pair) => void };

/** C3: one offer as a page. The deadline leads, terms are label and value rows, gaps are named where they are. */
function OneOffer({ offer, menu, onPair }: OneOfferProps) {
	const cells = useCells();
	const { locale } = useCareerTime();
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const applications = useQuery(applicationsListQueryOptions());
	const company = companyOf(offer);
	const column = cells(offer, undefined);
	const requirements = profile ? requirementsFor(offer, profile, locale) : [];
	const met = requirements.filter((item) => item.met === true).length;
	const place = applications.data?.find((row) => row.id === offer.applicationId)?.location;
	const origin = originLabel(offer);

	// Newest first. With an earlier version chosen, the page shows it and says what the latest changed since.
	const versions = offer.applicationId
		? menu.offers.filter((item) => item.applicationId === offer.applicationId)
		: [offer];
	const latest = versions[0] ?? offer;
	const others = menu.offers.some((item) => item.applicationId !== offer.applicationId);
	const [head, base] = offer.id === latest.id ? [offer, versions[1]] : [latest, offer];
	const choose = (id: string) =>
		// Beside offers from other jobs, a second version keeps the page on this one offer.
		onPair({ a: id, b: others ? versions.find((item) => item.id !== id)?.id : undefined });

	return (
		<>
			{/* calm: request to lead — HeroCard has no leading slot for the company tile, so the hero is drawn here. */}
			<section
				data-design="hero"
				data-offer={offer.id}
				className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-surface px-6 py-5 shadow-e1"
			>
				<IconTile className="max-sm:hidden">{companyInitials(company)}</IconTile>
				<div className="flex min-w-0 flex-1 flex-col max-sm:basis-full">
					<h2 className="truncate t-heading">{company}</h2>
					<p className="truncate text-sm/5 text-ink-2">
						{[offer.application?.role, place].filter(Boolean).join(" · ")}
					</p>
				</div>
				<ReplyBadge offer={offer} />
				<div className="flex items-center gap-1">
					{offer.applicationId && (
						<Link
							to="/dashboard/applications/$applicationId/{-$tab}"
							params={{ applicationId: offer.applicationId, tab: undefined }}
							className={buttonVariants({ variant: "ghost" })}
						>
							<Trans>Open application</Trans>
							<Icon name="caret-right" />
						</Link>
					)}
					{menu.offers.length > 1 && (
						<OfferMenu offer={offer} {...menu} onChoose={(id) => onPair({ a: id, b: undefined })} />
					)}
				</div>
			</section>

			<Columns className="mt-2" aside={<Questions offers={[versions.length > 1 ? latest : offer]} />}>
				<SectionHeading
					first
					note={[versionLabel(offer), origin].filter(Boolean).join(" · ")}
					action={
						<button type="button" className="rounded-xs hover:underline" onClick={() => menu.onEdit(offer)}>
							<Trans>Edit</Trans>
						</button>
					}
				>
					<Trans>Terms</Trans>
				</SectionHeading>
				<dl className="flex flex-col">
					{TERM_ROWS().map((row) => {
						const cell = column[row.key];
						// Other benefits is rarely stated: without any, the row stays out and Open questions asks about it.
						if (!cell || (row.key === "other" && cell.plain === null)) return null;
						return (
							<div
								key={row.key}
								className="flex min-h-(--row) flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-line py-2.5 last:border-b-0"
							>
								<dt className="w-[180px] shrink-0 text-sm/5 text-ink-3 max-sm:w-full">{row.label}</dt>
								<dd className={cn("min-w-0 text-[15px]/[22px]", cell.strong && "font-medium")}>{cell.value}</dd>
								{cell.notes.map((note) => (
									<TermNote key={note.text} note={note} />
								))}
							</div>
						);
					})}
				</dl>

				{versions.length > 1 && (
					<Versions versions={versions} shown={offer} onChoose={choose} onEdit={menu.onEdit} onDelete={menu.onDelete} />
				)}
				{base && <Changes head={head} base={base} />}

				{requirements.length > 0 && (
					<>
						<SectionHeading
							note={t`${i18n.number(met)} of ${i18n.number(requirements.length)} met`}
							action={
								<Link to="/dashboard/career/knowledge/preferences" className="inline-block rounded-xs hover:underline">
									<Trans>Edit requirements</Trans>
								</Link>
							}
						>
							<Trans>Against your requirements</Trans>
						</SectionHeading>
						<List>
							{requirements.map((item) => (
								<ListRow
									key={item.key}
									leading={<RequirementIcon met={item.met} size={20} />}
									title={item.label}
									value={item.detail ?? item.text}
								/>
							))}
						</List>
					</>
				)}
				{menu.offers.length === 1 && (
					<Button variant="danger-text" size="sm" className="-ms-2.5 mt-6" onClick={() => menu.onDelete(offer)}>
						<Icon name="trash" />
						<Trans>Delete offer</Trans>
					</Button>
				)}
			</Columns>
		</>
	);
}

type VersionsProps = {
	versions: Offer[];
	shown: Offer;
	onChoose: (id: string) => void;
	onEdit: (offer: Offer) => void;
	onDelete: (offer: Offer) => void;
};

/** An offer's versions (C10): editing never overwrites, so each saved version stays here to look at again. */
function Versions({ versions, shown, onChoose, onEdit, onDelete }: VersionsProps) {
	const { format } = useCareerTime();
	return (
		<>
			<SectionHeading note={i18n.number(versions.length)}>
				<Trans>Versions</Trans>
			</SectionHeading>
			<div role="radiogroup" aria-label={t`Versions`} className="flex flex-col">
				{versions.map((item, index) => {
					const selected = item.id === shown.id;
					const company = companyOf(item);
					const saved = format(item.createdAt, shortDay);
					return (
						<div
							key={item.id}
							className="flex min-h-(--row) items-center gap-3.5 border-b border-line py-2.5 last:border-b-0"
						>
							<button
								type="button"
								role="radio"
								aria-checked={selected}
								onClick={() => onChoose(item.id)}
								className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xs text-start"
							>
								<span
									aria-hidden="true"
									className={cn(
										"grid size-5 shrink-0 place-items-center rounded-full border",
										selected ? "border-accent" : "border-(--control-border)",
									)}
								>
									{selected && <span className="size-2.5 rounded-full bg-accent" />}
								</span>
								<span className="flex min-w-0 flex-col gap-px">
									<span className="truncate t-row-title">{t`${versionLabel(item)} · saved ${saved}`}</span>
									<span className="truncate t-small text-ink-3">
										{[originLabel(item), outcomeLabel(item)].filter(Boolean).join(" · ")}
									</span>
								</span>
							</button>
							{index === 0 && (
								<Badge variant="accent">
									<Trans>Latest</Trans>
								</Badge>
							)}
							{selected && (
								<button
									type="button"
									className="rounded-xs text-sm font-medium text-accent-text hover:underline"
									onClick={() => onEdit(item)}
								>
									<Trans>Edit terms</Trans>
								</button>
							)}
							<DropdownMenu>
								<DropdownMenuTrigger
									render={<IconButton icon="dots-three" size="icon-sm" label={t`More for the ${company} offer`} />}
								/>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => onEdit(item)}>
										<Icon name="pencil-simple" />
										<Trans>Edit terms</Trans>
									</DropdownMenuItem>
									<DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>
										<Icon name="trash" />
										<Trans>Delete offer</Trans>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				})}
			</div>
		</>
	);
}

/** What a later version changed: the term, what it says now, and what it said before. */
function Changes({ head, base }: { head: Offer; base: Offer }) {
	const cells = useCells();
	const { locale } = useCareerTime();
	const now = cells(head, undefined);
	const before = cells(base, undefined);
	const rows = [...TERM_ROWS(), { key: "respondBy", label: t`Respond by` } as const].filter(
		(row) => now[row.key]?.plain !== before[row.key]?.plain,
	);

	const note = (key: string) => {
		const difference =
			key === "base" || key === "variable" || key === "learning" ? moneyDifference(head.data, base.data, key) : null;
		const amount = difference ? formatMoney(locale, head.data.currency, Math.abs(difference)) : "";
		const old = before[key]?.plain;
		if (difference) return difference > 0 ? t`${amount} more` : t`${amount} less`;
		return old ? t`Was ${old}` : t`Was left blank`;
	};

	// More money than before reads in accent; less, or a changed word, stays quiet.
	const gained = (key: string) =>
		(key === "base" || key === "variable" || key === "learning") &&
		(moneyDifference(head.data, base.data, key) ?? 0) > 0;

	return (
		<>
			<SectionHeading>{t`Changes since ${versionLabel(base)}`}</SectionHeading>
			{rows.length === 0 ? (
				<p className="t-small text-ink-3">
					<Trans>Nothing changed between these versions.</Trans>
				</p>
			) : (
				<dl className="flex flex-col">
					{rows.map((row) => (
						<div
							key={row.key}
							className="flex min-h-11 flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-line py-2 last:border-b-0"
						>
							<dt className="w-[180px] shrink-0 text-sm/5 text-ink-3 max-sm:w-full">{row.label}</dt>
							<dd className="min-w-0 flex-1 text-sm/5">{now[row.key]?.value}</dd>
							<dd className={cn("t-small", gained(row.key) ? "text-accent-text" : "text-ink-3")}>{note(row.key)}</dd>
						</div>
					))}
				</dl>
			)}
		</>
	);
}

function RequirementIcon({ met, size }: { met: boolean | null; size: number }) {
	return (
		<Icon
			name={met === true ? "check-circle" : met === false ? "x-circle" : "question"}
			size={size}
			className={cn("shrink-0", met === true ? "text-accent-text" : "text-warn-text")}
		/>
	);
}

type ComparisonProps = { pair: readonly [Offer, Offer]; menu: MenuProps; onPair: (pair: Pair) => void };

const COMPARE_COLUMNS = "136px minmax(0,1fr) minmax(0,1fr)";
/** Rows of the comparison stand at the top of their line and take no hover ground: nothing in them opens. */
const compareTable = "max-sm:grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)]! max-sm:gap-x-3";
const compareRow = "min-h-11 items-start py-2 hover:border-line hover:before:bg-transparent last:border-b-0";
const compareLabel = "text-[13px]/5 font-normal text-ink-3";

/** C8: two offers as columns. Money is only called better in the same currency and pay period. */
function Comparison({ pair, menu, onPair }: ComparisonProps) {
	const cells = useCells();
	const { locale } = useCareerTime();
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const [left, right] = pair;
	const columns = [cells(left, right), cells(right, left)];
	const requirements = pair.map((offer) => (profile ? requirementsFor(offer, profile, locale) : []));
	const met = requirements.map((list) => i18n.number(list.filter((item) => item.met === true).length));
	const total = i18n.number(requirements[0]?.length ?? 0);
	const [first, second] = [companyOf(left), companyOf(right)];

	return (
		<Columns className="mt-3 xl:grid-cols-[minmax(0,1fr)_320px]" aside={<Questions offers={pair} />}>
			<DataTable columns={COMPARE_COLUMNS} aria-label={t`Offers side by side`} className={compareTable}>
				<DataTableBody>
					<DataTableRow className={cn(compareRow, "pt-3 pb-3.5")}>
						<DataTableCell>
							<Button variant="ghost" size="sm" className="-ms-2.5" onClick={() => onPair({ a: right.id, b: left.id })}>
								<Icon name="arrows-left-right" />
								<Trans>Swap</Trans>
							</Button>
						</DataTableCell>
						{pair.map((offer, index) => {
							const other = pair[index === 0 ? 1 : 0];
							return (
								<th
									key={offer.id}

									scope="col"
									data-offer={offer.id}
									className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 p-0 text-start font-normal max-sm:gap-x-1"
								>
									<IconTile className="max-sm:hidden">{companyInitials(companyOf(offer))}</IconTile>
									<span className="col-start-2 flex min-w-0 flex-col gap-px">
										<span className="truncate text-[15px]/[22px] font-semibold">{companyOf(offer)}</span>
										{offer.application?.role && (
											<span className="truncate t-small text-ink-3">{offer.application.role}</span>
										)}
										<OfferDate offer={offer} />
									</span>
									<OfferMenu
										offer={offer}
										{...menu}
										otherId={other.id}
										onChoose={(id) => onPair(index === 0 ? { a: id, b: other.id } : { a: other.id, b: id })}
									/>
									<ReplyBadge
										offer={offer}
										className="col-span-2 col-start-2 mt-1.5 h-auto min-h-5 justify-start whitespace-normal"
									/>
								</th>
							);
						})}
					</DataTableRow>
					{TERM_ROWS()
						.filter((row) => row.key !== "other" || columns.some((column) => column.other?.plain != null))
						.map((row) => (
							<DataTableRow key={row.key} className={compareRow}>
								<DataTableCell header className={compareLabel}>
									{row.label}
								</DataTableCell>
								{columns.map((column, index) => {
									const cell = column[row.key];
									return (
										<DataTableCell key={index} className="flex-col items-start gap-1">
											<span className={cn("text-sm/5", cell?.strong && "font-semibold")}>{cell?.value}</span>
											{cell?.notes.map((note) => (
												<TermNote key={note.text} note={note} />
											))}
										</DataTableCell>
									);
								})}
							</DataTableRow>
						))}
				</DataTableBody>
			</DataTable>

			{requirements[0] && requirements[0].length > 0 && (
				<>
					<SectionHeading
						className="pt-[22px]"
						note={t`${first} meets ${met[0] ?? ""} of ${total} · ${second} ${met[1] ?? ""} of ${total}`}
						action={
							<Link to="/dashboard/career/knowledge/preferences" className="inline-block rounded-xs hover:underline">
								<Trans>Edit</Trans>
							</Link>
						}
					>
						<Trans>Against your requirements</Trans>
					</SectionHeading>
					<DataTable
						columns={COMPARE_COLUMNS}
						aria-label={t`Your requirements, checked for each offer`}
						className={compareTable}
					>
						<DataTableBody>
							{requirements[0].map((requirement, row) => (
								<DataTableRow key={requirement.key} className={compareRow}>
									<DataTableCell header className={compareLabel}>
										{requirement.label}
									</DataTableCell>
									{requirements.map((list, index) => (
										<DataTableCell key={index} className="items-start gap-1.5 text-sm/5">
											<RequirementIcon met={list[row]?.met ?? null} size={18} />
											{list[row]?.text}
										</DataTableCell>
									))}
								</DataTableRow>
							))}
						</DataTableBody>
					</DataTable>
				</>
			)}
		</Columns>
	);
}

/** "Written offer · 5 Nov", or "today" on the day it was saved. */
function OfferDate({ offer }: { offer: Offer }) {
	const { format, timeZone } = useCareerTime();
	const now = useNow();
	const saved = new Date(offer.createdAt);
	const today = dayNumber(saved, timeZone) === dayNumber(now, timeZone);
	return (
		<span className="truncate t-small text-ink-3">
			{versionLabel(offer)} · {today ? t`today` : format(saved, { day: "numeric", month: "short" })}
		</span>
	);
}

/** Each term of one offer, with notes against the other column where they can be compared honestly. */
function useCells() {
	const { locale, when } = useCareerTime();

	return (offer: Offer, other: Offer | undefined): Record<string, Cell> => {
		const terms = offer.data;
		const company = companyOf(offer);
		// A blank is only "not in the message" if nobody checked it by hand; typed-in blanks were left blank.
		const blank = terms.origin === "message" && !terms.editedAt ? t`Not found in the message` : t`Not recorded`;
		const unknown: Cell = {
			value: <span className="text-ink-3">{isDeciding(offer) ? blank : t`Not recorded`}</span>,
			plain: null,
			notes: isDeciding(offer) ? [{ icon: "question", tone: "warn", text: t`Ask ${company}` }] : [],
		};
		const money = (amount: number) => {
			const value = formatMoney(locale, terms.currency, amount);
			return { hour: t`${value} an hour`, month: t`${value} a month`, year: t`${value} a year` }[terms.period];
		};
		const better = (key: "base" | "variable" | "learning"): Note[] => {
			if (!other) return [];
			const annual = annualBaseHint(terms, other.data);
			const months = new Intl.NumberFormat(locale).format(12);
			const yearly = annual === null ? "" : formatMoney(locale, terms.currency, annual);
			const monthly = terms.base === null ? "" : formatMoney(locale, terms.currency, terms.base);
			const difference = moneyDifference(terms, other.data, key);
			if (difference !== null && difference > 0) {
				const more = formatMoney(locale, terms.currency, difference);
				return [{ icon: "arrow-up", tone: "better", text: t`Better for you · ${more} more` }];
			}
			if (key === "base" && difference === null && terms.base !== null && (other.data.base !== null || annual !== null))
				return [
					{
						icon: "info",
						tone: "muted",
						text:
							terms.currency === other.data.currency
								? t`Different pay period, not compared`
								: t`Different currency, not compared`,
					},
					...(annual === null
						? []
						: [{ icon: "info", tone: "muted", text: t`≈ ${yearly} a year (${months} × ${monthly})` } as const]),
				];
			return [];
		};
		const cell = (value: string, extra: Partial<Cell> = {}): Cell => ({ value, plain: value, notes: [], ...extra });
		const text = (value: string): Cell => (value.trim() ? cell(value) : unknown);
		// A bonus that says nothing about what it depends on is a gap, named on the term itself.
		const conditions: Note = terms.variableConditions.trim()
			? { icon: "question", tone: "warn", text: terms.variableConditions }
			: { icon: "question", tone: "warn", text: t`Conditions not stated` };

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

		return {
			base: terms.base === null ? unknown : cell(money(terms.base), { strong: true, notes: better("base") }),
			variable:
				terms.variablePercent != null
					? cell(formatBonus(locale, terms) ?? "", { notes: [...better("variable"), conditions] })
					: terms.variable === null
						? terms.variableConditions.trim()
							? // A condition without an amount: shown as written, never turned into money.
								cell(terms.variableConditions, {
									notes: [{ icon: "question", tone: "warn", text: t`No amount stated · value uncertain` }],
								})
							: unknown
						: cell(money(terms.variable), { notes: [...better("variable"), conditions] }),
			equity: terms.equity.trim()
				? cell(terms.equity, {
						notes: [
							{
								icon: "question",
								tone: "warn",
								// A percentage of the company is worth what the valuation says, after dilution.
								text: terms.equity.includes("%") ? t`Valuation and dilution uncertain` : t`Value uncertain`,
							},
						],
					})
				: unknown,
			location: place ? cell(place) : unknown,
			leave: text(terms.leave),
			learning: terms.learning === null ? unknown : cell(money(terms.learning), { notes: better("learning") }),
			other: text(terms.other),
			startDate: terms.startDate ? cell(formatDateOnly(terms.startDate, locale)) : unknown,
			respondBy: terms.respondBy ? cell(when(terms.respondBy)) : unknown,
		};
	};
}

type Requirement = {
	key: "base" | "office" | "place";
	/** The requirement, as Preferences states it. */
	label: string;
	met: boolean | null;
	/** How the offer stands against it. */
	text: string;
	/** The same in a full sentence, where one offer has the line to itself. */
	detail?: string;
};

/** Checks against Preferences: minimum base (same terms only), office days, places. */
function requirementsFor(offer: Offer, profile: CareerProfileData, locale: string) {
	const terms = offer.data;
	const list: Requirement[] = [];
	const { amount, currency } = profile.minBase;
	if (amount !== null) {
		const minimum = formatMoney(locale, currency, amount);
		const label = t`${minimum} minimum`;
		const met = meetsMinimum(terms, profile.minBase);
		if (terms.base === null) list.push({ key: "base", label, met, text: t`Base salary not stated` });
		else if (met === null) list.push({ key: "base", label, met, text: t`In other terms, not compared` });
		else {
			const gap = formatMoney(locale, currency, Math.abs(terms.base - amount));
			list.push(
				terms.base === amount
					? { key: "base", label, met, text: t`Exactly the minimum` }
					: met
						? { key: "base", label, met, text: t`${gap} above it`, detail: t`Base is ${gap} above it` }
						: { key: "base", label, met, text: t`${gap} below it`, detail: t`Base is ${gap} below it` },
			);
		}
	}
	if (profile.maxOfficeDays !== null) {
		const days = terms.officeDays;
		const limit = profile.maxOfficeDays;
		list.push({
			key: "office",
			label:
				limit === 0
					? t`Remote only`
					: plural(limit, { one: "At most # office day a week", other: "At most # office days a week" }),
			met: days === null ? null : days <= limit,
			text:
				days === null
					? t`Office days not stated`
					: days === 0
						? t`Remote`
						: days === limit
							? plural(days, { one: "# office day, your limit", other: "# office days, your limit" })
							: days < limit
								? plural(days, { one: "# office day, under your limit", other: "# office days, under your limit" })
								: plural(days, { one: "# office day, over your limit", other: "# office days, over your limit" }),
		});
	}
	if (profile.locations.length > 0) {
		const where = terms.location.trim();
		const match = where ? matchingPlace(where, profile.locations) : undefined;
		list.push({
			key: "place",
			label:
				typeof Intl.ListFormat === "function"
					? new Intl.ListFormat(locale, { type: "disjunction" }).format(
							profile.locations.map((place) => (place.toLowerCase() === "remote" ? t`remote` : place)),
						)
					: profile.locations.join(", "),
			met: match ? true : null,
			text: !where ? t`Place not stated` : match ? where : t`${where}, not one of your places`,
		});
	}
	return list;
}

type Question = { question: string; why: string; who: Offer[] };

/** What the offers don't say yet, as questions to ask, each with the gap it comes from. */
function openQuestions(offers: Offer[], locale: string): Question[] {
	const missing = t`The offer doesn't say.`;
	const checks = (terms: Offer["data"]): [string, string, boolean][] => {
		const hasBonus = terms.variable !== null || terms.variablePercent != null;
		const hasConditions = terms.variableConditions.trim() !== "";
		const percent =
			terms.variablePercent == null
				? ""
				: new Intl.NumberFormat(locale, { style: "percent", maximumSignificantDigits: 21 }).format(
						terms.variablePercent / 100,
					);
		return [
			[t`What is the base salary, and is it negotiable?`, t`The offer gives no base salary.`, terms.base === null],
			[
				t`Is there a bonus, and what does it depend on?`,
				t`The offer doesn't mention a bonus.`,
				!hasBonus && !hasConditions,
			],
			[
				t`What does the ${percent} bonus depend on, and when is it paid?`,
				t`The offer gives a percentage and no conditions.`,
				terms.variablePercent != null && !hasConditions,
			],
			[
				t`What does the bonus depend on, and when is it paid?`,
				t`The offer gives an amount and no conditions.`,
				terms.variable !== null && terms.variablePercent == null && !hasConditions,
			],
			[
				t`How is the bonus decided, and how much of it was paid out last year?`,
				t`The bonus depends on conditions.`,
				hasConditions,
			],
			[t`Is equity part of the offer?`, t`The offer doesn't mention equity.`, !terms.equity.trim()],
			[
				offers.length > 1
					? t`What is the equity worth today: strike price, latest valuation, vesting and exercise window?`
					: t`What are the options worth today: strike price, latest valuation, vesting and exercise window?`,
				t`The offer names equity without a value.`,
				terms.equity.trim() !== "",
			],
			[t`How many days a week are expected in the office?`, missing, terms.officeDays === null],
			[t`How many days of leave come with it?`, missing, !terms.leave.trim()],
			[t`Is there a learning budget?`, missing, terms.learning === null],
			[
				t`Which other benefits come with it, like pension or allowances?`,
				missing,
				offers.length > 1 && !terms.other.trim(),
			],
			// Both unknown: one question, as a reply would ask it.
			[
				t`When would you start, and when do you need my answer?`,
				missing,
				terms.startDate === null && terms.respondBy === null,
			],
			[t`When would you start?`, missing, terms.startDate === null && terms.respondBy !== null],
			[t`When do they need your answer?`, missing, terms.respondBy === null && terms.startDate !== null],
		];
	};
	// In the order of the terms, so both companies' questions about one term sit together.
	const deciding = offers.filter(isDeciding).map((offer) => ({ offer, list: checks(offer.data) }));
	const questions = new Map<string, Question>();
	for (let index = 0; index < (deciding[0]?.list.length ?? 0); index++)
		for (const { offer, list } of deciding) {
			const [question, why, open] = list[index] ?? ["", "", false];
			if (!open) continue;
			const known = questions.get(question);
			if (known) known.who.push(offer);
			else questions.set(question, { question, why, who: [offer] });
		}
	return [...questions.values()];
}

type QuestionsProps = { offers: readonly Offer[] };

/** The aside: open questions, the way to send them to each company, and why totals aren't added up. */
function Questions({ offers }: QuestionsProps) {
	const navigate = useNavigate();
	const { locale } = useCareerTime();
	const two = offers.length > 1;
	const questions = openQuestions([...offers], locale);
	const count = (offer: Offer) => questions.filter((item) => item.who.includes(offer)).length;
	// The company with the most gaps is the next step, so its button takes the accent.
	const askable = offers.filter((offer) => count(offer) > 0).toSorted((x, y) => count(y) - count(x));
	const ask = (item: Question) =>
		item.who.length === offers.length ? t`Ask both` : t`Ask ${formatList(locale, item.who.map(companyOf))}`;

	const numbered = (list: Question[], suffix: (item: Question) => string) =>
		list.map((item, index) => `${index + 1}. ${item.question}${suffix(item)}`).join("\n");
	const copy = async (text: string, done: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.add({ description: done });
			return true;
		} catch {
			toast.add({ type: "error", description: t`Couldn't copy the questions. Select the text and copy it manually.` });
			return false;
		}
	};
	const copyAll = () =>
		void copy(
			numbered(questions, (item) => (two ? ` · ${ask(item)}` : "")),
			t`Questions copied`,
		);
	// Messages takes no prefilled draft yet, so the questions travel on the clipboard and the page opens beside them.
	const write = async (offer: Offer) => {
		if (!offer.applicationId) return;
		const company = companyOf(offer);
		await copy(
			numbered(
				questions.filter((item) => item.who.includes(offer)),
				() => "",
			),
			t`Questions copied. Paste them into your message to ${company}.`,
		);
		void navigate({
			to: "/dashboard/applications/$applicationId/{-$tab}",
			params: { applicationId: offer.applicationId, tab: "messages" },
		});
	};

	const totals = two ? (
		<p className="mt-3.5 border-t border-line pt-3.5 t-small text-ink-3">
			<Trans>
				Totals aren't added up on purpose: bonus and equity depend on conditions. Read the offer documents before
				comparing totals.
			</Trans>
		</p>
	) : (
		<Alert variant="info" className="mt-6">
			<Icon name="info" />
			<span>
				<Trans>
					Totals aren't added up on purpose. Bonus and equity depend on conditions; read the offer documents before
					comparing.
				</Trans>
			</span>
		</Alert>
	);

	return (
		<>
			<SectionHeading
				first
				className={cn(two && "pt-3")}
				note={
					questions.length === 0
						? undefined
						: two
							? plural(questions.length, { one: "# question", other: "# questions" })
							: i18n.number(questions.length)
				}
			>
				{two ? <Trans>Still to ask</Trans> : <Trans>Open questions</Trans>}
			</SectionHeading>
			{questions.length === 0 ? (
				<p className="t-small text-ink-3">
					<Trans>No questions to ask before deciding.</Trans>
				</p>
			) : (
				<>
					<ol className="flex flex-col">
						{questions.map((item, index) => (
							<li
								key={item.question}
								className={cn(
									"flex items-start border-b border-line last:border-b-0",
									two ? "gap-2.5 py-[9px]" : "min-h-(--row) gap-3.5 py-2.5",
								)}
							>
								<span
									className={cn(
										"shrink-0 font-mono text-xs/4 font-medium text-ink-3",
										two ? "w-3 pt-0.5" : "w-3.5 pt-[3px]",
									)}
								>
									{i18n.number(index + 1)}
								</span>
								<span className="flex min-w-0 flex-col gap-px">
									<span className={two ? "text-sm/5" : "t-row-title"}>{item.question}</span>
									<span className="t-small text-ink-3">{two ? ask(item) : item.why}</span>
								</span>
							</li>
						))}
					</ol>
					<div className="flex flex-col gap-2 pt-3">
						{askable.map((offer, index) => {
							const company = companyOf(offer);
							return (
								<Button
									key={offer.id}
									variant={index === 0 ? "primary" : "secondary"}
									className="h-auto min-h-9 w-full py-2 whitespace-normal"
									disabled={!offer.applicationId}
									onClick={() => void write(offer)}
								>
									<Icon name="envelope-simple" />
									{two
										? plural(count(offer), {
												one: `Write to ${company} · # question`,
												other: `Write to ${company} · # questions`,
											})
										: t`Write to ${company} with these questions`}
								</Button>
							);
						})}
						{!two && (
							<Button variant="secondary" className="w-full" onClick={copyAll}>
								<Icon name="copy" />
								<Trans>Copy questions</Trans>
							</Button>
						)}
					</div>
					<p className="pt-2.5 t-small text-ink-3">
						{two ? (
							<Trans>
								Each copies its questions and opens that application's Messages. Nothing is sent until you send it.
							</Trans>
						) : (
							<Trans>
								Copies the questions and opens Messages for this application. Nothing is sent until you send it.
							</Trans>
						)}{" "}
						{two && (
							<button
								type="button"
								className="rounded-xs font-medium text-accent-text hover:underline"
								onClick={copyAll}
							>
								<Trans>Copy all questions</Trans>
							</button>
						)}
					</p>
				</>
			)}
			{totals}
		</>
	);
}
