import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import "./content-direction.css";

/**
 * Each text block and list item takes its direction from its own first letter (`dir="auto"`), so German reads
 * left to right inside the Arabic interface and Arabic right to left inside an English one. Decorations only touch
 * the editor's DOM: the saved HTML, and the PDF made from it, stay as written. A list item's first paragraph inherits
 * its direction so it does not hide its text from the item's native auto scan.
 */
export const ContentDirection = Extension.create({
	name: "contentDirection",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					// ponytail: rebuilt per render, a full walk; descriptions are short. Map a plugin-state set if one grows.
					decorations: ({ doc }) => {
						const decorations: Decoration[] = [];
						doc.descendants((node, position, parent, index) => {
							if (node.isTextblock && !(parent?.type.name === "listItem" && index === 0))
								decorations.push(Decoration.node(position, position + node.nodeSize, { dir: "auto" }));
							else if (node.type.name === "listItem")
								decorations.push(
									Decoration.node(position, position + node.nodeSize, { dir: "auto", "data-content-direction": "" }),
								);
						});
						return DecorationSet.create(doc, decorations);
					},
				},
			}),
		];
	},
});
