import { Settings } from '@rocket.chat/models';

import { addMigration } from '../../lib/migrations';

// GREEN rebrand — flip live installs from the old Omnis-blue primary to brand green.
//
// The `theme-custom-css` setting seeds the content primary accent. Its default moved from
// blue (#3353F8) to green (#1B7A2E) in apps/meteor/server/settings/layout.ts — but a changed
// DEFAULT only affects fresh DBs. Existing workspaces still hold the stored blue value, so this
// migration rewrites it.
//
// SAFETY: it only updates rows whose stored value STILL contains the old blue token (#3353F8).
// If an admin has hand-edited theme-custom-css to something else, we leave it alone.

const GREEN_CSS = [
	'/* MatterChat — OmnisAI house brand (GREEN) */',
	':root {',
	'  --rcx-color-button-primary-background: #1B7A2E;',
	'  --rcx-color-button-primary-hover-background: #156323;',
	'  --rcx-color-button-primary-press-background: #114E1C;',
	'  --rcx-color-button-primary-focus-background: #1B7A2E;',
	'  --rcx-color-button-primary-focus-shadow: 0 0 0 2px rgba(27, 122, 46, 0.5);',
	'}',
	'/* MatterChat logo 2.5x bigger on auth/login/wizard screens */',
	'img[alt="MatterChat"] {',
	'  transform: scale(2.5);',
	'  transform-origin: center;',
	'  margin: 1.6em 0;',
	'}',
].join('\n');

addMigration({
	version: 336,
	name: 'Rebrand content primary accent from Omnis blue to brand green (theme-custom-css)',
	async up() {
		await Settings.updateOne(
			// only touch installs still on the old blue default
			{ _id: 'theme-custom-css', value: { $regex: '#3353F8', $options: 'i' } },
			{ $set: { value: GREEN_CSS, packageValue: GREEN_CSS } },
		);
	},
});
