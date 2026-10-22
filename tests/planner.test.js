// Run with: node --test tests/planner.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../planner.js');

const WEEK = '2026-10-19'; // a Monday

function allBlocks(plan) {
  return plan.days.flatMap((d) => d.blocks.map((b) => ({ ...b, day: d.index })));
}

test('mondayOf handles Sunday (getDay() = 0) and Monday', () => {
  assert.equal(P.mondayOf(new Date(2026, 9, 25)), '2026-10-19'); // Sunday -> previous Monday
  assert.equal(P.mondayOf(new Date(2026, 9, 26)), '2026-10-26'); // Monday -> itself
  assert.equal(P.mondayOf(new Date(2026, 9, 21)), '2026-10-19'); // Wednesday
  assert.equal(P.mondayIndex(new Date(2026, 9, 25)), 6);
  assert.equal(P.mondayIndex(new Date(2026, 9, 26)), 0);
});

test('week runs Monday to Sunday with correct dates', () => {
  const plan = P.makePlan({ weekStart: WEEK });
  assert.deepEqual(plan.days.map((d) => d.name),
    ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag']);
  assert.equal(plan.days[0].date, '2026-10-19');
  assert.equal(plan.days[6].date, '2026-10-25');
});

test('blocks avoid lectures, stay within 08-21, max 2h, max 6h/day', () => {
  const data = {
    weekStart: WEEK,
    lectures: [
      { name: 'Matte', day: 0, start: '08:00', end: '10:00' },
      { name: 'Søndagsseminar', day: 6, start: '12:00', end: '14:00' }
    ],
    tasks: [{ name: 'Stor oppgave', category: 'Fag', hours: 40 }]
  };
  const plan = P.makePlan(data);
  for (const day of plan.days) {
    assert.ok(day.taskMinutes <= 360, `${day.name} over 6h`);
    for (const b of day.blocks) {
      assert.ok(b.minutes <= 120);
      assert.ok(b.start >= 480 && b.end <= 1260);
      for (const l of day.lectures) assert.ok(b.end <= l.start || b.start >= l.end, 'overlaps lecture');
    }
  }
  assert.equal(plan.days[0].blocks[0].start, 600); // Monday starts after the 08-10 lecture
  assert.ok(plan.days[6].blocks.length > 0);         // Sunday is used too
  // 40h fits within 7 * 6h = 42h.
  assert.equal(plan.unplaced.length, 0);
});

test('tasks that do not fit end up in unplaced, never dropped', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    tasks: [
      { name: 'Altfor stor', category: 'Fag', hours: 50 },
      { name: 'Frist mandag', category: 'Jobbsøking', hours: 8, deadline: '2026-10-19' },
      { name: 'Gammel frist', category: 'Fag', hours: 1, deadline: '2026-10-10' }
    ],
    interviewGoal: { sessions: 2, minutes: 45 }
  });
  const byName = Object.fromEntries(plan.unplaced.map((u) => [u.name, u]));
  // Monday deadline task: only 6h fit on Monday, 2h left over.
  assert.equal(byName['Frist mandag'].minutes, 120);
  assert.equal(byName['Frist mandag'].reason, 'Ikke nok ledig tid før fristen');
  assert.equal(byName['Gammel frist'].reason, 'Fristen er før denne uka');
  // Tue-Sun = 36h, minus the two 45-min interview sessions placed before no-deadline tasks.
  assert.equal(byName['Altfor stor'].minutes, 50 * 60 - (36 * 60 - 90));
  assert.equal(byName['Intervjuøving – økt 1 av 2'], undefined);
  // Accounting: placed + unplaced == requested.
  const placed = allBlocks(plan).reduce((s, b) => s + b.minutes, 0);
  const missing = plan.unplaced.reduce((s, u) => s + u.minutes, 0);
  assert.equal(placed + missing, 50 * 60 + 8 * 60 + 60 + 90);
});

test('deadline order: earliest deadline first, then no deadline', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    tasks: [
      { name: 'Uten frist', category: 'Fag', hours: 1 },
      { name: 'Frist onsdag', category: 'Fag', hours: 1, deadline: '2026-10-21' },
      { name: 'Frist tirsdag', category: 'Fag', hours: 1, deadline: '2026-10-20' }
    ]
  });
  assert.deepEqual(plan.days[0].blocks.map((b) => b.name), ['Frist tirsdag', 'Frist onsdag', 'Uten frist']);
});

test('deadline is respected (no blocks after deadline day)', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    tasks: [{ name: 'Rapport', category: 'Fag', hours: 10, deadline: '2026-10-20' }]
  });
  const days = allBlocks(plan).map((b) => b.day);
  assert.ok(days.every((d) => d <= 1));
  assert.equal(plan.unplaced.length, 0);
});

test('interview goal stays spread even when no-deadline tasks fill the week', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    tasks: [{ name: 'Stort prosjekt', category: 'Fag', hours: 60 }],
    interviewGoal: { sessions: 3, minutes: 45 }
  });
  const days = allBlocks(plan).filter((b) => b.category === 'Intervjuøving').map((b) => b.day);
  assert.equal(days.length, 3);
  assert.equal(new Set(days).size, 3);
});

test('interview goal is spread when deadline tasks fill the remaining days', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    fromDay: 2,
    tasks: [
      { name: 'A', category: 'Fag', hours: 6, deadline: '2026-10-21' },
      { name: 'B', category: 'Fag', hours: 12, deadline: '2026-10-25' }
    ],
    interviewGoal: { sessions: 3, minutes: 45 }
  });
  const days = allBlocks(plan).filter((b) => b.category === 'Intervjuøving').map((b) => b.day);
  assert.equal(new Set(days).size, 3);
  assert.equal(plan.unplaced.length, 0);
});

test('deadline tasks may still use reserved interview time when needed', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    fromDay: 6, // only Sunday left
    tasks: [{ name: 'Må leveres', category: 'Fag', hours: 6, deadline: '2026-10-25' }],
    interviewGoal: { sessions: 1, minutes: 45 }
  });
  assert.equal(plan.days[6].taskMinutes, 360);
  assert.equal(plan.unplaced.length, 1);
  assert.equal(plan.unplaced[0].category, 'Intervjuøving');
});

test('interview sessions are spread on different days', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    tasks: [{ name: 'LeetCode', category: 'Intervjuøving', hours: 2 }],
    interviewGoal: { sessions: 3, minutes: 45 }
  });
  const iv = allBlocks(plan).filter((b) => b.category === 'Intervjuøving');
  assert.equal(iv.length, 4);
  assert.equal(new Set(iv.map((b) => b.day)).size, 4);
  assert.equal(plan.unplaced.length, 0);
});

test('same input gives identical plan', () => {
  const data = {
    weekStart: WEEK,
    lectures: [{ name: 'A', day: 2, start: '10:15', end: '12:00' }],
    tasks: [
      { name: 'X', category: 'Fag', hours: 3.5, deadline: '2026-10-22' },
      { name: 'Y', category: 'Jobbsøking', hours: 2 }
    ],
    interviewGoal: { sessions: 3, minutes: 45 }
  };
  assert.deepEqual(P.makePlan(data), P.makePlan(JSON.parse(JSON.stringify(data))));
});

test('no block shorter than 30 min when the task is longer', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    lectures: [{ name: 'L', day: 0, start: '09:15', end: '21:00' }], // Monday: only 75 min free
    tasks: [{ name: 'T', category: 'Fag', hours: 1.5 }]
  });
  const blocks = allBlocks(plan);
  assert.ok(blocks.every((b) => b.minutes >= 30));
  assert.equal(blocks.reduce((s, b) => s + b.minutes, 0), 90);
});

test('ref is passed through to lectures, blocks and unplaced items', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    lectures: [{ name: 'L', day: 0, start: '10:00', end: '12:00', ref: { id: 'l1' } }],
    tasks: [
      { name: 'A', category: 'Fag', hours: 1, ref: { id: 't1' } },
      { name: 'B', category: 'Fag', hours: 1, deadline: '2026-10-01', ref: { id: 't2' } }
    ]
  });
  assert.deepEqual(plan.days[0].lectures[0].ref, { id: 'l1' });
  assert.deepEqual(plan.days[0].blocks[0].ref, { id: 't1' });
  assert.deepEqual(plan.unplaced[0].ref, { id: 't2' });
});

test('fromDay/fromTime: plan from "now" (Wednesday 13:10)', () => {
  const plan = P.makePlan({
    weekStart: WEEK,
    fromDay: 2,
    fromTime: '13:10',
    tasks: [
      { name: 'Frist mandag', category: 'Fag', hours: 1, deadline: '2026-10-19' },
      { name: 'Frist onsdag', category: 'Fag', hours: 1, deadline: '2026-10-21' }
    ]
  });
  assert.equal(plan.days[0].blocks.length, 0);
  assert.equal(plan.days[1].blocks.length, 0);
  assert.equal(plan.days[2].blocks[0].name, 'Frist onsdag');
  assert.equal(plan.days[2].blocks[0].start, 13 * 60 + 15); // rounded up to quarter
  assert.equal(plan.unplaced[0].name, 'Frist mandag');
  assert.equal(plan.unplaced[0].reason, 'Fristen er passert');
});
