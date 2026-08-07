/**
 * MATTERCHAT: permanent community-edition license service — MIT replacement for the EE
 * `@rocket.chat/license` package.
 *
 * MatterChat runs as pure MIT with no Rocket.Chat subscription, so this package answers every
 * license question the way a community-edition install with no license should: no valid license,
 * no premium modules, no seat limits, no air-gapped restriction, and listener registrars that
 * never fire. The exported surface mirrors exactly what MIT core imports (audited 2026-07-30 —
 * see docs/design/MATTERCHAT-EE-REMOVAL-PLAN.md): `License`, `applyLicense`,
 * `DuplicatedLicenseError`, `AirGappedRestriction`, plus the deep import
 * `@rocket.chat/license/src/validation/validateLimit` used by the client.
 *
 * Semantics chosen per call site (all audited):
 * - `hasValidLicense()` → false: gates guest-permission whitelisting, cloud sync branches and
 *   admin UI — all correctly dormant on CE.
 * - `shouldPreventAction()` → false: NEVER block an action (LDAP user conversion, omnichannel
 *   MAC checks) — community edition is unlimited here.
 * - `getGuestPermissions()` is only reachable behind `hasValidLicense()`, so its value is moot.
 * - `hasOfflineLicense()` → false (added for RC 8.7.0, upstream PR #41148): 8.7.0 introduced an
 *   air-gapped licence flag whose ~15 call sites all read "if the workspace holds an OFFLINE
 *   licence, suppress this outbound Rocket.Chat/Gravatar/push-gateway call". `false` means "no
 *   offline licence", so every guard falls through and cloud sync, the supported-versions fetch,
 *   the usage report, push-gateway delivery and Gravatar suggestions behave EXACTLY as they did
 *   before the merge. Returning `true` would silently disable them. A workspace that has no
 *   licence at all cannot have an offline one, so `false` is the correct answer, not a stub.
 * - `getWorkspaceUrl()/getHashedWorkspaceUrl()` → undefined: cloud-registration concepts; the
 *   MIT call sites (getServerInfo, serverRunning banner) tolerate undefined.
 * - Listener registrars (`onValidateLicense`, `onValidFeature`, `onLimitReached`, ...) register
 *   nothing and return a no-op unsubscriber — with no license there is nothing to fire.
 */

type Unsubscribe = () => void;

const noopUnsubscribe: Unsubscribe = () => undefined;

class LicenseService {
	/** No license is ever installed on a MatterChat workspace. */
	public hasValidLicense(): boolean {
		return false;
	}

	/** No premium module is ever active. */
	public hasModule(_module: string): boolean {
		return false;
	}

	public getModules(): string[] {
		return [];
	}

	public getTags(): { name: string; color: string }[] {
		return [];
	}

	public getLicense(): undefined {
		return undefined;
	}

	/**
	 * No license is installed, so none can carry the air-gapped `information.offline` flag.
	 * Upstream computes `getLicense()?.information.offline ?? false`; with `getLicense()`
	 * permanently `undefined` that expression is `false` by construction, so this is the
	 * faithful CE answer rather than a stub — see the header note on cloud egress.
	 */
	public hasOfflineLicense(): boolean {
		return false;
	}

	/** Community edition never prevents an action for licensing reasons (unlimited seats/MAC). */
	public async shouldPreventAction(_action: string, _extraCount = 0): Promise<boolean> {
		return false;
	}

	public async getGuestPermissions(): Promise<undefined> {
		// Unreachable in practice: every caller first checks hasValidLicense().
		return undefined;
	}

	public getWorkspaceUrl(): undefined {
		return undefined;
	}

	public getHashedWorkspaceUrl(): undefined {
		return undefined;
	}

	public async getMaxActiveUsers(): Promise<number> {
		return 0;
	}

	// --- listener registrars: nothing ever fires without a license -------------------------

	public onValidateLicense(_cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	public onInvalidateLicense(_cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	public onValidFeature(_feature: string, _cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	public onInvalidFeature(_feature: string, _cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	public onLimitReached(_limit: string, _cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	public onBehaviorTriggered(_behavior: string, _cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	public onModuleChange(_cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	public onRemoveLicense(_cb: () => unknown): Unsubscribe {
		return noopUnsubscribe;
	}

	// EventEmitter-shaped compatibility (some callers use generic emitter methods).
	public on(_event: string, _cb: (...args: unknown[]) => unknown): this {
		return this;
	}

	public once(_event: string, _cb: (...args: unknown[]) => unknown): this {
		return this;
	}

	public off(_event: string, _cb: (...args: unknown[]) => unknown): this {
		return this;
	}

	public async setLicense(_encryptedLicense: string, _isNewLicense?: boolean): Promise<boolean> {
		return false;
	}

	public validateFormat(_encryptedLicense: string): boolean {
		return false;
	}
}

export const License = new LicenseService();

/** Type alias kept for test/type imports of the EE implementation class. */
export type LicenseImp = LicenseService;

/** Cloud sync throws/ignores this when the same license arrives twice; kept for instanceof checks. */
export class DuplicatedLicenseError extends Error {
	constructor(message = 'Duplicated license') {
		super(message);
		this.name = 'DuplicatedLicenseError';
	}
}

/**
 * Cloud registration calls this with a license payload. MatterChat never applies licenses;
 * returning false tells the caller nothing changed. Never throws.
 */
export async function applyLicense(_license: string, _isNewLicense: boolean): Promise<boolean> {
	return false;
}

/**
 * The air-gapped restriction machinery, permanently disarmed: MatterChat workspaces are never
 * restricted, there is no warning period, and computing the restriction is a no-op. The
 * `Cloud_Workspace_AirGapped_Restrictions_Remaining_Days` setting (if present in Mongo from the
 * EE era) is simply never updated again; the client treats absent/negative values as unrestricted.
 */
export const AirGappedRestriction = {
	get restricted(): boolean {
		return false;
	},
	isWarningPeriod(_days: number): boolean {
		return false;
	},
	async computeRestriction(_token?: string): Promise<void> {
		return undefined;
	},
	on(_event: string, _cb: (...args: unknown[]) => unknown): void {
		return undefined;
	},
	off(_event: string, _cb: (...args: unknown[]) => unknown): void {
		return undefined;
	},
};

export { validateWarnLimit } from './validation/validateLimit';
