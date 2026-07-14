/**
 * PURE email→card field parsing (no Meteor / Mongo imports) so it unit-tests directly. The card
 * creator (emailToTask.ts) composes this with the createCard service path.
 */

/** The normalized inbound email shape parsed into card fields. */
export type InboundEmail = {
	/** Subject line → card title. */
	subject?: string;
	/** Plain-text body → card description. */
	text?: string;
	/** Sender address (recorded in the description for provenance). */
	from?: string;
	/** The address the mail was sent to — used to resolve which board+list it targets. */
	to?: string;
};

const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 8000;

/** Strip control chars, collapse whitespace, and cap length. */
export function clean(value: string | undefined, max: number): string {
	return (
		String(value ?? '')
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f\u007f]/g, ' ')
			.replace(/[ \t]+/g, ' ')
			.trim()
			.slice(0, max)
	);
}
/**
 * Parse an inbound email into the card fields. PURE — no I/O. An empty/whitespace subject falls back
 * to "(no subject)". The body becomes the description, prefixed with the sender for provenance.
 */
export function parseEmailToCard(email: InboundEmail): { title: string; description: string } {
	const subject = clean(email.subject, MAX_TITLE_LEN) || '(no subject)';
	const bodyText = clean(email.text, MAX_BODY_LEN);
	const from = clean(email.from, 320);
	const descriptionParts = [from ? `From: ${from}` : undefined, bodyText || undefined].filter(Boolean);
	return {
		title: subject,
		description: descriptionParts.join('\n\n'),
	};
}
