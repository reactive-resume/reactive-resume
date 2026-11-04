# The web page is the resume's template, converted to responsive HTML

Status: accepted (2026-10-26)

A resume has one **Template** for both its PDF and its **Web page**; there is no separate web template to choose. Instead of hand-building a second design per template, the existing templates are rendered once more through an HTML converter that sits beside the PDF one: both read the same host tree (`View`, `Text`, `Image`, `Svg`, `Link`) the templates already produce. The converter makes the page fluid and folds the sidebar into one column on phones; a template folder may add small web-only adjustments for its absolute-positioned decorations. Every template works on the web at once, and template fixes and the author's Design settings reach the web page without a second implementation.

## Considered options

- Hand-built responsive web template per PDF template: full control, but two designs to keep in step for each of 18 templates.
- A few generic web layouts styled by Design: cheap, but rejected because the web page must look like the chosen template.
- A web-only template choice: dropped to keep one design per resume; the PDF and the web page always match.
- HTML copies of the PDF pages at fixed page size: rejected because fixed widths, sidebars and page breaks don't fit phones.

## Consequences

- The web page draws the template once: header, then every page's main sections, then every page's sidebar sections. Print-only settings (page size, margins, page breaks, keep together, start on new page, free-form height) are ignored.
- On wide screens the page is a centred sheet at about the template's page width; on phones it is full width, ordered header, main, sidebar.
- Template changes must be checked in both outputs.
