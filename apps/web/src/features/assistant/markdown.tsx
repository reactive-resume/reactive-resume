import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The assistant's reply as Markdown. Memoized on the text, so finished replies stop re-rendering while one streams. */
export const AssistantMarkdown = function AssistantMarkdown({ text }: { text: string }) {
	return (
		<ReactMarkdown
			skipHtml
			remarkPlugins={[remarkGfm]}
			components={{
				p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
				ul: ({ children }) => <ul className="my-2 ms-5 list-disc space-y-1">{children}</ul>,
				ol: ({ children }) => <ol className="my-2 ms-5 list-decimal space-y-1">{children}</ol>,
				li: ({ children }) => <li className="ps-1">{children}</li>,
				a: ({ children, href }) => (
					<a className="text-accent-text underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
						{children}
					</a>
				),
				code: ({ children }) => (
					<code className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
				),
				pre: ({ children }) => (
					<pre className="my-3 max-w-full overflow-auto rounded-md bg-sunken p-3 text-xs leading-relaxed">
						{children}
					</pre>
				),
				blockquote: ({ children }) => (
					<blockquote className="my-3 border-s-2 border-line-2 ps-3 text-ink-2">{children}</blockquote>
				),
				table: ({ children }) => (
					<div className="my-3 max-w-full overflow-x-auto">
						<table className="w-full min-w-max border-collapse text-start text-sm">{children}</table>
					</div>
				),
				th: ({ children }) => <th className="border border-line px-2 py-1 font-semibold">{children}</th>,
				td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
			}}
		>
			{text}
		</ReactMarkdown>
	);
};
