import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WindowLights from './WindowLights';

/**
 * WindowLights is a SAFETY-CRITICAL component, not a decoration.
 *
 * The desktop shell runs frameless + transparent so the workspace tab can protrude outside the
 * bezel, which means macOS draws no traffic lights and Windows/Linux draw no caption buttons. These
 * buttons are then the ONLY way to close, minimise or zoom the window. If this component fails to
 * render — or renders but doesn't reach the IPC — a user is stuck with force-quit.
 *
 * The inverse matters just as much: on the web, the PWA, and desktop builds that predate the
 * `frameless` capability, the OS still draws real controls, and painting a second fake set on top
 * of them would be worse than painting none. So "renders nothing" is the required behavior
 * everywhere except a confirmed frameless shell.
 */

type Bridge = {
	frameless?: boolean;
	windowClose?: () => Promise<unknown>;
	windowMinimize?: () => Promise<unknown>;
	windowMaximize?: () => Promise<unknown>;
};

const setBridge = (bridge: Bridge | undefined): void => {
	(window as unknown as { matterchatDesktop?: Bridge }).matterchatDesktop = bridge;
};

describe('WindowLights', () => {
	afterEach(() => setBridge(undefined));

	it('renders nothing in a browser (no desktop bridge at all)', () => {
		setBridge(undefined);
		const { container } = render(<WindowLights />);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders nothing on a desktop build that still has native chrome', () => {
		// Older shells expose the bridge but not the frameless flag — they keep their OS controls.
		setBridge({ windowClose: jest.fn() });
		const { container } = render(<WindowLights />);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders nothing if a shell claims frameless but cannot actually close the window', async () => {
		// Drawing lights that do nothing is the worst outcome: it LOOKS like the user can close the
		// window while the only real exit is force-quit. Falling back to native chrome is safer.
		setBridge({ frameless: true });
		const { container } = render(<WindowLights />);
		await waitFor(() => expect(container).toBeEmptyDOMElement());
	});

	describe('on a frameless shell', () => {
		const bridge = {
			frameless: true,
			windowClose: jest.fn().mockResolvedValue(true),
			windowMinimize: jest.fn().mockResolvedValue(true),
			windowMaximize: jest.fn().mockResolvedValue(true),
		};

		beforeEach(() => {
			jest.clearAllMocks();
			setBridge(bridge);
		});

		it('renders all three controls', async () => {
			render(<WindowLights />);
			await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument());
			expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Zoom' })).toBeInTheDocument();
		});

		it('closes the window — the one that strands the user if it breaks', async () => {
			render(<WindowLights />);
			await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument());
			await userEvent.click(screen.getByRole('button', { name: 'Close' }));
			expect(bridge.windowClose).toHaveBeenCalledTimes(1);
		});

		it('minimizes and zooms through their own handlers, not the close one', async () => {
			render(<WindowLights />);
			await waitFor(() => expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument());

			await userEvent.click(screen.getByRole('button', { name: 'Minimize' }));
			expect(bridge.windowMinimize).toHaveBeenCalledTimes(1);

			await userEvent.click(screen.getByRole('button', { name: 'Zoom' }));
			expect(bridge.windowMaximize).toHaveBeenCalledTimes(1);

			// A mis-wired switch that closed the window on minimise would be catastrophic and easy to
			// introduce, since all three buttons share one handler.
			expect(bridge.windowClose).not.toHaveBeenCalled();
		});

		it('carries the class that opts it out of the window drag region', async () => {
			// The NavBar is a drag surface, so without a no-drag opt-out these buttons would drag the
			// window instead of clicking — indistinguishable from "the close button is broken", on a
			// window with no other way to close.
			//
			// The inline `-webkit-app-region` cannot be asserted here: jsdom drops CSS properties it
			// doesn't recognise, so it never reaches the style attribute in this environment. Verified
			// separately in real Chromium 148, where both the prefixed and unprefixed forms are
			// supported. What IS assertable is the class, which depthSkin.ts backs with the same rule.
			render(<WindowLights />);
			await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument());
			expect(screen.getByRole('group', { name: 'Window controls' })).toHaveClass('mc-window-lights');
		});
	});
});
