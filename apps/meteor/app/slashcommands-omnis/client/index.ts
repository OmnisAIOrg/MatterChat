import { slashCommands } from '../../utils/client/slashCommand';

/**
 * Client registration for the Omnis Boards slash commands (/task, /lead, /matter).
 * Server handlers live in ../server. These entries drive the in-composer autocomplete.
 */
slashCommands.add({
	command: 'task',
	options: { description: 'Create a task card on your Matters board', params: 'task title' },
	providesPreview: false,
});

slashCommands.add({
	command: 'lead',
	options: { description: 'Create a new lead', params: 'contact name' },
	providesPreview: false,
});

slashCommands.add({
	command: 'matter',
	options: { description: 'Add a CasePro matter to your Matters board', params: 'matter id' },
	providesPreview: false,
});
