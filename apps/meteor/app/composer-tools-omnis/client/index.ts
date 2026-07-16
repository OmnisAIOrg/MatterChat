/**
 * MatterChat fork — composer tools (Wave 2 chat improvement #2).
 *
 * Adds legal-team composer tools purely additively:
 *  - "+" menu → "Canned replies": pick a saved reply template, inserted into the
 *    composer for editing. Starter templates ship in; users add their own.
 *  - "+" menu → "Attach from LitBox": insert a link to the matter's files
 *    (scoped to the room's matter workspace when linked, else the org LitBox).
 *  - /canned and /snippet slash commands: open the same picker.
 *
 * Everything registers through the built-in `messageBox.actions` and
 * `slashCommands.add` APIs — no edits to the composer/toolbar core.
 */
import { registerComposerActions } from './registerComposerActions';
import './registerSlashCommands';

registerComposerActions();
