import type { FormeEngine } from "./render";
import type { FormeColor, FormeDocument, FormeNode } from "@formepdf/react";

const PROBE_URI = "https://text-background.invalid/";

/**
 * Forme 0.31 drops backgrounds on inline runs. Probe their real glyph bounds using inline link annotations,
 * then paint behind the corresponding text lines in the original PDF. This keeps shaping, wrapping, pagination,
 * links and text extraction intact, including on native engines. No probe links enter the final file.
 * Remove this compatibility pass when Forme paints run backgrounds itself.
 */
export async function paintTextBackgrounds(
	engine: FormeEngine,
	document: FormeDocument,
	pdf: Uint8Array,
): Promise<Uint8Array> {
	const backgrounds: FormeColor[] = [];
	const probeNode = (node: FormeNode): FormeNode => {
		let kind = node.kind;
		if (kind.type === "Text" || kind.type === "Heading") {
			kind = { ...kind };
			if (kind.runs)
				kind.runs = kind.runs.map((run) => {
					const color = run.style?.backgroundColor;
					if (!color) {
						const plain = { ...run };
						delete plain.href;
						return plain;
					}
					const id = backgrounds.push(color) - 1;
					return { ...run, href: `${PROBE_URI}${id}` };
				});
			delete kind.href;
		}
		// An enclosing link suppresses per-run annotation bounds in Forme.
		const next = { ...node, kind, children: node.children.map(probeNode) };
		delete next.href;
		return next;
	};
	const probe = { ...document, children: document.children.map(probeNode) };
	if (backgrounds.length === 0) return pdf;

	// Most resumes need neither this library nor the additional engine pass.
	const { PDFDocument, PDFArray, PDFDict, PDFName, PDFString, PDFRawStream, decodePDFRawStream } =
		await import("pdf-lib");
	const measured = await engine.renderSerializedDocWithLayout(probe as unknown as Record<string, unknown>);
	const [source, geometry] = await Promise.all([PDFDocument.load(pdf), PDFDocument.load(measured.pdf)]);
	for (const [pageIndex, page] of geometry.getPages().entries()) {
		const destination = source.getPage(pageIndex);
		const contents = destination.node.Contents();
		const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
		const streams = entries.map((entry) => {
			const stream = source.context.lookup(entry);
			if (!(stream instanceof PDFRawStream)) throw new Error("Unsupported text background content stream.");
			const bytes = decodePDFRawStream(stream).decode();
			// Byte-preserving text for offsets; Hermes only guarantees UTF-8 TextDecoder support.
			let content = "";
			for (let offset = 0; offset < bytes.length; offset += 8192)
				content += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
			// Forme emits BT/ET and text-position operators on separate lines. Literal newlines are escaped.
			const lines = [...content.matchAll(/^BT\r?\n[\s\S]*?^ET\r?$/gm)].flatMap((line) => {
				const position = line[0].match(/^(?:1 0 0 1 )?(-?[\d.]+) (-?[\d.]+) T[dm]$/m);
				return position ? [{ at: line.index, x: Number(position[1]), y: Number(position[2]), commands: "" }] : [];
			});
			return { stream, bytes, lines };
		});
		const textLines = streams.flatMap((stream) => stream.lines);
		for (const entry of page.node.Annots()?.asArray() ?? []) {
			const annotation = geometry.context.lookup(entry, PDFDict);
			const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
			const uri = action?.lookupMaybe(PDFName.of("URI"), PDFString)?.decodeText();
			if (!uri?.startsWith(PROBE_URI)) continue;
			const color = backgrounds[Number(uri.slice(PROBE_URI.length))];
			if (!color) continue;
			const { x, y, width, height } = annotation.lookup(PDFName.of("Rect"), PDFArray).asRectangle();
			// Tagged inline links can split a line into several BT/ET pairs. The closest start to the left belongs
			// to this fragment; x also separates columns whose baselines coincide. Coordinates are engine-local,
			// so inserting inside the original graphics state preserves ancestor transforms and clipping.
			const line = textLines
				.filter((line) => line.x <= x + 0.1 && line.y >= y && line.y <= y + height)
				.sort((a, b) => b.x - a.x)[0];
			if (!line) throw new Error("Text background line is missing.");
			line.commands += `/Artifact BMC\nq\n${color.r} ${color.g} ${color.b} rg\n${x} ${y} ${width} ${height} re f\nQ\nEMC\n`;
		}
		for (const { stream, bytes, lines } of streams) {
			const insertions = lines
				.filter((line) => line.commands)
				.map((line) => ({ ...line, commands: new TextEncoder().encode(line.commands) }));
			if (insertions.length === 0) continue;
			const painted = new Uint8Array(bytes.length + insertions.reduce((sum, entry) => sum + entry.commands.length, 0));
			let from = 0;
			let to = 0;
			for (const { at, commands } of insertions) {
				painted.set(bytes.subarray(from, at), to);
				to += at - from;
				painted.set(commands, to);
				to += commands.length;
				from = at;
			}
			painted.set(bytes.subarray(from), to);
			const dict = stream.dict.clone();
			dict.delete(PDFName.of("Filter"));
			dict.delete(PDFName.of("DecodeParms"));
			const reference = source.context.getObjectRef(stream);
			if (!reference) throw new Error("Text background content reference is missing.");
			source.context.assign(reference, PDFRawStream.of(dict, painted));
		}
	}
	return source.save();
}
