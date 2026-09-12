// Reusable Gmail API operations: listing message IDs across pages, sampling
// metadata for preview, and trashing messages in controlled batches.

import { google } from 'googleapis';
import { sleep } from './utils.js';

// Gmail's own maximum for messages.list per request. Requesting more than
// this is ignored/clamped by the API, so we ask for the max to minimize the
// number of pages needed for large mailboxes.
const MAX_PAGE_SIZE = 500;

// Gmail API batchModify accepts up to 1000 IDs per call, but we default to a
// smaller, safer batch size to stay comfortably under per-user rate limits
// and to keep failures cheap to retry.
export const DEFAULT_BATCH_SIZE = Number(process.env.GMAIL_BATCH_SIZE) || 50;

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;

function isRetryable(err) {
  const status = err?.code || err?.response?.status;
  // 429 = rate limited, 5xx = transient server error, both worth retrying.
  return status === 429 || (status >= 500 && status < 600);
}

// Wraps a Gmail API call with limited exponential backoff. Intentionally
// bounded (MAX_RETRIES) rather than infinite, so a persistent failure
// surfaces instead of hanging the CLI forever.
async function withRetry(fn) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > MAX_RETRIES || !isRetryable(err)) {
        throw err;
      }
      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
}

export function getGmailClient(auth) {
  return google.gmail({ version: 'v1', auth });
}

/**
 * Retrieves every message ID matching `query`, following nextPageToken
 * until Gmail reports no more pages. Only IDs are fetched here (not full
 * message bodies), since that's all counting/trashing needs.
 *
 * @param {object} gmail - client from getGmailClient()
 * @param {string} query - Gmail search syntax, e.g. "in:inbox older_than:1y"
 * @param {(count: number) => void} [onPage] - called after each page with the running total
 */
export async function listAllMessageIds(gmail, query, onPage) {
  const ids = [];
  let pageToken;

  do {
    const res = await withRetry(() =>
      gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: MAX_PAGE_SIZE,
        pageToken,
      })
    );

    const messages = res.data.messages || [];
    for (const m of messages) ids.push(m.id);
    pageToken = res.data.nextPageToken || undefined;

    if (onPage) onPage(ids.length);
  } while (pageToken);

  return ids;
}

/**
 * Fetches lightweight metadata (From/Subject only) for a small sample of
 * message IDs, for preview purposes. Never fetches full message bodies.
 */
export async function getMessageSample(gmail, ids, sampleSize = 10) {
  const sampleIds = ids.slice(0, sampleSize);
  const results = [];

  for (const id of sampleIds) {
    try {
      const res = await withRetry(() =>
        gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        })
      );
      const headers = res.data.payload?.headers || [];
      const from = headers.find((h) => h.name === 'From')?.value || '(unknown sender)';
      const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)';
      results.push({ id, from, subject });
    } catch {
      results.push({ id, from: '(unavailable)', subject: '(unavailable)' });
    }
  }

  return results;
}

/**
 * Moves messages to Trash in batches by adding the TRASH label via
 * messages.batchModify (the documented, batch-capable equivalent of
 * messages.trash for many messages at once). Never calls messages.delete.
 *
 * Continues past a failed batch rather than aborting the whole run; failed
 * IDs are reported back so the caller can show accurate success/fail counts.
 *
 * @param {object} gmail
 * @param {string[]} ids
 * @param {object} [opts]
 * @param {number} [opts.batchSize]
 * @param {(progress: {processed:number, total:number, success:number, failed:number}) => void} [opts.onProgress]
 */
export async function trashMessages(gmail, ids, opts = {}) {
  const { batchSize = DEFAULT_BATCH_SIZE, onProgress } = opts;

  let processed = 0;
  let successCount = 0;
  let failedCount = 0;
  const failedIds = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);

    try {
      await withRetry(() =>
        gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: chunk,
            addLabelIds: ['TRASH'],
            removeLabelIds: ['INBOX', 'UNREAD'],
          },
        })
      );
      successCount += chunk.length;
    } catch {
      failedCount += chunk.length;
      failedIds.push(...chunk);
    }

    processed += chunk.length;
    if (onProgress) {
      onProgress({ processed, total: ids.length, success: successCount, failed: failedCount });
    }
  }

  return { processed, success: successCount, failed: failedCount, failedIds };
}
