'use strict';

let queue = Promise.resolve();

/**
 * Serialises read-modify-write sequences on the in-memory collections so two
 * requests can't interleave and overwrite each other's changes. Errors are
 * logged and swallowed so one failed job never blocks the queue.
 */
function enqueueWrite(fn) {
  queue = queue.then(fn).catch((err) => {
    console.error('[write-queue]', err);
  });
  return queue;
}

module.exports = { enqueueWrite };
