/**
 * MATTERCHAT: MIT clean-room port of the small `Utilities` helper that used to live in the EE
 * tree (ee/lib/misc/Utilities — removed with the rest of the Enterprise code). Only the two
 * members actually consumed by MIT code are provided:
 *
 * - `getI18nKeyForApp(key, appId)` — Rocket.Chat Apps register their translations namespaced by
 *   app id, so UI surfaces look app-scoped keys up as `<appId>.<key>`. With the Apps engine
 *   dropped these call sites are dormant, but they must keep compiling and behave sanely.
 * - `curl(options)` — renders a copy-pasteable curl command for an app API endpoint (marketplace
 *   "APIs" panel).
 */

type CurlOptions = {
	url: string;
	method: string;
	params?: Record<string, string>;
	query?: Record<string, string>;
	content?: string;
	headers?: Record<string, string>;
	auth?: string;
};

export const Utilities = {
	getI18nKeyForApp(key: string | undefined, appId: string): string {
		if (!key) {
			return key as unknown as string;
		}
		return `${appId}.${key}`;
	},

	curl({ url, method, query, content, headers, auth }: CurlOptions): string {
		const lines: string[] = [];

		const queryString = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : '';

		lines.push(`curl -X ${method.toUpperCase()} \\`);

		if (auth) {
			lines.push(`  -u ${auth} \\`);
		}

		Object.entries(headers ?? {}).forEach(([header, value]) => {
			lines.push(`  -H "${header}: ${value}" \\`);
		});

		if (content) {
			lines.push(`  -H "Content-Type: application/json" \\`);
			lines.push(`  -d '${typeof content === 'string' ? content : JSON.stringify(content)}' \\`);
		}

		lines.push(`  ${url}${queryString}`);

		return lines.join('\n');
	},
};
