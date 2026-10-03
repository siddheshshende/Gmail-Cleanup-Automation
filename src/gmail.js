import { google } from 'googleapis';
import { sleep } from './utils.js';

// number of pages needed for large mailboxes.
const MAX_PAGE_SIZE = 500;


export const DEFAULT_BATCH_SIZE = Number(process.env.GMAIL_BATCH_SIZE) || 50;

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;

function isRetryable(err) {
  const status = err?.code || err?.response?.status;
  return status === 429 || (status >= 500 && status < 600);
}


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

const TRASH_LABEL_PATCH = {
  addLabelIds: ['TRASH'],
  removeLabelIds: ['INBOX'],
};

/**
 * Moves messages to Trash in batches by adding the TRASH label via
 * messages.batchModify (the documented, batch-capable equivalent of
 * messages.trash for many messages at once). Never calls messages.delete.
 *
 * batchModify is all-or-nothing per request, so if a batch fails (e.g. one
 * stale ID produces a non-retryable 400) we retry that batch one message at a
 * time instead of writing off the whole chunk. Only genuinely bad IDs are
 * reported as failures, so success/fail counts stay accurate.
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

  const report = () => {
    if (onProgress) {
      onProgress({ processed, total: ids.length, success: successCount, failed: failedCount });
    }
  };

  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);

    try {
      await withRetry(() =>
        gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: { ids: chunk, ...TRASH_LABEL_PATCH },
        })
      );
      successCount += chunk.length;
      processed += chunk.length;
      report();
    } catch {
 
      for (const id of chunk) {
        try {
          await withRetry(() =>
            gmail.users.messages.modify({
              userId: 'me',
              id,
              requestBody: TRASH_LABEL_PATCH,
            })
          );
          successCount += 1;
        } catch {
          failedCount += 1;
          failedIds.push(id);
        }

        processed += 1;
        report();
      }
    }
  }

  return { processed, success: successCount, failed: failedCount, failedIds };
}
