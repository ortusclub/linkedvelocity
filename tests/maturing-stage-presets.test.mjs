import test from 'node:test';
import assert from 'node:assert/strict';
import { WARM_PRESETS, warmPreset, applyWarmPreset } from '../src/lib/maturing/shared/mature-warm-ramp.mjs';
import { matureWarmDailyAmount, matureColdDailyAmount } from '../src/lib/maturing/shared/mature-warm-pool.mjs';

// Agreed per-stage maturing settings (Sam, Nov 2026). Totals are warm + cold per day.
// Each case: the effective warm and cold amounts on a few representative days.
const CASES = {
  prepayout:    { warm: { 1: 5, 7: 5, 8: 0 },  cold: { 1: 5, 7: 5, 8: 0 } },   // 10/day, 50:50, 1wk
  construction: { warm: { 1: 4, 28: 4, 29: 0 }, cold: { 1: 3, 28: 3, 29: 0 } }, // ~7/day, 60:40 warm-lean
  rentable:     { warm: { 1: 3, 60: 3 },        cold: { 1: 2, 60: 2 } },        // ~5/day, even
  linkedarmy:   { warm: { 1: 5, 60: 5 },        cold: { 1: 12, 60: 12 } },      // ~17/day, 30:70 cold-lean
  recovered:    { warm: { 1: 2, 4: 3, 7: 4, 10: 5, 13: 6, 15: 0 }, cold: { 1: 1, 14: 1, 15: 0 } }, // ramp back, 80:20
};

function freshPlan() {
  return { warmEnabled: true, coldEnabled: false, warmUntilExhausted: false, stages: [] };
}

for (const [key, expect] of Object.entries(CASES)) {
  test(`preset ${key}: warm and cold daily match the agreed mix`, () => {
    const plan = applyWarmPreset(freshPlan(), key);
    assert.equal(plan.coldEnabled, true, 'every stage preset sends some cold (all-warm looks suspicious)');
    assert.equal(plan.warmUntilExhausted, false);
    for (const [day, amount] of Object.entries(expect.warm)) {
      assert.equal(matureWarmDailyAmount(plan, Number(day)), amount, `${key} warm day ${day}`);
    }
    for (const [day, amount] of Object.entries(expect.cold)) {
      assert.equal(matureColdDailyAmount(plan, Number(day)), amount, `${key} cold day ${day}`);
    }
  });
}

test('warmPreset does not leak the cold schedule into the warm ramp', () => {
  const ramp = warmPreset('prepayout');
  assert.ok(!('cold' in ramp), 'cold stays out of plan.warmRamp');
  assert.equal(ramp.preset, 'prepayout');
  assert.equal(ramp.initialDaily, 5);
  assert.equal(ramp.stopMode, 'days');
});

test('the three default presets still send no cold on their own', () => {
  for (const key of ['gentle', 'aggressive']) {
    const plan = applyWarmPreset(freshPlan(), key);
    assert.notEqual(plan.coldEnabled, true, `${key} leaves cold as the user set it`);
  }
  // moderate deliberately enables cold (unchanged behaviour).
  assert.equal(applyWarmPreset(freshPlan(), 'moderate').coldEnabled, true);
});

test('every stage preset is a valid, applyable key', () => {
  for (const key of Object.keys(WARM_PRESETS)) {
    assert.doesNotThrow(() => applyWarmPreset(freshPlan(), key), `apply ${key}`);
  }
});
