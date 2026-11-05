# Store metadata

`metadata.json` contains English and ten translations: Spanish (Spain), French (France), German, Brazilian Portuguese, Simplified Chinese, Japanese, Korean, Hindi, Arabic, and Indonesian. The brand name remains **Reactive Resume** in every locale, as confirmed by the owner. Apple subtitles, descriptions, and keywords are localized; Google uses localized short and full descriptions. Each locale's `releaseNotes` is the translated "What's new" text that the release workflow sends to both stores; update every locale for each release.

Apple uses `zh-Hans`, `ja`, `ko`, `hi`, `ar-SA`, and `id` where Google uses `zh-CN`, `ja-JP`, `ko-KR`, `hi-IN`, `ar`, and `id`. Copy is saved in both stores, not submitted for review or published. Native-language editorial review remains outstanding. Metadata describes the build with AI consent, private safety reporting, and local shared-author blocking; deploy matching backend and policy behavior before review.

## Neutral store artwork — October 19, 2026

Featured artwork and phone carousels use charcoal, ivory, warm gray, Newsreader, Hanken Grotesk, and the original Rx mark. Neutral paper photography generated with `gpt-image-2.5-flare` through ElevenLabs appears only in feature/header/search artwork. Phone panels reuse each platform's existing store captures without changing app UI. Marketing copy is localized; the captured app UI remains English. This refresh supplies artwork, not new build or device validation.

All 11 locales now have one Play feature graphic (1024 × 500), an Apple header (3840 × 1646), Apple search artwork (1920 × 1280), and four phone panels in each store. A fresh reload verified 11 distinct graphics for each featured-art category and four correctly ordered phone panels per locale on both platforms. These 121 asset references are saved in the stores; no review submission or release was performed.

Apple's required medium Dynamic Island set uses 1206 × 2622 panels. The obsolete English large-display override was removed from the listing, retaining its source in the Asset Library; Media Manager confirmed large displays now use the neutral medium-display masters through its existing fallback. Tablet and Duo artwork was not changed.

The final local set contains 165 opaque PNGs plus matching editable SVGs across 11 locales: the three featured formats and four-panel carousels for Android (1080 × 1920), medium iPhone (1206 × 2622), and large iPhone (1320 × 2868). Every final PNG passed decoding, target dimensions, opacity, and upload-size checks. Brand fonts are embedded in SVGs; script-specific text uses the named macOS font families. Editable sources, prompt, generation inputs, manifest, verification evidence, and ZIP remain in the ignored launch-kit directory, as requested. They are not committed.

`../assets/store-submission/` contains the current English Apple header/search PNGs and the existing promotional-text JSON. The original launch-kit design remains in [Figma](https://www.figma.com/design/paEvXcSQes7pnrGtnLS73a?node-id=16-1958) and the owner's Penpot workspace. The neutral refresh was delivered as editable SVGs after the owner chose that fallback when Penpot MCP could not connect.

## Runtime assets

The seven runtime icon/splash PNGs under `../assets` remain the supplied artwork used in iOS build 4 and Android build 5. Configuration uses those paths directly. PWA derivatives use the same artwork and need a normal web deployment before users receive changes. Listing archives and editable design exports remain excluded from Git.

Validate copy after changes: app name and Apple subtitle 30 characters, Google short description 80, full description 4,000, Apple keywords 100, and Apple promotional text 170. Runtime, live-provider, physical-device, and store-review gates remain separate from artwork uploads; see `.agents/docs/runbooks/mobile-releases.md`.
