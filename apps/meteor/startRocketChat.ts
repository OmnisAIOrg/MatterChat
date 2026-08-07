// MATTERCHAT: pure-MIT boot path. This file used to start the Enterprise stack (EE broker,
// license service, Matrix federation service); MatterChat removed the EE tree entirely
// (docs/design/MATTERCHAT-EE-REMOVAL-PLAN.md), so — like upstream's FOSS build — there is
// nothing licensed to start here.
// 8.7.0 added enforceFipsLicense() here; that is EE-only as well, so it stays out.
export const startRocketChat = async () => {
	// Nothing to do here
};
