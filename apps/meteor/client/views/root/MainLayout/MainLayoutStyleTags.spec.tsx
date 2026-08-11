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
	// rather than paint underneath it. A skin resolves to `dark`, so without the gate
	// the green ledger and premium palettes would still be emitted.
	it.each(['paper-sky', 'paper-sky-indigo'] as const)('should not emit the Variant B brand palettes on %s', (skin) => {
		render(<MainLayoutStyleTags />, {
			wrapper: mockAppRoot().withUserPreference('themeAppearence', skin).build(),
		});

		expect(queryByAttribute('id', document.head, 'ledger-palette-dark')).toBeNull();
		expect(queryByAttribute('id', document.head, 'premium-refresh-palette-dark')).toBeNull();
	});

	it('should still emit the Variant B brand palettes on dark', () => {
		render(<MainLayoutStyleTags />, {
			wrapper: mockAppRoot().withUserPreference('themeAppearence', 'dark').build(),
		});

		expect(queryByAttribute('id', document.head, 'ledger-palette-dark')).not.toBeNull();
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
