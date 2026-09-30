# ATS extraction fixtures

Minimal, hand-authored PDFs for `src/ats-extraction.integration.test.tsx`. Each one isolates a
single file-level defect the ATS checker claims to detect, so the test proves the claim against a
real PDF reader rather than against a hand-built extraction object.

They are written uncompressed, so `cat` shows the whole file. Nothing here came from a third party:
every byte was generated for this repository, and none of them contain personal data.

| File                  | What it is                                                                       | What it proves                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `image-only-scan.pdf` | One page, one image scaled to fill the page, no text operators.                  | The image-coverage measurement is real page area, and `NO_TEXT_LAYER` / `IMAGE_ONLY_DOCUMENT` fire together on a scan. |
| `type3-font.pdf`      | One page of text set in a Type 3 font whose glyph procedure draws a rectangle.   | `isType3Font` is read off the font object, and `TYPE3_FONT` caps the score.                                            |
| `outlined-text.pdf`   | 672 filled rectangles laid out like lines of text, and no text operators at all. | Text converted to vector outlines looks like a page to a human and like nothing at all to a parser.                    |

## Regenerating

There is no build step. To change one, edit the bytes directly or re-derive it: each file is a
five-to-seven object PDF with a correct `xref` table, and the offsets must be updated if the object
bodies change. Keep every fixture under 50 KB — they exist to make one assertion each, not to be
realistic resumes.
