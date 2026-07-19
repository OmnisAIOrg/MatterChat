import type { Db } from 'mongodb';

const migration = {
	version: '342.0.0',
	up: async (db: Db) => {
		// Create the boards_user_notification_prefs collection with indexes
		const collection = db.collection('boards_user_notification_prefs');

		// Ensure the collection exists
		await collection.createIndex({ userId: 1 }, { unique: true });

		// Index on mutedBoards for quick mute checks
		await collection.createIndex({ 'mutedBoards.0': 1 });
	},
};

export default migration;
