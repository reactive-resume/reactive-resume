# Independent visual reviews

## Foundation Kit — final review

Reviewed actual: `build/fidelity/Kit.png`, SHA256
`e2c4cf76d33a6b0fd1c691bb557c481435f806d8dc22b11b8a5e51fd80db8a26`.
Reference: immutable bundle `boards/Kit.png`.

A fresh reviewer who wrote none of the UI read COMPONENTS.md and inspected the full board plus six
enlarged paired regions covering every light/dark component. No remaining visible findings within
the stated 1 dp and glyph-antialiasing contract. Unmodified pixel tool: 0.06%, no solid bands.

Earlier independent rounds found and verified fixes for: right-column label wrapping and cumulative
vertical drift; hero width; incorrect blocked-composer icon; insertion caret; amber marker shape;
top-bar overflow position; toast height and clipped shadow; consumed row borders; badge accumulation.

Kit uses actual xhdpi Compose rendering, exported at 0.5 scale to the reference's 2240×1400 dimensions.
Actual layout metadata remains in dp. No baseline or tolerance was changed.

This verdict covers only the pinned Kit. Screen composites, scroll-end captures, interactions,
accessibility and device checks remain pending their later passes.

## Auth and settings — independent screen review, 2026-11-08

**Verdict: changes required. Two remaining structural findings, affecting S2 and S4 in both themes.**
The reviewer wrote none of this UI. Scope is A1–A4 and S1–S6 only: 10 screens, 20 light/dark
composites, their 20 original reference PNGs and 20 original actual PNGs, plus all 8 available
scroll-end PNGs (S1, S2, S4, S5, both themes). Each original and composite was opened individually,
not inferred from a contact sheet. Additional enlarged paired crops checked S1 rows/dividers,
S2 rows/dividers, S3 segments and S5 provider icons/badges in both themes.
This is not a review of all 62 screens or 124 theme captures.

Specification read: immutable bundle `REDESIGN.md` §2 and §5–6, `design/COMPONENTS.md`, the assigned
layout JSONs, and S2/S4 board source and SCREENS notes. All bundle paths below resolve under
`/Users/amruth/Projects/reactive-resume/.agents/handoff/android-app/`.
Actuals: `apps/android/build/fidelity/`; composites and inherited numeric report:
`apps/android/build/fidelity-report-shared/`. Coordinates below are dp from frame top-left;
original PNG pixels are twice these values. Scroll-end coordinates refer to the end image,
not unscrolled content. Every hash below was read before review and rechecked unchanged at append.

### Remaining findings

1. **S2-Account, light and dark: additional root content after Delete account.**
   The scroll-end PNGs visibly contain the following elements, absent from
   `design/layout/S2-Account.json` and the rendered body in
   `design/source/S2-Account.dc.html:18`. The reference body ends with Delete account.
   The same source's Show on mobile note and `SCREENS.md` §S2 explicitly require:
   “Delete account is last, danger text, and needs the password or a passkey.”
   The extra section violates both structure/order and copy requirements in REDESIGN §2.1/§2.7.
   It also introduces separators and trailing carets where the drawn screen has no further rows.

   | Visible extra                                   | Scroll-end box (x, y, w, h) | Unscrolled y |
   | ----------------------------------------------- | --------------------------- | ------------ |
   | Account details heading                         | (24, 330, 112.3, 28)        | 817          |
   | Name / Alex Morgan row, including caret         | (24, 362, 342, 71)          | 849          |
   | Sessions / 3 row, including caret               | (24, 433, 342, 71)          | 920          |
   | GitHub / Connected row, including caret         | (24, 504, 342, 71)          | 991          |
   | Server / https://rxresu.me row, including caret | (24, 575, 342, 71)          | 1062         |
   | Sign out row                                    | (24, 646, 342, 64)          | 1133         |
   | Change photo button                             | (24, 734, 118.5, 36)        | 1221         |
   | Remove photo button                             | (154.5, 734, 120.5, 36)     | 1221         |

   Evidence: both `S2-Account-<theme>-end.png` viewed at full size; corresponding end JSONs
   locate their real rendered boxes. Existing layout report also records these as EXTRA;
   its passing result does not reject extras. Name/photo/sessions functionality mentioned in
   web parity can live on appropriate detail destinations, but no approved exception permits
   these additional controls after the drawn final row.

2. **S4-Profile, light and dark: undrawn Manage profile section and truncated extra copy.**
   Both scroll-end images show a “Manage profile” heading at (24, 698, 111.6, 28), followed by
   an extra row at (24, 730, 342, 64), its text at (24, 750, 293.1, 24) and caret-right at
   (342, 750, 24, 24). Unscrolled heading/row y are 825/857.
   The text renders “Contact details, address, links and refer…”; end JSON records full text
   “Contact details, address, links and references”. Neither section nor row exists in
   `design/layout/S4-Profile.json` or `design/source/S4-Profile.dc.html:18`, whose body ends
   at Pay expectations. Therefore this is an added heading/row/icon/copy and an unmatched
   ellipsis state under REDESIGN §2.1/§2.3/§2.7. SCREENS web parity mentions Manage profile
   functionality, but supplies no exception to add this section to the drawn root screen.

### Other visible differences and accepted limits

No remaining top-frame finding exceeds the stated 1 dp geometry / 4 dp glyph-width tolerance.
No additional visible colour, radius, shadow, border-thickness, icon-shape/weight, font-weight,
wrapping, truncation or copy mismatch was found in these pinned top-frame captures.
The following small differences were inspected rather than hidden by the numeric pass:

- S1, both themes: list dividers across x=24–366 sit 1 dp higher at actual y=313, 384, 455,
  653, 717 versus reference y=314, 385, 456, 654, 718. First divider remains y=249.
  Subsequent row text/tiles/carets follow the same within-tolerance offset; text-box y is
  typically 0.5 dp higher. Divider colour/thickness is unchanged (light RGB 223/222/218,
  1 dp). Identity text and page title round 0.5 dp down instead. Sign out is specified by
  S1 layout/source, so its visibility after scrolling is not an extra.
- S2, both themes: dividers across x=24–366 sit 1 dp higher at actual y=231, 302, 373, 444,
  515, 720 versus reference 232, 303, 374, 445, 516, 721. Top divider remains y=161.
  All specified row text-box y values are 0.5 dp higher; no cumulative drift.
- S3, both themes: appearance segment labels at y=214 versus 213.5; System/Light start
  0.5 dp left, Dark starts 1 dp left (actual x=293 versus 294). Segment track right edge
  rounds 1 dp inward. Other labels round 0.5 dp down; switches retain the specified shape,
  tint and state. No changed line wrap.
- A1/A2/A4/S4/S5/S6: text-line rasterization and half-dp placement rounding remain visible
  in difference panels. Examples: A1 brand y=99 versus 98.5; A2 field labels y=165/255
  versus 164.5/254.5; A4 permission row text y=373/454/519 versus 372.5/453.5/518.5;
  S4 form labels y=219/309/399/489/579 versus each reference minus 0.5;
  S5 provider subtitles y=231/302 versus 230.5/301.5. These preserve specified line boxes,
  wrapping and hierarchy. A3 code-box fractional-width rounding remains within 1 dp.
- S5 scroll-end API keys and Connected applications are present in the reference layout
  (including offscreen elements 62–64), in the specified order, with the required copy,
  matching caret and divider treatment. No finding there.

Inherited scoreboard: 10/10 pass, 0 layout failures, light/dark pixel differences 0.02–0.69%,
0 solid bands. No fidelity tool, test or build was rerun during this review. Those measurements
are separate evidence and do not clear the two structural findings above.

### Evidence hashes

SHA256, full original files. `R` = bundle `screens/<stem>.png`; `A` = actual
`build/fidelity/<stem>.png`; `C` = report `build/fidelity-report-shared/<stem>-compare.png`.

| Stem                 | R                                                                  | A                                                                  | C                                                                  |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| A1-Welcome-light     | `67f7872ac9980dd19364d97ca660e5ebfd94d5a987e5f0e005075a2357dc82c0` | `eb764ce88e7d2c005f3a3b44d117f0fb5b33cf3a12068a0b0a965cc79346cf92` | `5a5d55b871ce49450055be865add7e644a65dcb8798f2f4e77489882daf7f4ab` |
| A1-Welcome-dark      | `beec2568d1b5f7eb77cdcad2d54f848f863b680fbde1e841980d87d7b9cdd871` | `3b76415a8cf5e35391283fef9f64451bdc07de27c52e3d3ae89bb9c5795db530` | `6552dda1e25117cd575d885cbcb6f03861be0bc3adb3a675e90b0752892706a7` |
| A2-SignIn-light      | `3d3ec76e88037383a377ab0a55f9a62d8870a85f06e687a513c2d8acca68d940` | `34ca549cfd580124078bced523497aa04aae6992bca0f80b1f4bb2b31489a6b6` | `87f35567787265c53dc54cfa38c53baaee82e9df5e7afd683455cecc70dbdefc` |
| A2-SignIn-dark       | `22297d9a2e4361f009fffb8d4f39360853588421cbd33fd48f7c03ad84dfe20d` | `420c9b5a99084141aae9232ab30738d57e5b3565d6f5f145f813d9916dd88653` | `f4357ad7a0a88b94b094c1747f15f4383f36b388bec55aba13a28ce116f472f2` |
| A3-TwoStep-light     | `2c6787beaa6b3a5bc94f6af290bf161aab5d9387093577e2c313f820de2de3fd` | `f186567812d744584c6ff317460459d6aa0b7007abbbc578d45e3d1e9b2887e6` | `ef8f12c9d52f8245a48ea3d4c03847d4b1d798dff6271471a18b80e04f3fdf79` |
| A3-TwoStep-dark      | `e0bd63b7f4202ab691ba1a809d8206d40750e2c51a28903bbd5c20b86b2f6024` | `8d4345a8be3f99837b25e9a44e97a04ec569adc52371e59a64514995633b982f` | `7facb30946124b9f942e312e6ce9168e441a5c60e8730bdf6cb5066d81e984e7` |
| A4-Allow-light       | `ad441068f22b3595e0eb6ec90c73020ead224e8896eb63bea20d721ef5f9e9c6` | `e2079a63a6dce3cb1269a6019b575ab8802a2b9b85065eb30b7fb9371f1f1bdb` | `fa227cb73805a521472981656d9dc4c3b38b3b47cf0c6a79436c42caa65eb293` |
| A4-Allow-dark        | `3f99b7f9b16b3eeb46c285eac70a0eeefcaa4eaaf0914e622f0397178cadd089` | `71708bcb84f163074747087345e61ba01d6a7947e883ea86a02593692eac12b3` | `dce2da9febe4b5be25f285a5147b6946801bba283e181411f1893186b6927dde` |
| S1-Settings-light    | `3c91594bd9be7607ba69fc4390eb6513c47e5d7c17709a07a0678d6d8f772b87` | `933c19cd525ef9be40fac52371bb3c26b6fd82ed53b638ab58fa071fd459a661` | `0ed62b05b2b6740ce7c26cd0bc84b54523b3fd2659c3bacb1b81f4582ec99990` |
| S1-Settings-dark     | `9477b844abf67e98ab9e0ed9d9423dd92b3d0919ed0cf44926222c5b8c457f1c` | `9caa1cc5ae8bfa8dd5edb4c7e0169e848475c8a97c344622d8f61d52257b63f8` | `e5993da755fbb1a93913e19ae2d2227f9d49b70652c67a9ed490b9435cd2e739` |
| S2-Account-light     | `c1c6c64a4113f7bc307b46881b485f2f8c7046b54ee36e65618f943c67a671f9` | `2dba743c7b58e3eaad0f2b68a4aa06bb0d4a987e6f625a0443901739cdf247ec` | `7ee6a961d33fc12f4bc080ac6b7cbc7abc9ba521618be39f88e9a433857119bc` |
| S2-Account-dark      | `f03b3640a2f644700cb3b7385ed0a275547d272152ba2fc183c89c89b023af65` | `c005c0b47852669d03b94d905b6b358939fec5334a7a349b342e4fc0b2b0ee9f` | `c00187ee2fa685c00c43a68651d20a1124a46266e54dc9bfc1a1c3cc96eda1d9` |
| S3-Preferences-light | `a0c533ebd0909f7ec093aafd46c8797686f579275a0f910c01be4fcc9301c4c2` | `95a1780834ee2f390037d784c4f43aca63783c9127f7605e36b7240e504fe2ff` | `91f3a03e39b41d9d88351c183d801281be17e9a0bbb6a9a7a05e001b7e699aa1` |
| S3-Preferences-dark  | `29d4e03390b02f6d24785c06fe311c0607e997210121bd9fd32e8863b08fc4fb` | `b41d82ff09b46a33a0a9334d0381c2db2cc708325a10c6a8461e1859baa61ba1` | `2faeab7986c272873f6c04950c15af8d7f87ff99ab8f903b06d7ec6e1739a080` |
| S4-Profile-light     | `5a63688f63c11122b0eb964e7f93d94e7b2ee0518dd4d85c0487b5c1d856bc7f` | `bbe660a9195dc9b9c54a0ab05e8f3c87a116ed20d34d0bb02fb0bf320a130005` | `adf751ea7dda3bdc1a0d0196bcf5f3329748fd6ee17e27cfbe4c4ad2b051923c` |
| S4-Profile-dark      | `b9b9c189c6f1f176719bb2a82c7a4eda83cbe06068c3f3f70b7c32508c0c24ee` | `08bbde4f7d3aca4bcc41c5eb4f8746436c078a420e9ffcb427e61971a6f67964` | `7b0bfdf599f43bd167c5f1be7f40ce18f95501c897a8f65655870ef78b3011de` |
| S5-AI-light          | `f8adccd5a747eca7027cf39cfb05ac11109f9715313adb562764fab88c24f521` | `7a9b943876dc2fb6612c902f7ccf9bf3dd5fe494d74700679af1a315995a3520` | `7b9007a6bf37e477ce0fcae25f7e105e318e1991c7b03e4608cfc3345eea4768` |
| S5-AI-dark           | `2b8419b75f14b9e8b8794e2100fb3c39e31370cdf4852c26ef9d5f589bdb98c8` | `13a66f98a6b1fc42270e3e6f69a1bae42a7514f7ac5065e7461791946e22d320` | `2c3f8863f1d3d481249bebdae3fd3efc289c3168014edb43070bf32185612ed2` |
| S6-Provider-light    | `6a7c20e5b706f1ca82840ea43d704e75a44ac732c8f1f38399221a5f6e86f0b4` | `05146fcdcd3d8d62c083a7d1ad7a5c053323e64b724a49de28065725389e0a3e` | `3b14826a5353031bbe16121bbefcf678e2c604cd413e79fbd74e998f5c261feb` |
| S6-Provider-dark     | `2471efa097fa1bfa59d63480792aa5d942f339f618de651eaf245680390b8896` | `edbfc3293b858da4be6e454bf95d2dd23bac42bf413012e5ee0c2bc6fd77b730` | `834cccbcdeed5d63fd4177d852ac0e47dd9b9bcf444566220aa0edda60950efe` |

Scroll-end original SHA256 (`build/fidelity/<stem>-end.png`):

| Stem              | SHA256                                                             |
| ----------------- | ------------------------------------------------------------------ |
| S1-Settings-light | `31685c1d100d70a25550e580e3028136056b1cb6558ea0ebef8e16513511c2ca` |
| S1-Settings-dark  | `e64c6d057c86e55fb05ab5158116daec7a41e7ad7d1f2bb423f87b6d76dfb4d1` |
| S2-Account-light  | `299aea2a10e9544662d20d38bb8bba6a87821fee30ce6371617fb088d9226257` |
| S2-Account-dark   | `e3e5cb5ecf660bc12e1789235bab479ae960dc2e4001820c8fc4551972315858` |
| S4-Profile-light  | `47c3fdc1e06be60ca04058796879505d7501dec9373e0c4b66c3dbad6543d90e` |
| S4-Profile-dark   | `584fab707a8a3e3c6b34f9663f1da1da54ba9f1798017b252207d30ce3e6663f` |
| S5-AI-light       | `70dab4cc2e04ad7025cde6a364c1438a723e69e262ae19a17d07f494c2829b9b` |
| S5-AI-dark        | `1cc7e4b955d99ccb9a3f7a76ea583f73b23369f3049399a27113e6744cdfd5de` |

Skipped: runtime interactions, navigation, TalkBack, 200% font scale, RTL and device checks;
no app, baseline, bundle, layout dump or tolerance edits made. Changed captures need a fresh
visual review; this verdict applies only to the hashes above.

## S2 and S4 — independent corrective review, round 2, 2026-11-08

**Verdict: pass for the pinned S2-Account and S4-Profile root captures in both themes.
Zero remaining visual findings within the stated fidelity contract. Both structural findings
from the preceding screen review are resolved in these current captures.**

This fresh reviewer wrote none of the UI. Scope is exactly two screens, four current composites,
four current actual PNGs and four immutable reference PNGs, each opened individually. This is
not a fresh review of A1–A4/S1/S3/S5/S6, the Kit, all 62 screens, or all 124 theme captures.
The Foundation Kit verdict and the earlier review, including their hashes and original findings,
remain preserved above.

Read the bundle REDESIGN.md fidelity contract, design/COMPONENTS.md, both screen layout JSONs
and both board source files. Inspected the current AccountScreen/ProfileScreen root source and
SettingsFrame through CodeGraph, and read both current light JSON dumps; both dark JSON dumps
were read and confirmed identical to their corresponding light dumps. No source, fixture,
baseline, tolerance or fidelity tool was edited. The inspected roots contain ordinary rendered
components, with no invisible substitute nodes added to satisfy these endings.

### Structural resolution and end-content evidence

- **S2-Account:** current primary PNGs visibly end with Delete account, in danger text, without
  a trailing caret. Current JSON has 37 elements and ends with that text at
  (24, 741, 109.94, 24); its enclosing final ListRow is (24, 721, 342, 64), ending at y=785.
  No Account details heading, Name/Sessions/provider/Server/Sign out rows or photo buttons follow
  it in the primary capture or dump. AccountScreen's root content closes immediately after
  this list (SettingsScreens.kt:339–345). Account details now belong to the conditional username
  sheet, outside the root. This resolves finding 1 for the reviewed root state.
- **S4-Profile:** current primary PNGs visibly end with Pay expectations, From €65,000 and its
  caret. Current JSON has 29 elements; the final ListRow is (24, 729, 342, 64), ending at y=793.
  Pay text is (24, 749, 123.33, 24), value (235, 751, 91, 20), caret (342, 749, 24, 24).
  No Manage profile heading or truncated Contact details row follows. ProfileScreen's loaded,
  error-free root ends after this group (ProfileScreen.kt:175–219); details are reached through
  the existing full-name control. This resolves finding 2 for the reviewed root state.

All coordinates above are dp from frame top-left. Both final rows fit above the pinned bottom
safe area at y=810. Fresh root `-end.png` and `-end.json` files are absent in build/fidelity;
this is consistent with the visible primary captures, current dumps and root source, not an
inference from file quarantine. No files in build/fidelity-stale-root-ends were opened or used
as current proof. The primary image hashes being unchanged from the earlier top-frame images
is expected: the removed sections were previously below the viewport. Current JSON and source,
not those unchanged top-frame hashes alone, establish removal of the extra root content.

### Inspected visible differences within tolerance

- **S2, both themes:** separators across x=24–366 sit at actual y=231, 302, 373, 444, 515 and 720,
  versus reference y=232, 303, 374, 445, 516 and 721. The first/top separator remains at y=161.
  Carets sit 1 dp higher (e.g. first actual y=184 versus reference 185); specified row text is
  0.5 dp higher (Email y=173 versus 173.5, Delete account y=741 versus 741.5).
  Title y=107 versus 106.5; Your data y=618 versus 618.5. No cumulative drift or copy change.
- **S4, both themes:** form labels are 0.5 dp lower (actual y=219/309/399/489/579 versus
  reference 218.5/308.5/398.5/488.5/578.5); title y=107 versus 106.5. Notice period title/value
  are 0.5 dp lower; its value starts x=275.5 versus reference 276. Pay title/value y=749/751
  versus 748.5/750.5. Field boxes retain x=24, width=342, height=44, radius=10 and the specified
  y=245/335/425/515/605. Subtitle retains the drawn two-line wrap.

No other visible structure, order, spacing, size, text-width, font family/weight, wrapping,
ellipsis, colour, radius, border, shadow, icon shape/weight/tint or copy mismatch was found
outside the 1 dp geometry / 4 dp text-width and glyph-antialiasing allowances.

Inherited selected-screen scoreboard was read, not rerun: 2/2 pass; S2 light/dark 0.64%/0.64%,
S4 0.05%/0.04%; zero layout failures and zero solid bands. Its EXTRA entries were checked:
TopBar/PageTitle/SectionHeading wrappers and final ListRows correspond to visible specified
content, not the removed sections. Numeric pass is separate from the visual verdict above.
The report records verifiedRasters=0 and rasterInternals=0; it is not raster-origin verification.

### Evidence hashes for this round

SHA256, original full files, rechecked at append. `R` = bundle `screens/<stem>.png`;
`A` = `build/fidelity/<stem>.png`; `C` = `build/fidelity-report/<stem>-compare.png`.

| Stem             | R                                                                  | A                                                                  | C                                                                  |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| S2-Account-light | `c1c6c64a4113f7bc307b46881b485f2f8c7046b54ee36e65618f943c67a671f9` | `2dba743c7b58e3eaad0f2b68a4aa06bb0d4a987e6f625a0443901739cdf247ec` | `7ee6a961d33fc12f4bc080ac6b7cbc7abc9ba521618be39f88e9a433857119bc` |
| S2-Account-dark  | `f03b3640a2f644700cb3b7385ed0a275547d272152ba2fc183c89c89b023af65` | `c005c0b47852669d03b94d905b6b358939fec5334a7a349b342e4fc0b2b0ee9f` | `c00187ee2fa685c00c43a68651d20a1124a46266e54dc9bfc1a1c3cc96eda1d9` |
| S4-Profile-light | `5a63688f63c11122b0eb964e7f93d94e7b2ee0518dd4d85c0487b5c1d856bc7f` | `bbe660a9195dc9b9c54a0ab05e8f3c87a116ed20d34d0bb02fb0bf320a130005` | `adf751ea7dda3bdc1a0d0196bcf5f3329748fd6ee17e27cfbe4c4ad2b051923c` |
| S4-Profile-dark  | `b9b9c189c6f1f176719bb2a82c7a4eda83cbe06068c3f3f70b7c32508c0c24ee` | `08bbde4f7d3aca4bcc41c5eb4f8746436c078a420e9ffcb427e61971a6f67964` | `7b0bfdf599f43bd167c5f1be7f40ce18f95501c897a8f65655870ef78b3011de` |

Current actual JSON SHA256 (same bytes in both themes):

- S2-Account: `e0098a98ddfcad30c7771799ef86edafbe19a445503a3e5a81118dd07ed7b06c`.
- S4-Profile: `f6015b8f964069c1cc7187ef9b453d90234c4ee3981f3770a9104f5e7fe1b1ff`.

No build, test, fidelity rerun, interaction execution, accessibility/TalkBack, RTL, 200% font,
emulator or physical-device check occurred in this review. Detail sheets, error/loading states,
editing, saving, navigation and live data remain outside this visual verdict; inspected source
is corroboration, not runtime interaction proof. Capture-generation provenance was inherited,
not independently reproduced. Only this review section was appended; no commit was made.
