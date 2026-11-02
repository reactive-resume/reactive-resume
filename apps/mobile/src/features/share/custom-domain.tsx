import type { RouterOutput } from "@/api/client";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Linking, View } from "react-native";
import { cvDomainRegistrationUrl, formatTimeSince } from "@reactive-resume/resume/sharing";
import { orpc } from "@/api/client";
import {
	Banner,
	Button,
	ConfirmDialog,
	Icon,
	ListGroup,
	ListRow,
	Sheet,
	Text,
	TextField,
	haptics,
	showToast,
	useTheme,
} from "@/ui";

const CODE = "RX";

type Domain = NonNullable<RouterOutput["customDomain"]["get"]>;
type Suggestion = NonNullable<RouterOutput["customDomain"]["suggestion"]>;

type CustomDomainProps = {
	offline: boolean;
	/** Suggest a `.cv` domain from OlaCV while none is connected (`FLAG_OLACV_SUGGESTION`). */
	suggest: boolean;
};

/** Connects the account's own domain: the domain, the DNS records to add in a sheet, a check, and the result. */
export function CustomDomain({ offline, suggest }: CustomDomainProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const domain = useQuery({ ...orpc.customDomain.get.queryOptions(), enabled: !offline });
	const suggestion = useQuery({
		...orpc.customDomain.suggestion.queryOptions(),
		enabled: suggest && !offline && domain.isSuccess && !domain.data,
		staleTime: 15 * 60_000,
	});
	const [hostname, setHostname] = useState("");
	const [recordsOpen, setRecordsOpen] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const store = (next: RouterOutput["customDomain"]["get"]) =>
		queryClient.setQueryData(orpc.customDomain.get.queryKey(), next);
	const set = useMutation({
		...orpc.customDomain.set.mutationOptions(),
		onSuccess: (next) => {
			store(next);
			if (!next.verified) setRecordsOpen(true);
		},
	});
	const verify = useMutation({
		...orpc.customDomain.verify.mutationOptions(),
		onSuccess: (next) => {
			store(next);
			if (next.verified) setRecordsOpen(false);
			showToast({
				message: next.verified ? t`Domain connected` : t`The records aren't visible yet. Check again later.`,
			});
		},
	});
	const remove = useMutation({ ...orpc.customDomain.remove.mutationOptions(), onSuccess: () => store(null) });
	const error = set.error ?? verify.error ?? remove.error;

	if (domain.isPending) return null;
	const current = domain.data;

	return (
		<View style={{ gap: space.s3 }}>
			{error && <Banner tone="danger" message={error.message} />}
			{!current ? (
				<>
					<TextField
						label={t`Your domain`}
						value={hostname}
						onChangeText={setHostname}
						placeholder="resume.example.com"
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
					/>
					<Button
						variant="secondary"
						label={t`Connect`}
						loading={set.isPending}
						disabled={offline || !hostname.trim()}
						onPress={() => set.mutate({ hostname })}
					/>
					{suggest && suggestion.data && (
						<CvDomainCard
							suggestion={suggestion.data}
							connecting={set.isPending}
							disabled={offline}
							onConnect={(hostname) => set.mutate({ hostname })}
						/>
					)}
				</>
			) : (
				<>
					<ListRow
						title={current.hostname}
						subtitle={
							current.verified
								? t`Connected. Your domain opens your primary resume.`
								: t`Not connected yet. Add its DNS records where you manage the domain, then check.`
						}
						leading={current.verified ? "check-circle" : "warning-circle"}
					/>
					{!current.verified && (
						<>
							<Button variant="secondary" label={t`Show DNS records`} onPress={() => setRecordsOpen(true)} />
							<Button
								variant="ghost"
								label={t`Check DNS`}
								loading={verify.isPending}
								disabled={offline}
								onPress={() => verify.mutate({})}
							/>
						</>
					)}
					<Button
						variant="ghost"
						label={t`Remove`}
						loading={remove.isPending}
						disabled={offline || set.isPending || verify.isPending}
						onPress={() => setConfirmRemove(true)}
					/>
					<ConfirmDialog
						open={confirmRemove}
						title={t`Remove the custom domain?`}
						message={t`Your domain will stop opening your primary resume. You can reconnect it later.`}
						confirmLabel={t`Remove domain`}
						cancelLabel={t`Keep domain`}
						destructive
						onCancel={() => setConfirmRemove(false)}
						onConfirm={() => {
							setConfirmRemove(false);
							if (!offline && !remove.isPending) remove.mutate({});
						}}
					/>
					<DnsRecordsSheet
						domain={current}
						open={recordsOpen}
						onClose={() => setRecordsOpen(false)}
						checking={verify.isPending}
						disabled={offline}
						onCheck={() => verify.mutate({})}
					/>
				</>
			)}
		</View>
	);
}

const copy = async (value: string, message: string) => {
	await Clipboard.setStringAsync(value);
	haptics.light();
	showToast({ message });
};

type CvDomainCardProps = {
	suggestion: Suggestion;
	connecting: boolean;
	disabled: boolean;
	onConnect: (domain: string) => void;
};

/** A quiet suggestion under the domain field: the account's name as a `.cv` domain, OlaCV's price and its code. */
function CvDomainCard({ suggestion: { domain, checked, price }, connecting, disabled, onConnect }: CvDomainCardProps) {
	const { t, i18n } = useLingui();
	const { colors, radius, space } = useTheme();
	const [visited, setVisited] = useState(false);
	const money = (amount: number, currency: string) =>
		i18n.number(amount, { style: "currency", currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
	const cost = price ? money(price.amount, price.currency) : null;
	const yearly = price?.renewal === price?.amount;

	return (
		<View style={{ gap: space.s3, padding: space.s4, borderRadius: radius.rLg, backgroundColor: colors.sunken }}>
			<View style={{ gap: 2 }}>
				<Text variant="title" numberOfLines={1}>
					{domain}
				</Text>
				<Text variant="caption" color="ink3">
					{checked ? (
						<>
							<Text variant="caption" color="accentText">{t`Available`}</Text>
							{cost ? ` · ${yearly ? t`${cost} a year` : t`${cost} the first year`}` : ""}
						</>
					) : (
						t`May be available`
					)}
				</Text>
			</View>
			<Text variant="callout" color="ink2">
				{t`Your name as your address, from OlaCV, the .cv registry. Code ${CODE} takes 50% off the first year.`}
			</Text>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				<Button
					variant="secondary"
					size="sm"
					icon="arrow-square-out"
					label={t`Register at OlaCV`}
					onPress={() => {
						setVisited(true);
						void Linking.openURL(cvDomainRegistrationUrl(domain));
					}}
				/>
				<Button
					variant="ghost"
					size="sm"
					icon="copy"
					label={t`Copy code`}
					onPress={() => void copy(CODE, t`Code copied`)}
				/>
				{visited && (
					<Button
						variant="ghost"
						size="sm"
						label={t`Connect ${domain}`}
						loading={connecting}
						disabled={disabled}
						onPress={() => onConnect(domain)}
					/>
				)}
			</View>
		</View>
	);
}

type DnsRecordsSheetProps = {
	domain: Domain;
	open: boolean;
	onClose: () => void;
	checking: boolean;
	disabled: boolean;
	onCheck: () => void;
};

/** The records that connect a custom domain, one group each; tapping a name or value copies it. */
function DnsRecordsSheet({ domain, open, onClose, checking, disabled, onCheck }: DnsRecordsSheetProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const lastChecked = domain.lastCheckedAt ? formatTimeSince(domain.lastCheckedAt, i18n.locale) : null;

	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={t`Connect ${domain.hostname}`}
			detents={[0.6, 0.95]}
			footer={<Button label={t`Check DNS`} loading={checking} disabled={disabled} onPress={onCheck} />}
		>
			<View style={{ gap: space.s4 }}>
				<Text color="ink2">
					{t`Add these records where you manage the domain, then check. Changes can take a few hours to reach everyone.`}
				</Text>
				{domain.records.map((record) => (
					<ListGroup key={`${record.type}-${record.value}`} title={record.type}>
						<ListRow
							title={record.name}
							subtitle={t({ message: "Name", context: "DNS record" })}
							trailing={<CopyGlyph />}
							accessibilityHint={t`Copies it`}
							onPress={() => void copy(record.name, t`Copied`)}
						/>
						<ListRow
							title={record.value}
							subtitle={t`Value`}
							trailing={<CopyGlyph />}
							accessibilityHint={t`Copies it`}
							onPress={() => void copy(record.value, t`Copied`)}
						/>
					</ListGroup>
				))}
				{domain.records.some((record) => record.type === "CNAME") && (
					<Text variant="caption" color="ink3">
						{t`For a root domain such as example.com, use A and AAAA records with ${domain.target}'s addresses instead of the CNAME.`}
					</Text>
				)}
				{lastChecked && <Text variant="caption" color="ink3">{t`Last checked ${lastChecked} ago`}</Text>}
			</View>
		</Sheet>
	);
}

function CopyGlyph() {
	const { colors, size } = useTheme();
	return <Icon name="copy" size={size.icon.meta} color={colors.ink3} />;
}
