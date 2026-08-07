import type { ILicenseV3 } from '@rocket.chat/core-typings';
import { License } from '@rocket.chat/license';

export const disableCustomScripts = () => {
	// MATTERCHAT: the community-edition `@rocket.chat/license` stub (packages/license) types
	// `getLicense()` as `undefined` — a MatterChat workspace never has a license installed — so
	// upstream's `if (!license)` guard narrows `license` to `never` and `license.information`
	// fails to compile. Widen back to the real (premium) return type so upstream's body below
	// stays unchanged and the unit test, which proxyquires a `License` returning
	// `{ information: { trial } }`, keeps its meaning. On CE this still returns `false` at
	// runtime, because the stub really does hand back `undefined`.
	const license = License.getLicense() as ILicenseV3 | undefined;

	if (!license) {
		return false;
	}

	const isCustomScriptDisabled = process.env.DISABLE_CUSTOM_SCRIPTS === 'true';
	const isTrialLicense = license?.information.trial;

	return isCustomScriptDisabled && isTrialLicense;
};
