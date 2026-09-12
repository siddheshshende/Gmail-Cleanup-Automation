// `count`: read-only. Scans every matching message across all pages and
// reports a total. Never modifies Gmail.

import { authorize } from '../auth.js';
import { getGmailClient, listAllMessageIds } from '../gmail.js';
import { heading, info, formatNumber, DEFAULT_QUERY } from '../utils.js';

export async function runCount(query = DEFAULT_QUERY) {
  heading('Gmail Cleanup');
  console.log(`Query: ${query}\n`);

  const auth = await authorize();
  const gmail = getGmailClient(auth);

  info('Scanning Gmail...');
  const ids = await listAllMessageIds(gmail, query);

  console.log(`Found ${formatNumber(ids.length)} matching messages.\n`);
  console.log(
    'Note: this is a count of Gmail API "messages", which can be higher than\n' +
      'the number of conversations shown in the Gmail web UI, since a single\n' +
      'conversation thread can contain several messages.\n'
  );
  console.log('No emails have been modified.');
}
