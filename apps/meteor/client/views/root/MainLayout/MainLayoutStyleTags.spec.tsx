import { mockAppRoot } from '@rocket.chat/mock-providers';
import { render, queryByAttribute } from '@testing-library/react';

import { MainLayoutStyleTags } from './MainLayoutStyleTags';

describe('MainLayout style tags', () => {
	it('should create the Light theme style tag', () => {
		render(<MainLayoutStyleTags />, {
			wrapper: mockAppRoot().withUserPreference('themeAppearence', 'light').build(),
		});
		const tagLight = queryByAttribute('id', document.head, 'main-palette-light');
		expect(tagLight).not.toBeNull();
	});

	it('should create the Dark theme style tag', () => {
		render(<MainLayoutStyleTags />, {
			wrapper: mockAppRoot().withUserPreference('themeAppearence', 'dark').build(),
		});
		const tagDark = queryByAttribute('id', document.head, 'main-palette-dark');
		expect(tagDark).not.toBeNull();
	});

	it('should create the codeBlock style tag when in dark mode', () => {
		render(<MainLayoutStyleTags />, {
			wrapper: mockAppRoot().withUserPreference('themeAppearence', 'dark').build(),
		});
		const style = queryByAttribute('id', document.head, 'codeBlock-palette');
		expect(style).not.toBeNull();
	});

	// MATTERCHAT — Paper & Sky is a skin, so it must replace the Variant B brand layer
	// rather than paint underneath it. A skin resolves to `dark`, so without the gate in
	// MainLayoutStyleTags the green ledger and premium palettes would still be emitted.
	//
	// PaletteStyleTag injects into document.head, which testing-library's cleanup does not
	// touch — tags from earlier tests in this file survive. An absence assertion is
	// therefore meaningless unless the tags are cleared first, or it passes on test order
	// rather than on behaviour.
	const clearPalettes = () => {
		document.head.querySelectorAll('[id*="-palette"]').forEach((el) => el.remove());
	};

	it.each(['paper-sky', 'paper-sky-indigo'] as const)('should not emit the Variant B brand palettes on %s', (skin) => {
		clearPalettes();

		render(<MainLayoutStyleTags />, {
			wrapper: mockAppRoot().withUserPreference('themeAppearence', skin).build(),
		});

		expect(queryByAttribute('id', document.head, 'ledger-palette-dark')).toBeNull();
		expect(queryByAttribute('id', document.head, 'premium-refresh-palette-dark')).toBeNull();
	});

	// The other half of the gate: proof the assertion above is not passing simply because
	// nothing ever emits these tags.
	it('should still emit the Variant B brand palettes on dark', () => {
		clearPalettes();

		render(<MainLayoutStyleTags />, {
			wrapper: mockAppRoot().withUserPreference('themeAppearence', 'dark').build(),
		});

		const ledger = queryByAttribute('id', document.head, 'ledger-palette-dark');
		expect(ledger).not.toBeNull();
	});
});

it('should create the Dark theme style tag', () => {
	render(<MainLayoutStyleTags />, {
		wrapper: mockAppRoot().withUserPreference('themeAppearence', 'dark').build(),
	});
	const tagDark = queryByAttribute('id', document.head, 'main-palette-dark');
	expect(tagDark).not.toBeNull();
});

it('should create the codeBlock style tag when in dark mode', () => {
	render(<MainLayoutStyleTags />, {
		wrapper: mockAppRoot().withUserPreference('themeAppearence', 'dark').build(),
	});
	const style = queryByAttribute('id', document.head, 'codeBlock-palette');
	expect(style).not.toBeNull();
});
