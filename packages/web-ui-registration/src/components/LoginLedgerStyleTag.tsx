import type { ReactElement } from 'react';

/**
 * ============================================================================
 * "LEDGER-DENSE" — the MatterChat brand skin for the LOGGED-OUT surfaces
 * (login / register / reset-password), Wave 2 UI-polish.
 * ============================================================================
 *
 * The logged-out counterpart of the chat-surface skin in
 * client/views/root/MainLayout/MainLayoutStyleTags.tsx — SAME token values
 * (paper #FAF7EE light / #12161D dark, card #fffdf6 / #1A2029, khaki #C9BE9A /
 * slate #3A414D hairlines, brand green #1B7A2E with #15692A/#5BD07E links, the
 * Iowan/Palatino serif caption stack). Do not drift from that file.
 *
 * PRESENTATION ONLY: a scoped <style> tag mounted by the two wizard templates,
 * under the `.mc-login` class those templates add. No auth logic, endpoint, or
 * flow is touched. Both templates render inside @rocket.chat/layout, whose
 * DarkModeProvider follows the OS `prefers-color-scheme` — so the dark variant
 * here uses the same media query and the two always agree.
 *
 * SELECTOR NOTES (@rocket.chat/layout has NO stable classes — its styled()
 * helper hashes class names — so we lean on stable structure instead):
 *   - `.mc-login > div`        the BackgroundLayer wrapper (the page ground);
 *                              the only other direct children are <style> tags.
 *   - `.mc-login .rcx-tile`    the login/register card — layout's <Form> is a
 *                              Fuselage Tile rendered as <form>.
 *   - `.mc-login h1`           the big aside headline (FormPageLayout.Title).
 *   - `.mc-login #welcomeTitle` the RegisterTitle span (present in BOTH the
 *                              horizontal h1 and the vertical Box title).
 *   - Buttons/links re-brand through the Fuselage `--rcx-color-*` vars (same
 *              mechanism as the ledger palette on the chat surface).
 */

const LEDGER_SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";

// Brand green stays the ACTION color in both themes (mirrors BRAND in MainLayoutStyleTags).
const LOGIN_LEDGER_CSS = `
.mc-login {
	--rcx-color-button-background-primary-default: #1B7A2E;
	--rcx-color-button-background-primary-hover: #176B2C;
	--rcx-color-button-background-primary-press: #125A24;
	--rcx-color-button-background-primary-focus: #1B7A2E;
	--rcx-color-button-background-primary-keyfocus: #1B7A2E;
	--rcx-color-stroke-highlight: #1B7A2E;
	--rcx-color-shadow-highlight: #D6EFDC;
	--rcx-color-font-info: #15692A;
}

/* Page ground: warm paper replaces the stock RC svg backdrop. */
.mc-login > div {
	background-image: none !important;
	background-color: #FAF7EE !important;
}

/* The login/register card: paper card face, khaki hairline, condensed padding
   (stock is 40px all around — too airy for the ledger language). */
.mc-login .rcx-tile {
	background-color: #FFFDF6 !important;
	border: 1px solid rgba(201, 190, 154, 0.6);
	border-radius: 10px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	padding: 28px !important;
}

/* Serif "case caption" welcome headline — condensed from the stock 48/64. */
.mc-login #welcomeTitle {
	font-family: ${LEDGER_SERIF};
	font-weight: 600;
	letter-spacing: 0.005em;
}
.mc-login h1 {
	font-size: 2.125rem;
	line-height: 2.75rem;
	padding-block-end: 16px;
}

/* Calm dense dark surface — never inverted paper (same values as the app skin). */
@media (prefers-color-scheme: dark) {
	.mc-login {
		--rcx-color-shadow-highlight: rgba(67, 177, 95, 0.28);
		--rcx-color-stroke-highlight: #43B15F;
		--rcx-color-font-info: #5BD07E;
	}
	.mc-login > div {
		background-color: #12161D !important;
	}
	.mc-login .rcx-tile {
		background-color: #1A2029 !important;
		border-color: rgba(58, 65, 77, 0.9);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
	}
}
`;

/** Static, no user input — same dangerouslySetInnerHTML precedent as MainLayoutStyleTags. */
export const LoginLedgerStyleTag = (): ReactElement => <style dangerouslySetInnerHTML={{ __html: LOGIN_LEDGER_CSS }} />;

export default LoginLedgerStyleTag;
