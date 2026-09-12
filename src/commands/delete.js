// `delete`: the only command that can modify Gmail. Moves matching messages
// to Trash (never permanent deletion) after an explicit typed confirmation.
// Supports --dry-run, which performs the full scan but makes zero changes.

import { authorize } from '../auth.js';
import { getGmailClient, listAllMessageIds, trashMessages, DEFAULT_BATCH_SIZE } from '../gmail.js';
import {
  heading,
  info,
  warn,
  success,
  error,
  prompt,
  renderProgress,
  formatNumber,
  DEFAULT_QUERY,
} from '../utils.js';

const CONFIRMATION_WORD = 'DELETE';

// Queries broad enough to reach outside the inbox (or unscoped entirely)
// get an extra, more visible warning. We never rewrite the user's query —
// only warn about it.
function isBroadQuery(query) {
  const q = query.toLowerCase();
  return q.includes('in:anywhere') || !q.includes('in:');
}

export async function runDelete(query = DEFAULT_QUERY, { dryRun = false } = {}) {
  heading('Gmail Cleanup');

  if (!query || query.trim() === '') {
    error('Refusing to run with an empty query. Please provide a Gmail search query.');
    process.exitCode = 1;
    return;
  }

  console.log(`Query:\n${query}\n`);

  if (isBroadQuery(query)) {
    warn(
      'This query is not scoped to a specific label such as "in:inbox".\n' +
        '  It may match messages OUTSIDE your inbox (e.g. all mail, or "in:anywhere").\n' +
        '  Double-check this is really what you want before continuing.'
    );
    console.log();
  }

  const auth = await authorize();
  const gmail = getGmailClient(auth);

  info('Scanning Gmail...');
  const ids = await listAllMessageIds(gmail, query);

  console.log(`\nMessages found:\n${formatNumber(ids.length)}\n`);

  if (ids.length === 0) {
    console.log('No matching messages. Nothing to do.');
    return;
  }

  console.log('ACTION:');
  console.log('These messages will be moved to Gmail Trash.\n');
  console.log('This action will modify your Gmail account.\n');

  if (dryRun) {
    warn('DRY RUN: no changes will be made. This is a preview of what would happen.');
    console.log(
      `\nIf run for real, ${formatNumber(ids.length)} message(s) would be moved to Trash ` +
        `in batches of ${DEFAULT_BATCH_SIZE}.`
    );
    console.log('\nNo emails were modified.');
    return;
  }

  const answer = await prompt(`Type ${CONFIRMATION_WORD} to continue: `);
  if (answer !== CONFIRMATION_WORD) {
    console.log('\nConfirmation not received. Aborting. No changes were made.');
    return;
  }

  console.log();
  const result = await trashMessages(gmail, ids, {
    onProgress: renderProgress,
  });
  console.log();

  console.log('Completed.\n');
  console.log(`Query: ${query}`);
  console.log(`Found: ${formatNumber(ids.length)}`);
  console.log(`Processed: ${formatNumber(result.processed)}`);
  console.log(`Moved to Trash: ${formatNumber(result.success)}`);
  console.log(`Failed: ${formatNumber(result.failed)}`);
  console.log('\nNo messages were permanently deleted.');

  if (result.failed > 0) {
    warn(
      `${formatNumber(result.failed)} message(s) failed to move to Trash, ` +
        'likely due to a transient Gmail API error. Re-run the same command ' +
        '— messages already in Trash will simply no longer match the query.'
    );
  } else {
    success('All matched messages were moved to Trash.');
  }
}
