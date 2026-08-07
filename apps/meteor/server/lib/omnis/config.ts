import type { SettingValue } from '@rocket.chat/core-typings';

import { settings } from '../../settings';
import { SystemLogger } from '../logger/system';

/**
 * Shared connection-config resolver for the Omnis product integrations
 * (AutoDoc, OmnisProof, CaseNotes, LitBox upload links).
 *
 * This is `server/lib/boards/casepro/config.ts` generalised over a product
 * prefix. That module stays as-is — it carries CasePro-specific concerns (the
 * legacy 'rest' transport, the mcp path) this one deliberately does not — but
 * every rule it established is preserved here, because each one exists to close
 * a real footgun:
 *
 *   - ONE resolver per product, so reads and writes can never disagree about
 *     whether the integration is enabled (the stub-banner / fabricated-data bug);
 *   - env-then-setting precedence for everything EXCEPT `enabled`, which is
 *     setting-first (the admin toggle is the live kill switch; env only seeds
 *     environments with no settings UI);
 *   - `safeGetSetting` so the module works before the settings zone has
 *     registered (early boot, unit tests);
 *   - degrade to 'stub' when a live transport is selected without a base URL,
 *     warning exactly once, so a half-configured workspace still renders.
 *
 * Defaulting to 'stub' is what lets the whole feature — widgets, panels,
 * actions, receipts — be reviewed before a single credential exists.
 */

export type OmnisTransportKind = 'stub' | 'native';

export type OmnisAuthMode = 'internal-key' | 'bearer';

/** The seven settings every Omnis product integration registers. */
export type OmnisProductConfig = {
	/** `<Product>_Enabled`. false = the client renders nothing at all. */
	enabled: boolean;
	/** Effective transport AFTER fallbacks (missing base URL → 'stub'). */
	transport: OmnisTransportKind;
	/** `<Product>_Base_URL` ('' when unset). */
	baseUrl: string;
	/** `<Product>_Auth_Mode` (default 'internal-key'). */
	authMode: OmnisAuthMode;
	/** `<Product>_Api_Key` (secret; '' when unset). */
	apiKey: string;
	/** `<Product>_Org_Id` — the org scope every call carries. */
	orgId: string;
	/** `<Product>_Web_URL` — web app base for "Open in <product>"; '' hides the links. */
	webUrl: string;
};

/**
 * Identifies one product's settings/env namespace, e.g.
 * `{ setting: 'AutoDoc', env: 'AUTODOC' }` → `AutoDoc_Base_URL` / `AUTODOC_BASE_URL`.
 */
export type OmnisProductNamespace = {
	setting: string;
	env: string;
};

/** `settings.get` throws when the setting is not yet registered (early boot / tests). */
export function safeGetSetting<T extends SettingValue>(id: string): T | undefined {
	try {
		return settings.get<T>(id);
	} catch {
		return undefined;
	}
}

/** Non-empty trimmed env var, else undefined. */
function env(name: string): string | undefined {
	const value = process.env[name];
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

/** Env-first string read (envChoice || settingChoice || fallback). */
export function readString(envName: string, settingId: string, fallback = ''): string {
	const fromEnv = env(envName);
	if (fromEnv !== undefined) {
		return fromEnv;
	}
	const fromSetting = safeGetSetting<string>(settingId);
	return typeof fromSetting === 'string' && fromSetting.trim() !== '' ? fromSetting.trim() : fallback;
}

/** Env-first positive-integer read, clamped to `min`. */
export function readInt(envName: string, settingId: string, fallback: number, min = 0): number {
	const raw = env(envName) ?? safeGetSetting<number | string>(settingId);
	const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
	if (!Number.isFinite(parsed)) {
		return Math.max(fallback, min);
	}
	return Math.max(parsed, min);
}

/** One warn per distinct misconfiguration per process — config is re-resolved on every read. */
const warned = new Set<string>();

export function warnOnce(key: string, msg: string, extra?: Record<string, unknown>): void {
	if (warned.has(key)) {
		return;
	}
	warned.add(key);
	SystemLogger.warn({ msg, ...extra });
}

/** Test seam: forget which warnings have fired. */
export function resetWarnOnceForTests(): void {
	warned.clear();
}

/**
 * Resolve one product's config. Fallback rules (each warns once):
 *   - unknown transport value → 'stub';
 *   - 'native' chosen without a base URL → 'stub' (the widget keeps rendering fixtures);
 *   - unknown auth mode → 'internal-key'.
 */
export function resolveOmnisConfig(ns: OmnisProductNamespace): OmnisProductConfig {
	const rawChoice = (env(`${ns.env}_TRANSPORT`) || safeGetSetting<string>(`${ns.setting}_Transport`) || 'stub').toString().trim().toLowerCase();

	let transport: OmnisTransportKind;
	if (rawChoice === 'stub' || rawChoice === 'native') {
		transport = rawChoice;
	} else {
		warnOnce(`${ns.setting}-transport-unknown-${rawChoice}`, `Unknown ${ns.setting} transport '${rawChoice}' — falling back to stub`);
		transport = 'stub';
	}

	const baseUrl = readString(`${ns.env}_BASE_URL`, `${ns.setting}_Base_URL`);
	if (transport !== 'stub' && !baseUrl) {
		warnOnce(
			`${ns.setting}-transport-no-base-url`,
			`${ns.setting} transport '${transport}' selected but no base URL configured — falling back to stub`,
		);
		transport = 'stub';
	}

	const rawAuthMode = readString(`${ns.env}_AUTH_MODE`, `${ns.setting}_Auth_Mode`, 'internal-key').toLowerCase();
	let authMode: OmnisAuthMode;
	if (rawAuthMode === 'internal-key' || rawAuthMode === 'bearer') {
		authMode = rawAuthMode;
	} else {
		warnOnce(`${ns.setting}-auth-mode-unknown-${rawAuthMode}`, `Unknown ${ns.setting} auth mode '${rawAuthMode}' — using 'internal-key'`);
		authMode = 'internal-key';
	}

	// enabled: setting first (the live admin toggle), env fallback when unregistered/unset.
	const enabledSetting = safeGetSetting<boolean>(`${ns.setting}_Enabled`);
	const enabledEnv = env(`${ns.env}_ENABLED`);
	const enabled = typeof enabledSetting === 'boolean' ? enabledSetting : enabledEnv === 'true' || enabledEnv === '1';

	return {
		enabled,
		transport,
		baseUrl,
		authMode,
		apiKey: readString(`${ns.env}_API_KEY`, `${ns.setting}_Api_Key`),
		orgId: readString(`${ns.env}_ORG_ID`, `${ns.setting}_Org_Id`),
		webUrl: readString(`${ns.env}_WEB_URL`, `${ns.setting}_Web_URL`),
	};
}

/** Stable identity of a resolved config — memoizes live transport instances. */
export function omnisConfigFingerprint(cfg: OmnisProductConfig): string {
	return [cfg.enabled ? '1' : '0', cfg.transport, cfg.baseUrl, cfg.authMode, cfg.apiKey, cfg.orgId].join(' ');
}
