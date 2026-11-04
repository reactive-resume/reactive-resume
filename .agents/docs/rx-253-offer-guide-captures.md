# RX-253 offer guide capture receipt

Two active `comparing-job-offers.mdx` figures showed an obsolete instruction to enter a three-letter code. Current OfferForm uses the delivered searchable currency choice and says **Choose a currency.** Original RX-242 and RX-243 remain historical deliveries; this receipt records their focused later replacement.

Source composition: `3ba7367149c189afcd803f25fa6f37a3f282a0ab` (includes RX-251). Existing production tests in `career-polish-recovery.spec.ts` produced both fictional-account figures; PNGs were copied unchanged from test output and visually inspected.

| Figure                                                | Visible current state                                                                                               | Existing execution proof                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docs/images/guides/career/offer-stage.png`           | Fictional Cedar selected and disabled; empty searchable Currency; Choose a currency helper; manual entry disclosure | Offer-stage selection, saved offers, same-company role labels and Messages navigation without AI requests             |
| `docs/images/guides/career/offer-currency-choice.png` | EUR and euro symbol; Per month; base 8000; Choose a currency helper                                                 | Actual Preferences save/readback, clear/reselect validation, protected offer currency/period/base readback and reload |

Existing guide captions and alt text match these states. No runtime, native, schema, API, translation or dependency change. The separate four RX-251 header/tag production cases also passed on this composition. Production build completed with all three tasks cached; this is inherited build output, not a fresh compilation claim.

Hosted CI and CodeRabbit were explicitly waived. Native device, screen-reader, external-service and deployment behavior remain unverified. This receipt does not recover the original broad capture provenance or certify every depicted control.
