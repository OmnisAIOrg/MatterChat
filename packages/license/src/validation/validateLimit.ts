/**
 * MATTERCHAT: MIT replacement for the EE limit-validation helper.
 *
 * The client imports this via the deep specifier
 * `@rocket.chat/license/src/validation/validateLimit` (useLicenseLimitsByBehavior) to decide
 * whether a license limit is close enough to its max to warrant a warning. On MatterChat no
 * license is ever installed, so the consuming hook bails out before calling this (its
 * `useLicense()` data has no license); the implementation below exists so the import resolves
 * and behaves sanely if a license object ever does appear: warn once the current value has
 * reached the limit's max.
 */

export const validateWarnLimit = (max: number, currentValue: number, behavior: string): boolean => {
	if (behavior !== 'start_fair_policy' && behavior !== 'prevent_action' && behavior !== 'invalidate_license') {
		return false;
	}
	if (max < 0) {
		return false;
	}
	return currentValue >= max;
};
