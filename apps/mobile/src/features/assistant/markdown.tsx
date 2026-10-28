import type { ReactNode } from "react";
import { memo } from "react";
import { Linking, View } from "react-native";
import { Text, useTheme } from "@/ui";

// ponytail: a small Markdown subset (paragraphs, headings, lists, quotes, code, bold/italic/code/links). Tables show as
// monospaced text. Web renders full GFM with react-markdown; add a parser here only if replies need more.

type Block =
	| { kind: "p" | "h" | "quote"; text: string }
	| { kind: "code"; text: string }
	| { kind: "list"; ordered: boolean; items: string[] };

function parseBlocks(source: string): Block[] {
	const blocks: Block[] = [];
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (/^\s*```/.test(line)) {
			const code: string[] = [];
			index++;
			while (index < lines.length && !/^\s*```/.test(lines[index] ?? "")) code.push(lines[index++] ?? "");
			index++;
			blocks.push({ kind: "code", text: code.join("\n") });
			continue;
		}
		if (!line.trim()) {
			index++;
			continue;
		}
		const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
		if (heading) {
			blocks.push({ kind: "h", text: heading[1] ?? "" });
			index++;
			continue;
		}
		const list = /^\s*(?:([-*+])|(\d+)[.)])\s+/.exec(line);
		if (list) {
			const ordered = !list[1];
			const items: string[] = [];
			while (index < lines.length) {
				const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(lines[index] ?? "");
				if (item) items.push(item[1] ?? "");
				else if ((lines[index] ?? "").trim() && /^\s{2,}/.test(lines[index] ?? "") && items.length > 0)
					items[items.length - 1] += ` ${(lines[index] ?? "").trim()}`;
				else break;
				index++;
			}
			blocks.push({ kind: "list", ordered, items });
			continue;
		}
		const kind = /^\s*>/.test(line) ? "quote" : /^\s*\|/.test(line) ? "code" : "p";
		const text: string[] = [];
		while (index < lines.length) {
			const next = lines[index] ?? "";
			if (!next.trim() || /^\s*```/.test(next) || /^\s{0,3}#{1,6}\s/.test(next)) break;
			if (kind !== "code" && /^\s*(?:[-*+]|\d+[.)])\s+/.test(next)) break;
			if ((kind === "quote") !== /^\s*>/.test(next) && kind !== "code") break;
			text.push(kind === "quote" ? next.replace(/^\s*>\s?/, "") : next);
			index++;
		}
		blocks.push({ kind, text: text.join(kind === "code" ? "\n" : " ") });
	}
	return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^[\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function Inline({ text }: { text: string }) {
	const { fonts } = useTheme();
	const nodes: ReactNode[] = text.split(INLINE).map((piece, index) => {
		if (!piece) return null;
		const key = `${index}`;
		if (/^(\*\*|__).+\1$/.test(piece))
			return (
				<Text key={key} style={{ fontFamily: fonts.ui[600] }}>
					{piece.slice(2, -2)}
				</Text>
			);
		if (/^`.+`$/.test(piece))
			return (
				<Text key={key} variant="mono" color="ink2">
					{piece.slice(1, -1)}
				</Text>
			);
		const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
		if (link) {
			const url = link[2] ?? "";
			const safe = /^https?:\/\//i.test(url);
			return (
				<Text
					key={key}
					color="accentText"
					accessibilityRole={safe ? "link" : undefined}
					onPress={safe ? () => void Linking.openURL(url) : undefined}
					style={{ textDecorationLine: "underline" }}
				>
					{link[1]}
				</Text>
			);
		}
		if (/^([*_]).+\1$/.test(piece))
			return (
				<Text key={key} style={{ fontStyle: "italic" }}>
					{piece.slice(1, -1)}
				</Text>
			);
		return piece;
	});
	return <>{nodes}</>;
}

/** The assistant's reply as Markdown. Memoized on the text, so finished replies stop re-rendering while one streams. */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
	const { colors, radius, space } = useTheme();
	return (
		<View style={{ gap: space.s2 }}>
			{parseBlocks(text).map((block, index) => {
				const key = `${index}`;
				if (block.kind === "h")
					return (
						<Text key={key} variant="title" accessibilityRole="header">
							<Inline text={block.text} />
						</Text>
					);
				if (block.kind === "code")
					return (
						<View key={key} style={{ padding: space.s3, borderRadius: radius.rMd, backgroundColor: colors.sunken }}>
							<Text variant="mono" selectable>
								{block.text}
							</Text>
						</View>
					);
				if (block.kind === "quote")
					return (
						<View key={key} style={{ borderStartWidth: 2, borderColor: colors.line2, paddingStart: space.s3 }}>
							<Text color="ink2" selectable>
								<Inline text={block.text} />
							</Text>
						</View>
					);
				if (block.kind === "list")
					return (
						<View key={key} style={{ gap: space.s1 }}>
							{block.items.map((item, number) => (
								<View key={`${number}`} style={{ flexDirection: "row", gap: space.s2, paddingStart: space.s1 }}>
									<Text color="ink2">{block.ordered ? `${number + 1}.` : "•"}</Text>
									<Text selectable style={{ flex: 1 }}>
										<Inline text={item} />
									</Text>
								</View>
							))}
						</View>
					);
				return (
					<Text key={key} selectable>
						<Inline text={block.text} />
					</Text>
				);
			})}
		</View>
	);
});
