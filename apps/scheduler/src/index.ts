/**
 * Spec Step 1: poll + cron ticker process.
 * Activates due cron/poll jobs; workers remain stateless.
 */
export function nextCronTick(now = Date.now()) {
  return now - (now % 60_000) + 60_000;
}

if (require.main === module) {
  console.log(JSON.stringify({ service: "scheduler", nextTick: new Date(nextCronTick()).toISOString() }));
}
