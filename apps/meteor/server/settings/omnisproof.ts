import { settingsRegistry } from '.';
import { addOmnisConnectionSettings } from './omnis-product';

/**
 * OmnisProof e-signature settings: the shared seven, plus the webhook secret.
 *
 * The secret has no usable default and none is invented. An empty secret makes
 * `omnisproof.webhook` reject every delivery, which is the correct failure mode
 * — that endpoint can move a matter's status, set its fee percentage and start
 * its statute-of-limitations clock, so it must never accept unauthenticated
 * traffic just because it has not been configured yet.
 */
export const createOmnisProofSettings = () =>
	settingsRegistry.addGroup('OmnisProof', async function () {
		await addOmnisConnectionSettings(this, {
			product: 'OmnisProof',
			baseUrlPlaceholder: 'https://proof.stg-omnisai.io',
			webUrlPlaceholder: 'https://proof.omnisai.io',
		});

		await this.add('OmnisProof_Webhook_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'OmnisProof_Webhook_Secret',
			i18nDescription: 'OmnisProof_Webhook_Secret_Description',
		});
	});
