/**
 * Chi Admin Assistant — pending-confirmation store.
 *
 * Destructive/bulk tools don't run on the model's say-so alone: the service parks the exact
 * tool call here and asks the admin to type `confirm`. On `confirm` the PARKED call runs
 * verbatim (no second model pass — deterministic); anything else clears it. In-memory by
 * design: prod runs a single instance (see kubernetes/production/matterchat-deployment.yaml
 * replicas rationale), and a lost pod merely drops the pending question — never an action.
 */

export type PendingAction = {
	/** DM room the plan was proposed in. */
	rid: string;
	/** Admin who must confirm (the same user the tool will execute as). */
	userId: string;
	toolName: string;
	input: Record<string, unknown>;
	/** Human summary the bot showed when parking. */
	summary: string;
	expiresAt: number;
};

const TTL_MS = 5 * 60 * 1000;

const pending = new Map<string, PendingAction>();

const keyOf = (rid: string, userId: string): string => `${rid}:${userId}`;

export function parkPendingAction(action: Omit<PendingAction, 'expiresAt'>, nowMs = Date.now()): void {
	pending.set(keyOf(action.rid, action.userId), { ...action, expiresAt: nowMs + TTL_MS });
}

/** Read AND consume the pending action for this admin+room (one-shot), if fresh. */
export function takePendingAction(rid: string, userId: string, nowMs = Date.now()): PendingAction | undefined {
	const key = keyOf(rid, userId);
	const found = pending.get(key);
	if (!found) {
		return undefined;
	}
	pending.delete(key);
	if (found.expiresAt <= nowMs) {
		return undefined; // expired — treat as absent
	}
	return found;
}

export function hasPendingAction(rid: string, userId: string, nowMs = Date.now()): boolean {
	const found = pending.get(keyOf(rid, userId));
	return !!found && found.expiresAt > nowMs;
}

export function clearPendingAction(rid: string, userId: string): void {
	pending.delete(keyOf(rid, userId));
}
