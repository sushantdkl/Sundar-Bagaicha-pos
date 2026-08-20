/**
 * Client-safe delivery executive labels.
 *
 * lib/delivery-executives.js owns the same vocabulary, but it also pulls in the
 * database helpers — importing it from a POS component would drag server-only
 * code into the browser bundle. The statuses live here so both sides can read
 * them; keep the two lists in step.
 */
export const EXECUTIVE_STATUS_LABEL = {
  AVAILABLE: 'Available',
  BUSY: 'Busy',
  OFF_DUTY: 'Off duty',
};
