// `preview`: read-only. Scans every matching message, then fetches
// lightweight metadata for a small sample so the user can sanity-check the
// query before ever running `delete`. Never modifies Gmail.

import { authorize } from '../auth.js';
import { getGmailClient, listAllMessageIds, getMessageSample } from '../gmail.js';
import { heading, info, formatNumber, DEFAULT_QUERY } from '../utils.js';

const SAMPLE_SIZE = 10;

export async function runPreview(query = DEFAULT_QUERY) {
  heading('Gmail Cleanup');
  console.log(`Query: ${query}\n`);

  const auth = await authorize();
  const gmail = getGmailClient(auth);

  info('Scanning...');
  const ids = await listAllMessageIds(gmail, query);

  console.log(`\nTotal matching messages: ${formatNumber(ids.length)}\n`);

  if (ids.length === 0) {
    console.log('Nothing has been changed.');
    return;
  }

  info(`Fetching a sample of up to ${SAMPLE_SIZE} messages (metadata only, no full bodies)...`);
  const sample = await getMessageSample(gmail, ids, SAMPLE_SIZE);

  console.log('\nSample:\n');
  sample.forEach((msg, i) => {
    console.log(`${i + 1}. ${msg.from} — ${msg.subject}`);
  });

  console.log('\nNothing has been changed.');
}
