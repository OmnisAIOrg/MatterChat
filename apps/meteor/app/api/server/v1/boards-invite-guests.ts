import { Boards, Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../../authorization/server/functions/hasPermission';
import { assertBoardRole, requireUid } from '../../../lib/boards/permissions';
import { api } from '../api';

// MATTERCHAT: Endpoint for inviting guest users to boards.
// Guests are assigned observer role and can only access invited boards/channels.
// All exports are watermarked for guests.

api.v1.addRoute(
	'boards.inviteGuests',
	{ authRequired: true },
	{
		async post() {
			const uid = requireUid('boards.inviteGuests');
			const { boardId, emails, message } = this.bodyParams;

			if (!boardId || typeof boardId !== 'string') {
				return api.v1.failure('Invalid board ID');
			}

			if (!Array.isArray(emails) || emails.length === 0) {
				return api.v1.failure('At least one email is required');
			}

			try {
				// MATTERCHAT: Check user has board member access (member or admin role)
				const board = await assertBoardRole(boardId, uid, 'member', 'boards.inviteGuests');

				// Validate emails and find or create guest users
				const invited: { email: string; userId: string }[] = [];
				const errors: { email: string; error: string }[] = [];

				for (const email of emails) {
					try {
						const trimmedEmail = email.trim().toLowerCase();

						// Validate email format
						if (!trimmedEmail.includes('@')) {
							errors.push({ email, error: 'Invalid email format' });
							continue;
						}

						// Check if user exists
						let user = await Users.findOneByEmailAddress(trimmedEmail);

						// If user doesn't exist, create a guest user
						if (!user) {
							const username = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`;
							const userId = (
								await Users.create({
									name: trimmedEmail.split('@')[0],
									username,
									emails: [{ address: trimmedEmail, verified: false }],
									active: true,
									type: 'user',
								})
							).insertedId;

							// Add guest role to new user
							const guestRole = await (Users as any).findOneAndUpdate(
								{ _id: userId },
								{ $addToSet: { roles: 'guest' } },
								{ returnDocument: 'after' }
							);

							user = guestRole.value;
						}

						if (user) {
							// Add user to board as observer
							await Boards.findOneAndUpdate(
								{ _id: boardId },
								{
									$addToSet: {
										members: {
											userId: user._id,
											role: 'observer',
											createdAt: new Date(),
										},
									},
								}
							);

							invited.push({ email: trimmedEmail, userId: user._id });
						}
					} catch (e) {
						errors.push({ email, error: (e as Error).message });
					}
				}

				return api.v1.success({
					invited: invited.length,
					errors: errors.length > 0 ? errors : undefined,
					result: invited,
				});
			} catch (e) {
				return api.v1.failure((e as Error).message);
			}
		},
	}
);
