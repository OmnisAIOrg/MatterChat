import type { OmnisProductConfig } from '../omnis/config';
import { readString, resolveOmnisConfig } from '../omnis/config';

/** OmnisProof connection config: the shared seven, plus the webhook secret. */

export const OMNISPROOF_NS = { setting: 'OmnisProof', env: 'OMNISPROOF' } as const;

export type OmnisProofConfig = OmnisProductConfig & {
	/**
	 * HMAC secret for envelope-lifecycle callbacks. Empty ⇒ every webhook
	 * delivery is REJECTED, because this endpoint can move a matter's status and
	 * start its limitations clock. See `verifyWebhookSignature`.
	 */
	webhookSecret: string;
};

export function resolveOmnisProofConfig(): OmnisProofConfig {
	return {
		...resolveOmnisConfig(OMNISPROOF_NS),
		webhookSecret: readString('OMNISPROOF_WEBHOOK_SECRET', 'OmnisProof_Webhook_Secret'),
	};
}
