// Small, dependency-free helpers for CLI output, formatting, and prompts.

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const DEFAULT_QUERY = 'in:inbox';

// Only used if the terminal supports color; degrades gracefully otherwise.
const colorsEnabled = output.isTTY;

function wrap(code) {
  return (text) => (colorsEnabled ? `\x1b[${code}m${text}\x1b[0m` : text);
}

export const color = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
};

export function info(message) {
  console.log(`${color.cyan('[INFO]')} ${message}`);
}

export function success(message) {
  console.log(`${color.green('[SUCCESS]')} ${message}`);
}

export function warn(message) {
  console.log(`${color.yellow('[WARNING]')} ${message}`);
}

export function error(message) {
  console.error(`${color.red('[ERROR]')} ${message}`);
}

export function heading(title) {
  console.log(color.bold(title));
  console.log('─'.repeat(Math.max(title.length, 28)));
}

export function formatNumber(n) {
  return n.toLocaleString('en-US');
}

// Renders a fixed-width progress bar plus a "processed / total" line.
// Called repeatedly during batch operations; overwrites the previous line
// in-place when running in a real TTY, otherwise falls back to plain logs.
export function renderProgress({ processed, total, success: ok, failed }) {
  const width = 24;
  const ratio = total > 0 ? processed / total : 0;
  const filled = Math.round(width * ratio);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pct = Math.round(ratio * 100);

  const line =
    `Processing:\n[${bar}] ${pct}%\n` +
    `${formatNumber(processed)} / ${formatNumber(total)}  ` +
    `(success: ${formatNumber(ok)}, failed: ${formatNumber(failed)})`;

  if (colorsEnabled) {
    // Move cursor up 2 lines and clear them before redrawing, once we've
    // printed the block at least once.
    if (renderProgress._printed) {
      output.write('\x1b[3A\x1b[0J');
    }
    console.log(line);
    renderProgress._printed = true;
  } else {
    console.log(line);
  }
}
renderProgress._printed = false;

// Prompts the user and returns their raw input, trimmed.
export async function prompt(question) {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
