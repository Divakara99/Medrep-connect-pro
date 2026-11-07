/** Shared by the gesture and its indicator: drag this far and it refreshes. */
export const THRESHOLD = 64

/**
 * Ambiguity zone at the start of a downward drag.
 *
 * Below this the gesture is treated as a normal scroll — that is what stops a
 * small nudge from being read as "pull to refresh" and freezing the page.
 */
export const DEADZONE = 18
