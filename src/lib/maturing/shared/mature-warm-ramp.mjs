// Editable planning templates; these are not platform limits.
export const WARM_PRESETS = Object.freeze({
  gentle: { label: 'Default gentle maturing', initialDaily: 3, increaseBy: 2, everyDays: 3, maximumDaily: 15, stopAfterDays: 28 },
  moderate: { label: 'Default moderate warming', initialDaily: 5, increaseBy: 5, everyDays: 3, maximumDaily: 30, stopAfterDays: 60 },
  aggressive: { label: 'Default aggressive warming', initialDaily: 10, increaseBy: 10, everyDays: 3, maximumDaily: 50, stopAfterDays: 28 },
  // Per-stage maturing presets (Nov 2026). Each one carries a warm ramp AND a matching
  // cold schedule, so one click sets the warm:cold mix for that group — an all-warm
  // account looks suspicious, so every stage sends some cold too. The rates below are
  // TOTAL per day across warm + cold. A 0-connection account has no warm pool, so run
  // it cold-only (turn warm off). Every number stays editable on the board.
  prepayout:    { label: 'Pre-payout maturing — go hard (1 week)',     initialDaily: 15, increaseBy: 0, everyDays: 1, maximumDaily: 15, stopAfterDays: 7,
    cold: [{ fromDay: 1, toDay: 7, daily: 15 }] },                // 30/day, 50:50 — weed out before payout
  construction: { label: 'Construction — building to rentable',        initialDaily: 4, increaseBy: 0, everyDays: 1, maximumDaily: 4,  stopAfterDays: 28,
    cold: [{ fromDay: 1, toDay: 28, daily: 3 }] },                // ~7/day, warm-lean 60:40
  rentable:     { label: 'Rentable upkeep',                            initialDaily: 3, increaseBy: 0, everyDays: 1, maximumDaily: 3,  stopAfterDays: 60,
    cold: [{ fromDay: 1, toDay: 60, daily: 2 }] },                // ~5/day, even mix
  linkedarmy:   { label: 'LinkedArmy — outreach doubles as maturing',  initialDaily: 5, increaseBy: 0, everyDays: 1, maximumDaily: 5,  stopAfterDays: 60,
    cold: [{ fromDay: 1, toDay: 60, daily: 12 }] },               // ~17/day, cold-lean 30:70
  recovered:    { label: 'Post-recovery — re-warm gently',             initialDaily: 2, increaseBy: 1, everyDays: 3, maximumDaily: 6,  stopAfterDays: 14,
    cold: [{ fromDay: 1, toDay: 14, daily: 1 }] },                // 2→6/day warm, warm-heavy 80:20
});
export function warmPreset(key) {
  const p = WARM_PRESETS[key];
  if (!p) throw new Error('Unknown warm-connection preset');
  const {label, cold, ...settings} = p;
  return { ...settings, preset: key, stopMode: 'days', stopDate: '' };
}
// Applying a strategy edits the draft only; existing cloud campaigns are untouched.
export function applyWarmPreset(plan, key) {
  plan.warmRamp = warmPreset(key);
  const preset = WARM_PRESETS[key];
  if (key === 'moderate') {
    plan.warmUntilExhausted = false;
    plan.coldEnabled = true;
    plan.connectionStages = {
      ...plan.connectionStages,
      warm: plan.connectionStages?.warm || (plan.stages || []).map(s => ({ fromDay: s.fromDay, toDay: s.toDay, daily: s.warmDaily })),
      cold: [{ fromDay: 1, toDay: 17, daily: 5 }, { fromDay: 18, toDay: 60, daily: 10 }],
    };
  } else if (preset && Array.isArray(preset.cold)) {
    // A per-stage preset carries its own cold schedule, so applying it sets the
    // warm:cold mix in one click. Warm daily comes from the ramp (plan.warmRamp);
    // these cold stages are what mature-warm-pool reads for the cold side.
    plan.warmUntilExhausted = false;
    plan.coldEnabled = true;
    plan.connectionStages = {
      ...plan.connectionStages,
      warm: plan.connectionStages?.warm || (plan.stages || []).map(s => ({ fromDay: s.fromDay, toDay: s.toDay, daily: s.warmDaily })),
      cold: preset.cold.map(s => ({ ...s })),
    };
  }
  return plan;
}
export function warmRampErrors(ramp) {
  const errors = [];
  for (const [key,label,min] of [['initialDaily','Starting daily amount',0],['increaseBy','Increase amount',0],['everyDays','Days between increases',1],['maximumDaily','Maximum daily amount',1]]) {
    if (ramp[key] === '' || !Number.isInteger(Number(ramp[key])) || Number(ramp[key]) < min) errors.push(`${label} must be a whole number of ${min} or more.`);
  }
  if (Number(ramp.maximumDaily) < Number(ramp.initialDaily)) errors.push('The maximum must be at least the starting daily amount.');
  if (!['days','date','none'].includes(ramp.stopMode)) errors.push('Choose when warm connections stop.');
  if (ramp.stopMode === 'days' && (!Number.isInteger(Number(ramp.stopAfterDays)) || Number(ramp.stopAfterDays) < 1)) errors.push('Set at least one day of warm connections.');
  if (ramp.stopMode === 'date' && !parseDay(ramp.stopDate)) errors.push('Choose a valid stop date.');
  return errors;
}
function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === value ? d : null;
}
export function warmDailyAmount(ramp, day) {
  if (warmRampErrors(ramp).length || !Number.isInteger(day) || day < 1) return 0;
  if (ramp.stopMode === 'days' && day > Number(ramp.stopAfterDays)) return 0;
  return Math.min(Number(ramp.maximumDaily), Number(ramp.initialDaily) + Math.floor((day - 1) / Number(ramp.everyDays)) * Number(ramp.increaseBy));
}
export function warmSchedule(ramp, startDate, previewDays = 28) {
  const start = parseDay(startDate);
  if (!start || warmRampErrors(ramp).length) return { rows: [], endDate: null };
  let end = null;
  if (ramp.stopMode === 'days') { end = new Date(start); end.setUTCDate(end.getUTCDate() + Number(ramp.stopAfterDays) - 1); }
  if (ramp.stopMode === 'date') end = parseDay(ramp.stopDate);
  const rows = [];
  for (let day = 1; day <= previewDays; day++) {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + day - 1);
    if (end && date > end) break;
    rows.push({day,date:date.toISOString().slice(0,10),amount:warmDailyAmount(ramp,day)});
  }
  return { rows, endDate: end?.toISOString().slice(0,10) || null };
}
