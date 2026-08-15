/**
 * v8.45: Haptic feedback hook for mobile touch interactions.
 *
 * Wraps the Vibration API (navigator.vibrate) with safe guards for SSR and
 * unsupported browsers. On desktop the calls are no-ops.
 *
 * Patterns:
 * - light:   10ms  — minimal tap acknowledgment (nav taps, chip selects)
 * - medium:  20ms  — slightly stronger (primary button taps, FAB press)
 * - success: 10-30-10ms — ascending pattern (trade saved, alert marked read)
 * - error:   20-50-20-50-20ms — repeated pattern (validation error, save failed)
 * - selection: 5ms — very light (item picked from list)
 * - warning: 30ms — single medium buzz (cautionary action)
 *
 * Usage:
 *   const haptic = useHaptic();
 *   <button onClick={() => { haptic.light(); doSomething(); }}>...</button>
 */
export function useHaptic() {
  const vibrate = (pattern: number | number[]) => {
    if (typeof navigator === 'undefined') return;
    if (typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibration API can throw on some browsers (e.g. permissions). Swallow.
    }
  };

  return {
    /** Minimal 10ms tap acknowledgment. Use for routine taps (nav, chips). */
    light: () => vibrate(10),
    /** Medium 20ms buzz. Use for primary actions (FAB, save buttons). */
    medium: () => vibrate(20),
    /** Ascending success pattern (10-30-10). Use after successful save/action. */
    success: () => vibrate([10, 30, 10]),
    /** Repeated error pattern (20-50-20-50-20). Use for failures/validation. */
    error: () => vibrate([20, 50, 20, 50, 20]),
    /** Very light 5ms tick. Use for item selection from a list. */
    selection: () => vibrate(5),
    /** Single 30ms warning buzz. Use for cautionary/destructive taps. */
    warning: () => vibrate(30),
    /** Raw vibrate — accepts a number (ms) or pattern array. */
    vibrate,
  };
}
