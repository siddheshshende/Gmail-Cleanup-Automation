
// Gmail Cleanup CLI entry point

import { runCount } from './src/commands/count.js';
import { runPreview } from './src/commands/preview.js';
import { runDelete } from './src/commands/delete.js';
import { AuthError } from './src/auth.js';
import { error, warn, DEFAULT_QUERY } from './src/utils.js';

function printHelp() {
  console.log(`
Gmail Cleanup CLI

A safe, local command-line tool for inspecting and bulk-cleaning your Gmail
inbox using the official Gmail API. Nothing destructive ever runs by default.

Usage:
  node index.js <command> ["<gmail search query>"] [--dry-run]

Commands:
  count [query]      Count all matching messages (read-only).
  preview [query]     Count + show a sample of matching messages (read-only).
  delete [query]      Move matching messages to Gmail Trash.
                       Requires typing DELETE to confirm.
  help                 Show this help message.

Options:
  --dry-run            With "delete": scan and report what would happen,
                        but make zero changes to Gmail.

Default query (used when none is given): "${DEFAULT_QUERY}"

Examples:
  node index.js count
  node index.js count "in:inbox older_than:1y"
  node index.js preview "in:inbox has:attachment"
  node index.js delete "in:inbox before:2025/01/01" --dry-run
  node index.js delete "in:inbox from:newsletter@example.com"

Notes:
  - "count" and "preview" NEVER modify your Gmail account.
  - "delete" moves messages to Trash only. It never permanently deletes mail.
  - Gmail API "messages" and Gmail UI "conversations" are not the same thing;
    see README.md for details.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  const dryRun = argv.includes('--dry-run');

  const positionalArgs = argv.slice(1).filter((arg) => !arg.startsWith('--'));
  const query = positionalArgs.length > 0 ? positionalArgs[0] : DEFAULT_QUERY;

  switch (command) {
    case 'count':
      await runCount(query);
      break;
    case 'preview':
      await runPreview(query);
      break;
    case 'delete':
      await runDelete(query, { dryRun });
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      warn(`Unknown command: "${command}"\n`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof AuthError) {
    error(err.message);
  } else if (err?.code === 401 || err?.response?.status === 401) {
    error(
      'Gmail rejected the request as unauthorized. Your token may have been ' +
        'revoked. Delete token.json and run the command again to re-authenticate.'
    );
  } else if (err?.code === 403 || err?.response?.status === 403) {
    error(
      'Gmail API returned "forbidden". Make sure the Gmail API is enabled for ' +
        'your Google Cloud project and that you approved the requested scope.'
    );
  } else if (err?.code === 429 || err?.response?.status === 429) {
    error('Gmail API rate limit reached even after retries. Please wait a bit and try again.');
  } else if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') {
    error(`Network error while contacting Gmail: ${err.code}. Check your internet connection.`);
  } else {
    error(err?.message || String(err));
  }
  process.exitCode = 1;
});
