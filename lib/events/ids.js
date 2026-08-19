/**
 * Route parameters arrive as strings and reach the database as integers.
 *
 * Number('1 OR 1=1') is NaN, and handing NaN to Postgres for an integer column
 * raises a driver error that surfaces as HTTP 500 — a server fault reported
 * for what is really a malformed request. The value is parameterised so
 * nothing is injected, but the status code and the message are both wrong, and
 * a 500 hides genuine faults in the noise.
 *
 * Every id that crosses into the events module goes through here instead.
 */
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status, code: 'invalid_id' });
};

/**
 * @param {*} value      the raw parameter
 * @param {string} label what to call it if it is wrong, e.g. 'event'
 * @returns {number}     a positive integer
 */
export function toId(value, label = 'record') {
  if (value === null || value === undefined || value === '') {
    fail(`No ${label} was specified.`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    fail(`"${String(value).slice(0, 60)}" is not a valid ${label} reference.`);
  }
  return n;
}
