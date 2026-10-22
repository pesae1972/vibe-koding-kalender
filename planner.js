/*
 * Pure, deterministic week planner.
 * Works both in the browser (window.Planner) and in Node (require('./planner.js')).
 *
 * Day indexes are Monday-based: 0 = Monday ... 6 = Sunday.
 * Times are minutes since midnight (e.g. 8:00 = 480).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Planner = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_START = 8 * 60;        // 08:00
  var DAY_END = 21 * 60;         // 21:00
  var MAX_TASK_PER_DAY = 6 * 60; // max task minutes per day
  var MAX_BLOCK = 2 * 60;        // max length of one block
  var MIN_BLOCK = 30;            // avoid tiny fragments (unless less remains)
  var BREAK_AFTER_BLOCK = 15;    // free buffer after each task block

  var DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  var INTERVIEW = 'Intervjuøving';

  // ---------- date / time helpers ----------

  function parseTime(str) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function formatTime(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // Parse "YYYY-MM-DD" as a UTC day number (avoids DST/timezone drift).
  function dayNumber(isoDate) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
    if (!m) return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
  }

  function isoFromDayNumber(n) {
    return new Date(n * 86400000).toISOString().slice(0, 10);
  }

  // Monday-based weekday for a JS Date: getDay() gives Sunday = 0, so shift it.
  function mondayIndex(date) {
    return (date.getDay() + 6) % 7;
  }

  // Returns "YYYY-MM-DD" of the Monday in the week containing `date` (local time).
  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - mondayIndex(d));
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
  }

  // ---------- free-time bookkeeping ----------

  // Remove [start, end) from a sorted list of free intervals.
  function subtract(free, start, end) {
    var out = [];
    for (var i = 0; i < free.length; i++) {
      var s = free[i][0];
      var e = free[i][1];
      if (end <= s || start >= e) {
        out.push([s, e]);
        continue;
      }
      if (start > s) out.push([s, start]);
      if (end < e) out.push([end, e]);
    }
    return out;
  }

  // Earliest free interval in `day` that can hold at least minLen minutes.
  function findStart(day, minLen) {
    for (var i = 0; i < day.free.length; i++) {
      var len = day.free[i][1] - day.free[i][0];
      if (len >= minLen) return { start: day.free[i][0], length: len };
    }
    return null;
  }

  // Try to place up to `wanted` minutes (at least `minLen`) on `day`.
  function tryPlace(day, wanted, minLen, respectReserve) {
    var capLeft = MAX_TASK_PER_DAY - day.taskMinutes - (respectReserve ? day.reserved : 0);
    var maxLen = Math.min(wanted, MAX_BLOCK, capLeft);
    if (maxLen < minLen || maxLen <= 0) return null;
    var slot = findStart(day, minLen);
    if (!slot) return null;
    var length = Math.min(maxLen, slot.length);
    // Don't leave a leftover smaller than MIN_BLOCK; shorten this block instead.
    var leftover = wanted - length;
    if (leftover > 0 && leftover < MIN_BLOCK && length - (MIN_BLOCK - leftover) >= minLen) {
      length -= MIN_BLOCK - leftover;
    }
    return { start: slot.start, end: slot.start + length, minutes: length };
  }

  function commit(day, placement, name, category, ref) {
    day.blocks.push({
      name: name,
      category: category,
      start: placement.start,
      end: placement.end,
      minutes: placement.minutes,
      ref: ref === undefined ? null : ref
    });
    day.taskMinutes += placement.minutes;
    day.free = subtract(day.free, placement.start, placement.end + BREAK_AFTER_BLOCK);
    if (category === INTERVIEW) day.interviewCount += 1;
  }

  // ---------- main entry point ----------

  /**
   * @param {Object} data
   *   weekStart:     "YYYY-MM-DD" (a Monday)
   *   lectures:      [{ name, day (0=Mon..6=Sun), start "HH:MM", end "HH:MM", ref? }]
   *   tasks:         [{ name, category, hours, deadline? "YYYY-MM-DD", ref? }]
   *   (`ref` is opaque caller data, copied unchanged onto the matching output items.)
   *   interviewGoal: { sessions, minutes }
   *   fromDay?:      first day index that may get tasks (default 0); earlier days stay free of tasks
   *   fromTime?:     "HH:MM" on fromDay before which no tasks are placed (rounded up to 15 min)
   * @returns {{ weekStart, days: Array, unplaced: Array }}
   */
  function makePlan(data) {
    data = data || {};
    var weekStartNum = dayNumber(data.weekStart);
    var lectures = Array.isArray(data.lectures) ? data.lectures : [];
    var tasks = Array.isArray(data.tasks) ? data.tasks : [];
    var goal = data.interviewGoal || {};
    var unplaced = [];

    // 1. Build days with free time = 08:00-21:00 minus lectures.
    var days = [];
    for (var d = 0; d < 7; d++) {
      days.push({
        index: d,
        name: DAY_NAMES[d],
        date: isNaN(weekStartNum) ? null : isoFromDayNumber(weekStartNum + d),
        lectures: [],
        blocks: [],
        free: [[DAY_START, DAY_END]],
        taskMinutes: 0,
        interviewCount: 0,
        reserved: 0 // capacity softly held for interview goal sessions
      });
    }
    lectures.forEach(function (lec) {
      var dayIdx = Number(lec.day);
      var s = parseTime(lec.start);
      var e = parseTime(lec.end);
      if (!(dayIdx >= 0 && dayIdx <= 6) || isNaN(s) || isNaN(e) || e <= s) return;
      var day = days[dayIdx];
      day.lectures.push({ name: lec.name, start: s, end: e, ref: lec.ref === undefined ? null : lec.ref });
      day.free = subtract(day.free, s, e);
    });

    // Optional "plan from now": no tasks before fromDay / fromTime.
    var fromDay = Math.max(0, Math.min(7, Math.floor(Number(data.fromDay) || 0)));
    var fromTime = parseTime(data.fromTime);
    days.forEach(function (day) {
      if (day.index < fromDay) day.free = [];
    });
    if (fromDay < 7 && !isNaN(fromTime)) {
      days[fromDay].free = subtract(days[fromDay].free, 0, Math.ceil(fromTime / 15) * 15);
    }

    // Interview goal: pick evenly spread target days among the days still available
    // (e.g. 3 sessions on a full week -> Mon, Wed, Fri) and softly reserve capacity there.
    var sessions = Math.max(0, Math.floor(Number(goal.sessions) || 0));
    var minutes = Math.round(Number(goal.minutes) || 0);
    var openDays = days.filter(function (day) { return day.free.length > 0; });
    var targets = [];
    for (var g = 0; g < sessions; g++) {
      var span = Math.min(sessions, openDays.length);
      var pick = openDays.length ? openDays[Math.floor((g % span) * openDays.length / span)] : days[0];
      targets.push(pick.index);
      if (minutes > 0 && minutes <= MAX_BLOCK && g < openDays.length) pick.reserved += minutes;
    }

    // 2. Order tasks: earliest deadline first, then tasks without deadline (input order kept).
    var withDeadline = [];
    var withoutDeadline = [];
    tasks.forEach(function (t, i) {
      var item = { task: t, order: i, deadlineNum: dayNumber(t.deadline) };
      if (isNaN(item.deadlineNum)) withoutDeadline.push(item);
      else withDeadline.push(item);
    });
    withDeadline.sort(function (a, b) {
      return a.deadlineNum - b.deadlineNum || a.order - b.order;
    });

    // 3. Place regular tasks (deadline tasks now, tasks without deadline after the interview goal).
    function placeItem(item) {
      var t = item.task;
      var total = Math.round(Number(t.hours) * 60);
      var hasDeadline = !isNaN(item.deadlineNum);
      if (!(total > 0)) {
        unplaced.push(miss(t.name, t.category, 0, 'Ugyldig estimert tid', t.ref));
        return;
      }

      var lastDay = 6;
      if (hasDeadline && !isNaN(weekStartNum)) {
        lastDay = Math.min(6, item.deadlineNum - weekStartNum);
        if (lastDay < 0) {
          unplaced.push(miss(t.name, t.category, total, 'Fristen er før denne uka', t.ref));
          return;
        }
        if (lastDay < fromDay) {
          unplaced.push(miss(t.name, t.category, total, 'Fristen er passert', t.ref));
          return;
        }
      }

      var remaining = total;
      while (remaining > 0) {
        var minLen = Math.min(remaining, MIN_BLOCK);
        var candidates = days.slice(0, lastDay + 1);
        if (t.category === INTERVIEW) {
          // Spread interview practice: prefer days with fewest interview blocks.
          candidates.sort(function (a, b) {
            return a.interviewCount - b.interviewCount || a.index - b.index;
          });
        }
        // Respect the interview reservations first; use them only if nothing else fits.
        var placed = false;
        for (var pass = 0; pass < 2 && !placed; pass++) {
          for (var c = 0; c < candidates.length; c++) {
            var p = tryPlace(candidates[c], remaining, minLen, pass === 0);
            if (p) {
              commit(candidates[c], p, t.name, t.category, t.ref);
              remaining -= p.minutes;
              placed = true;
              break;
            }
          }
        }
        if (!placed) break;
      }
      if (remaining > 0) {
        unplaced.push(miss(t.name, t.category, remaining,
          hasDeadline ? 'Ikke nok ledig tid før fristen' : 'Ikke nok ledig tid denne uka', t.ref));
      }
    }

    withDeadline.forEach(placeItem);

    // 4. Weekly interview goal: N sessions with no deadline, spread over different days.
    //    Placed before other no-deadline tasks so they can't crowd it into a single day.
    days.forEach(function (day) { day.reserved = 0; });
    for (var i = 0; i < sessions; i++) {
      var label = 'Intervjuøving – økt ' + (i + 1) + ' av ' + sessions;
      if (!(minutes > 0) || minutes > MAX_BLOCK) {
        unplaced.push(miss(label, INTERVIEW, Math.max(minutes, 0),
          minutes > MAX_BLOCK ? 'En økt kan være maks 2 timer' : 'Ugyldig øktlengde'));
        continue;
      }
      var target = targets[i];
      var ordered = days.slice().sort(function (a, b) {
        return a.interviewCount - b.interviewCount ||
          Math.abs(a.index - target) - Math.abs(b.index - target) ||
          a.index - b.index;
      });
      var done = false;
      for (var k = 0; k < ordered.length; k++) {
        var pl = tryPlace(ordered[k], minutes, minutes, false); // sessions are never split
        if (pl) {
          commit(ordered[k], pl, label, INTERVIEW, null);
          done = true;
          break;
        }
      }
      if (!done) unplaced.push(miss(label, INTERVIEW, minutes, 'Ikke nok ledig tid denne uka'));
    }

    withoutDeadline.forEach(placeItem);

    // 5. Clean output.
    return {
      weekStart: data.weekStart || null,
      days: days.map(function (day) {
        return {
          index: day.index,
          name: day.name,
          date: day.date,
          lectures: day.lectures.slice().sort(byStart),
          blocks: day.blocks.slice().sort(byStart),
          taskMinutes: day.taskMinutes
        };
      }),
      unplaced: unplaced
    };
  }

  function miss(name, category, minutes, reason, ref) {
    return { name: name, category: category, minutes: minutes, reason: reason, ref: ref === undefined ? null : ref };
  }

  function byStart(a, b) {
    return a.start - b.start;
  }

  return {
    makePlan: makePlan,
    mondayOf: mondayOf,
    mondayIndex: mondayIndex,
    parseTime: parseTime,
    formatTime: formatTime,
    DAY_NAMES: DAY_NAMES,
    CATEGORIES: ['Fag', 'Jobbsøking', INTERVIEW]
  };
});
