// The preview player should subscribe to the Remotion player's per-frame events
// only when a consumer is wired up to receive them. With no consumer, subscribing
// would invoke a callback on every previewed frame for nothing — and when that
// callback is a parent setState (as it once was, feeding an unused drift readout),
// it re-renders the whole editor on every frame. During a scrub on a heavy project
// that per-frame storm helps exceed React's update budget ("Maximum update depth
// exceeded"). The editor shell now omits the callback entirely.
export function shouldReportPreviewFrames(onFrameChange) {
  return typeof onFrameChange === "function";
}
