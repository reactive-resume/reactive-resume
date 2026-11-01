# RX-75 mobile scope and release decision

On November 1, 2026, the owner explicitly requested: "Can we skip adding autofill on Android/iOS. I do not like the feature implementation."

Android/iOS autofill and the embedded browser are excluded from RX-75. This is the owner's explicit exception to feature parity. Mobile retains reviewed packets, copyable answers, exact approved PDF downloads and opening the employer form in the system browser for manual completion. Desktop autofill remains an experimental helper feature.

The WebView screen, bridge, direct dependency and catalog entry are removed. Earlier native-build/device observations belong to the discarded implementation and are not proof of the final mobile flow. Final mobile changes use JavaScript, copy and existing native dependencies; they are OTA eligible by source inspection. Compare the installed native fingerprint during release verification and deploy the additive packet backend before dependent clients. No native store build is required solely for this feature.
