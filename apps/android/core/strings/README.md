# Android strings

Run `python3 apps/android/scripts/po-to-strings.py` from the repository root. No
Python packages or Gradle needed. Source is mobile `en-US.po` (Language header);
every mobile locale is included. Generated files are committed.

Find a string by searching its English msgid in `src/main/res/values/strings.xml`.
Use `me.rxresu.core.strings.R.string.<name>` (alias that R import in feature code).
Names derive from context + msgid; collisions alone receive a hash suffix.
Argument comments document positional order. Pass strings for `%n$s` arguments;
format numbers/dates for the user's locale before passing them.

Use `CatalogPlurals.get(resources, R.plurals.<name>, quantity, ...arguments)` for
plurals. Include count in the argument order shown in XML. This preserves ICU
exact-number branches (`=0`, `=1`) that Android CLDR plurals cannot represent.
Never call `getQuantityString` directly on catalog plurals with exact branches.

Empty, fuzzy or incompatible translations are omitted: Android falls back to
English. `MissingTranslation` is suppressed only on affected source resources,
with an explanation beside each; inventing translations would hide missing copy.
Other format and resource checks remain enabled. Identical static text across
every catalog is marked `translatable="false"` in defaults only.

Missing CLDR plural categories inherit that catalog's `other` branch, exactly as
ICU does. Categories unused by the target locale are omitted. Exact-number strings
may use subsets of the full argument array; their scoped `StringFormatCount`
annotation documents why locale branch argument counts can differ safely.

Strings absent from catalogs belong in the feature module's own
`res/values/strings.xml`, in English copied from the web app. Don't edit generated
XML. New catalog messages should flow through mobile's normal Lingui workflow.

Tests: `python3 -m unittest discover -s apps/android/scripts -p 'test_*.py'`.
