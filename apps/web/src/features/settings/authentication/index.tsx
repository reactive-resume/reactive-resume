import { useEnabledProviders } from "./components/hooks";
import { PasskeysSection } from "./components/passkeys";
import { PasswordSection } from "./components/password";
import { SocialProviderSection } from "./components/social-provider";
import { TwoFactorSection } from "./components/two-factor";

export function AuthenticationSettingsPage() {
	const { enabledProviders } = useEnabledProviders();

	return (
		<div className="grid max-w-xl gap-4">
			<PasswordSection />

			<TwoFactorSection />

			<PasskeysSection />

			{"google" in enabledProviders && <SocialProviderSection provider="google" />}

			{"github" in enabledProviders && <SocialProviderSection provider="github" />}

			{"linkedin" in enabledProviders && <SocialProviderSection provider="linkedin" />}

			{"custom" in enabledProviders && <SocialProviderSection provider="custom" name={enabledProviders.custom} />}
		</div>
	);
}
