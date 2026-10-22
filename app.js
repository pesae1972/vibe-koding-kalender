/* UI layer: data, storage and rendering. Planning logic lives in planner.js. */
(function () {
  'use strict';

  var STORAGE_KEY = 'ukeplanlegger-v2';
  var P = window.Planner;
  var DAY_START = 8 * 60;
  var DAY_END = 21 * 60;
  var PPM = 0.9; // calendar pixels per minute, must match --ppm in style.css
  var MONTHS = ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'];
  var COLORS = [
    { name: 'Blå', value: '#2563eb' },
    { name: 'Lilla', value: '#9333ea' },
    { name: 'Turkis', value: '#0891b2' },
    { name: 'Indigo', value: '#4f46e5' },
    { name: 'Rosa', value: '#db2777' },
    { name: 'Rød', value: '#dc2626' },
    { name: 'Gul', value: '#ca8a04' },
    { name: 'Grå', value: '#64748b' }
  ];
  var CATEGORY_COLOR = { 'Fag': '#4f46e5', 'Jobbsøking': '#059669', 'Intervjuøving': '#ea580c' };

  var state = load();
  var firstVisit = !state;
  if (!state) state = emptyState();
  var weekStart = P.mondayOf(new Date());

  // ---------- storage ----------

  function emptyState() {
    return { courses: [], lectures: [], tasks: [], exams: [], interviewGoal: { sessions: 3, minutes: 45 } };
  }

  // Returns null when nothing has been stored yet (first visit).
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var s = emptyState();
      ['courses', 'lectures', 'tasks', 'exams'].forEach(function (k) {
        if (Array.isArray(parsed[k])) s[k] = parsed[k];
      });
      if (parsed.interviewGoal) s.interviewGoal = parsed.interviewGoal;
      return s;
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Storage unavailable (private mode etc.) - the app still works for this session.
    }
  }

  // ---------- small helpers ----------

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoFromDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dayNum(iso) {
    var p = iso.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000;
  }

  function diffDays(a, b) { return dayNum(a) - dayNum(b); }

  function addDays(iso, n) {
    return new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
  }

  function formatHours(minutes) {
    var h = Math.round(minutes / 60 * 100) / 100;
    return String(h).replace('.', ',') + ' t';
  }

  function shortDate(iso) {
    var p = iso.split('-').map(Number);
    return p[2] + '. ' + MONTHS[p[1] - 1];
  }

  function isoWeek(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7); // Thursday of this week
    var jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round((d - jan4) / 86400000 / 7 - 3 / 7 + ((jan4.getUTCDay() + 6) % 7) / 7);
  }

  function weekRange(ws) {
    var we = addDays(ws, 6);
    var a = ws.split('-').map(Number);
    var b = we.split('-').map(Number);
    if (a[1] === b[1]) return a[2] + '.–' + b[2] + '. ' + MONTHS[b[1] - 1] + ' ' + b[0];
    return a[2] + '. ' + MONTHS[a[1] - 1] + ' – ' + b[2] + '. ' + MONTHS[b[1] - 1] + ' ' + b[0];
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function course(id) {
    for (var i = 0; i < state.courses.length; i++) if (state.courses[i].id === id) return state.courses[i];
    return null;
  }

  function colorOf(courseId, category) {
    var c = course(courseId);
    return c ? c.color : (CATEGORY_COLOR[category] || CATEGORY_COLOR.Fag);
  }

  function codeChip(courseId, fallback) {
    var c = course(courseId);
    var chip = el('span', 'code', c ? c.code : fallback);
    chip.style.setProperty('--c', c ? c.color : (CATEGORY_COLOR[fallback] || CATEGORY_COLOR.Fag));
    return chip;
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function svgIcon(d) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    var attrs = {
      viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    };
    Object.keys(attrs).forEach(function (k) { svg.setAttribute(k, attrs[k]); });
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  // ---------- plan input / output ----------

  function hasData() {
    return state.courses.length || state.lectures.length || state.tasks.length || state.exams.length;
  }

  // Turns stored entities into the planner's input for one week.
  function buildInput(ws) {
    var lectures = state.lectures.map(function (l) {
      var c = course(l.courseId);
      return {
        name: (c ? c.code : 'Fag') + ' · ' + l.kind,
        day: l.day, start: l.start, end: l.end,
        ref: { type: 'lecture', courseId: l.courseId, kind: l.kind }
      };
    });
    state.exams.forEach(function (x) {
      var d = diffDays(x.date, ws);
      if (d < 0 || d > 6) return;
      var c = course(x.courseId);
      lectures.push({
        name: (c ? c.code : 'Fag') + ' · Eksamen',
        day: d, start: x.start, end: x.end,
        ref: { type: 'exam', courseId: x.courseId }
      });
    });
    var tasks = state.tasks.filter(function (t) { return !t.done; }).map(function (t) {
      return {
        name: t.name, category: t.category, hours: t.hours, deadline: t.deadline,
        ref: { type: 'task', id: t.id, courseId: t.courseId || null }
      };
    });
    var input = { weekStart: ws, lectures: lectures, tasks: tasks, interviewGoal: state.interviewGoal };
    // In the current week, plan only from now on (time that has passed can't be used).
    var now = new Date();
    if (ws === P.mondayOf(now)) {
      input.fromDay = P.mondayIndex(now);
      input.fromTime = P.formatTime(nowMinutes());
    }
    return input;
  }

  // Flattens a planned day into display items sorted by start time.
  function dayItems(day) {
    var items = day.lectures.map(function (l) {
      var exam = l.ref && l.ref.type === 'exam';
      return {
        kind: exam ? 'exam' : 'fixed', name: l.name, start: l.start, end: l.end,
        color: colorOf(l.ref && l.ref.courseId, 'Fag'), label: exam ? 'Eksamen' : (l.ref ? l.ref.kind : 'Timeplan')
      };
    }).concat(day.blocks.map(function (b) {
      var c = b.ref && course(b.ref.courseId);
      return {
        kind: 'task', name: b.name, start: b.start, end: b.end,
        color: colorOf(b.ref && b.ref.courseId, b.category),
        label: c ? c.code : b.category
      };
    }));
    return items.sort(function (a, b) { return a.start - b.start; });
  }

  // Per task: minutes placed, last day used and what is missing.
  function taskProgress(plan) {
    var map = {};
    function get(id) { return map[id] || (map[id] = { placed: 0, lastDay: -1, missing: 0, reason: '' }); }
    plan.days.forEach(function (d) {
      d.blocks.forEach(function (b) {
        if (!b.ref || b.ref.type !== 'task') return;
        var e = get(b.ref.id);
        e.placed += b.minutes;
        e.lastDay = Math.max(e.lastDay, d.index);
      });
    });
    plan.unplaced.forEach(function (u) {
      if (!u.ref || u.ref.type !== 'task') return;
      var e = get(u.ref.id);
      e.missing += u.minutes;
      e.reason = u.reason;
    });
    return map;
  }

  // Deadline radar: will each deadline be met with this week's plan?
  function computeRadar(plan, progress) {
    var today = isoFromDate(new Date());
    var items = [];
    state.tasks.forEach(function (t) {
      if (t.done || !t.deadline) return;
      var pr = progress[t.id] || { placed: 0, lastDay: -1, missing: 0 };
      var idx = diffDays(t.deadline, weekStart);
      var status;
      var text;
      if (diffDays(t.deadline, today) < 0) {
        status = 'bad';
        text = 'Fristen er passert';
      } else if (pr.missing > 0) {
        status = 'bad';
        text = 'Mangler ' + formatHours(pr.missing) + ' før fristen';
      } else if (idx <= 6 && pr.lastDay === idx) {
        status = 'warn';
        text = 'Stramt: ferdig på fristdagen';
      } else {
        status = 'ok';
        text = pr.lastDay >= 0 ? 'I rute: ferdig ' + P.DAY_NAMES[pr.lastDay].toLowerCase() : 'I rute';
      }
      items.push({ type: 'task', name: t.name, courseId: t.courseId, category: t.category,
        date: t.deadline, daysLeft: diffDays(t.deadline, today), status: status, text: text });
    });
    state.exams.forEach(function (x) {
      var daysLeft = diffDays(x.date, today);
      if (daysLeft < 0) return;
      var mins = 0;
      plan.days.forEach(function (d) {
        d.blocks.forEach(function (b) { if (b.ref && b.ref.courseId === x.courseId) mins += b.minutes; });
      });
      var c = course(x.courseId);
      items.push({ type: 'exam', name: 'Eksamen ' + (c ? c.name : ''), courseId: x.courseId, category: 'Fag',
        date: x.date, daysLeft: daysLeft, status: 'exam',
        text: mins ? formatHours(mins) + ' arbeid med faget denne uka' : 'Ingen arbeid med faget planlagt denne uka' });
    });
    return items.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
  }

  // ---------- rendering ----------

  function render() {
    $('weekNumber').textContent = 'Uke ' + isoWeek(weekStart);
    $('weekRange').textContent = weekRange(weekStart);
    renderEditLists();

    if (!hasData()) {
      $('emptyState').hidden = false;
      $('result').hidden = true;
      return;
    }
    $('emptyState').hidden = true;
    $('result').hidden = false;

    var plan = P.makePlan(buildInput(weekStart));
    var progress = taskProgress(plan);
    var radar = computeRadar(plan, progress);

    renderNow(plan);
    renderStats(plan, radar);
    renderUnplaced(plan);
    renderLegend();
    renderCalendar(plan);
    renderAgenda(plan);
    renderRadar(radar);
    renderChecklist(progress);
  }

  function renderNow(viewPlan) {
    var box = $('nowCard');
    box.textContent = '';
    var now = new Date();
    var cw = P.mondayOf(now);
    var plan = cw === weekStart ? viewPlan : P.makePlan(buildInput(cw));
    var todayIdx = P.mondayIndex(now);
    var mins = nowMinutes();

    var current = null;
    var next = null;
    var nextDay = todayIdx;
    var todays = dayItems(plan.days[todayIdx]);
    todays.forEach(function (it) {
      if (it.start <= mins && mins < it.end) current = it;
      else if (it.start > mins && !next) next = it;
    });
    if (!next) {
      for (var d = todayIdx + 1; d < 7 && !next; d++) {
        var items = dayItems(plan.days[d]);
        if (items.length) { next = items[0]; nextDay = d; }
      }
    }

    function when(it, dayIdx) {
      if (dayIdx === todayIdx) {
        var diff = it.start - mins;
        return diff < 60 ? 'om ' + diff + ' min' : 'i dag ' + P.formatTime(it.start);
      }
      return (dayIdx === todayIdx + 1 ? 'i morgen' : P.DAY_NAMES[dayIdx].toLowerCase()) + ' ' + P.formatTime(it.start);
    }

    var main = current || next;
    if (!main) {
      box.appendChild(el('div', 'now-label', 'Neste økt'));
      box.appendChild(el('div', 'now-title', 'Ingenting mer planlagt denne uka'));
      box.appendChild(el('div', 'now-meta', 'Bruk pilene øverst for å se neste uke.'));
      box.style.removeProperty('--c');
      return;
    }
    box.style.setProperty('--c', main.color);

    var label = el('div', 'now-label');
    if (current) label.appendChild(el('span', 'pulse'));
    label.appendChild(document.createTextNode(current ? 'Nå · ' + main.label : 'Neste økt · ' + main.label));
    box.appendChild(label);
    box.appendChild(el('div', 'now-title', main.name));

    if (current) {
      box.appendChild(el('div', 'now-meta', P.formatTime(current.start) + '–' + P.formatTime(current.end) +
        ' · ' + (current.end - mins) + ' min igjen'));
      var bar = el('div', 'now-progress');
      var fill = el('span');
      fill.style.width = ((mins - current.start) / (current.end - current.start) * 100) + '%';
      bar.appendChild(fill);
      box.appendChild(bar);
      if (next) {
        var after = el('div', 'now-next', 'Deretter ' + when(next, nextDay) + ': ');
        after.appendChild(el('strong', null, next.name));
        box.appendChild(after);
      }
    } else {
      box.appendChild(el('div', 'now-meta', P.formatTime(next.start) + '–' + P.formatTime(next.end) +
        ' · ' + when(next, nextDay)));
    }
    if (cw !== weekStart) {
      box.appendChild(el('div', 'now-next', 'Gjelder denne uka (uke ' + isoWeek(cw) + ').'));
    }
  }

  function stat(label, value, sub, extraClass) {
    var box = el('div', 'stat' + (extraClass ? ' ' + extraClass : ''));
    box.appendChild(el('div', 'label', label));
    box.appendChild(el('div', 'value', value));
    if (sub) box.appendChild(typeof sub === 'string' ? el('div', 'sub', sub) : sub);
    return box;
  }

  function renderStats(plan, radar) {
    var byColor = {};
    var total = 0;
    var byCat = { 'Fag': 0, 'Jobbsøking': 0, 'Intervjuøving': 0 };
    plan.days.forEach(function (d) {
      d.blocks.forEach(function (b) {
        var color = colorOf(b.ref && b.ref.courseId, b.category);
        byColor[color] = (byColor[color] || 0) + b.minutes;
        byCat[b.category] = (byCat[b.category] || 0) + b.minutes;
        total += b.minutes;
      });
    });

    var stats = $('stats');
    stats.textContent = '';

    var planned = stat('Planlagt denne uka', formatHours(total),
      'Fag ' + formatHours(byCat.Fag) + ' · Jobb ' + formatHours(byCat['Jobbsøking']) +
      ' · Intervju ' + formatHours(byCat['Intervjuøving']));
    var bar = el('div', 'catbar');
    Object.keys(byColor).forEach(function (c) {
      var seg = el('span');
      seg.style.width = (byColor[c] / total * 100) + '%';
      seg.style.background = c;
      bar.appendChild(seg);
    });
    planned.appendChild(bar);
    stats.appendChild(planned);

    var counts = { ok: 0, warn: 0, bad: 0 };
    radar.forEach(function (r) { if (counts[r.status] != null) counts[r.status] += 1; });
    var sum = el('div', 'radar-sum');
    [['ok', 'i rute', 'var(--ok)'], ['warn', 'stramt', 'var(--warn)'], ['bad', 'i faresonen', 'var(--danger)']]
      .forEach(function (s) {
        var span = el('span');
        var dot = el('i');
        dot.style.background = s[2];
        span.appendChild(dot);
        span.appendChild(el('b', null, String(counts[s[0]])));
        span.appendChild(document.createTextNode(' ' + s[1]));
        sum.appendChild(span);
      });
    var value = counts.bad ? counts.bad + ' i faresonen' : (counts.warn ? counts.warn + ' stramt' : 'Alt i rute');
    stats.appendChild(stat('Frister', value, sum, counts.bad ? 'bad' : (counts.warn ? 'warn' : 'good')));

    var goalTotal = Number(state.interviewGoal.sessions) || 0;
    var goalMissing = plan.unplaced.filter(function (u) { return /– økt \d+ av/.test(u.name); }).length;
    stats.appendChild(stat('Intervjuøkter', (goalTotal - goalMissing) + ' / ' + goalTotal,
      state.interviewGoal.minutes + ' min hver, på ulike dager',
      goalMissing ? 'bad' : (goalTotal ? 'good' : '')));
  }

  function renderUnplaced(plan) {
    var list = $('unplacedList');
    list.textContent = '';
    plan.unplaced.forEach(function (u) {
      var li = el('li');
      var text = el('div');
      text.appendChild(el('div', 'title', u.name));
      text.appendChild(el('div', 'meta', u.category + ' · ' + formatHours(u.minutes) + ' gjenstår'));
      li.appendChild(text);
      li.appendChild(el('span', 'pill bad', u.reason));
      list.appendChild(li);
    });
    $('unplacedBox').hidden = plan.unplaced.length === 0;
  }

  function renderLegend() {
    var legend = $('legend');
    legend.textContent = '';
    state.courses.forEach(function (c) { legend.appendChild(codeChip(c.id)); });
    legend.appendChild(codeChip(null, 'Jobbsøking'));
    legend.appendChild(codeChip(null, 'Intervjuøving'));
    var fixed = el('span', 'code striped', 'Timeplan');
    legend.appendChild(fixed);
  }

  function loadInfo(day) {
    var wrap = el('div', 'load');
    var bar = el('div', 'load-bar');
    var fill = el('span');
    fill.style.width = Math.min(100, day.taskMinutes / 360 * 100) + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(el('div', 'load-text', formatHours(day.taskMinutes) + ' av 6 t'));
    return wrap;
  }

  function renderCalendar(plan) {
    var cal = $('cal');
    cal.textContent = '';
    var today = isoFromDate(new Date());

    cal.appendChild(el('div', 'cal-corner'));
    plan.days.forEach(function (day) {
      var head = el('div', 'cal-dayhead' + (day.date === today ? ' today' : ''));
      head.appendChild(el('div', 'dname', day.name.slice(0, 3)));
      head.appendChild(el('div', 'ddate', String(Number(day.date.slice(8)))));
      head.appendChild(loadInfo(day));
      cal.appendChild(head);
    });

    var times = el('div', 'cal-times');
    for (var h = 9; h < 21; h++) {
      var label = el('span', null, pad(h) + ':00');
      label.style.top = ((h * 60 - DAY_START) * PPM) + 'px';
      times.appendChild(label);
    }
    cal.appendChild(times);

    plan.days.forEach(function (day) {
      var isToday = day.date === today;
      var col = el('div', 'cal-col' + (isToday ? ' today' : ''));
      dayItems(day).forEach(function (it) {
        // Fixed events may extend outside 08-21; clip them to the visible grid.
        var s = Math.max(it.start, DAY_START);
        var e = Math.min(it.end, DAY_END);
        if (e <= s) return;
        var height = (e - s) * PPM;
        var ev = el('div', 'ev' + (it.kind !== 'task' ? ' ' + it.kind : '') + (height < 40 ? ' short' : ''));
        ev.style.setProperty('--c', it.color);
        ev.style.top = ((s - DAY_START) * PPM) + 'px';
        ev.style.height = (height - 2) + 'px';
        ev.style.setProperty('--lines', Math.max(1, Math.floor((height - 22) / 15)));
        ev.title = it.label + ': ' + it.name + ' (' + P.formatTime(it.start) + '–' + P.formatTime(it.end) + ')';
        ev.appendChild(el('span', 't', P.formatTime(it.start) + '–' + P.formatTime(it.end)));
        ev.appendChild(el('span', 'n', it.name));
        col.appendChild(ev);
      });
      var mins = nowMinutes();
      if (isToday && mins >= DAY_START && mins <= DAY_END) {
        var line = el('div', 'now-line');
        line.style.top = ((mins - DAY_START) * PPM) + 'px';
        col.appendChild(line);
      }
      cal.appendChild(col);
    });
  }

  function renderAgenda(plan) {
    var agenda = $('agenda');
    agenda.textContent = '';
    var today = isoFromDate(new Date());
    plan.days.forEach(function (day) {
      var box = el('div', 'ag-day' + (day.date === today ? ' today' : ''));
      var head = el('div', 'ag-head');
      var h3 = el('h3', null, day.name);
      h3.appendChild(el('small', null, shortDate(day.date)));
      head.appendChild(h3);
      head.appendChild(el('div', 'load-text', formatHours(day.taskMinutes) + ' oppgaver'));
      box.appendChild(head);

      var items = dayItems(day);
      if (!items.length) box.appendChild(el('div', 'ag-none', 'Ingenting planlagt'));
      items.forEach(function (it) {
        var row = el('div', 'ag-item' + (it.kind !== 'task' ? ' ' + it.kind : ''));
        row.style.setProperty('--c', it.color);
        row.appendChild(el('span', 't', P.formatTime(it.start) + '–' + P.formatTime(it.end)));
        row.appendChild(el('span', 'n', it.name));
        box.appendChild(row);
      });
      agenda.appendChild(box);
    });
  }

  function renderRadar(radar) {
    var list = $('radarList');
    list.textContent = '';
    if (!radar.length) {
      list.appendChild(el('li', 'empty', 'Ingen frister eller eksamener.'));
      return;
    }
    radar.forEach(function (r) {
      var li = el('li');
      var days = el('div', 'days ' + r.status);
      days.style.setProperty('--c', colorOf(r.courseId, r.category));
      if (r.daysLeft < 0) {
        days.appendChild(el('b', null, '!'));
        days.appendChild(el('small', null, 'passert'));
      } else if (r.daysLeft === 0) {
        days.appendChild(el('b', null, '0'));
        days.appendChild(el('small', null, 'i dag'));
      } else {
        days.appendChild(el('b', null, String(r.daysLeft)));
        days.appendChild(el('small', null, r.daysLeft === 1 ? 'dag' : 'dager'));
      }
      li.appendChild(days);

      var body = el('div');
      body.appendChild(el('div', 'title', r.name));
      var row = el('div', 'row2');
      row.appendChild(codeChip(r.courseId, r.category));
      var pill = el('span', 'pill ' + r.status, r.text);
      if (r.status === 'exam') pill.style.setProperty('--c', colorOf(r.courseId, r.category));
      row.appendChild(pill);
      body.appendChild(row);
      body.appendChild(el('div', 'meta', (r.type === 'exam' ? 'Eksamen ' : 'Frist ') + shortDate(r.date)));
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function renderChecklist(progress) {
    var list = $('checkList');
    list.textContent = '';
    var tasks = state.tasks.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
      return a.deadline && b.deadline ? diffDays(a.deadline, b.deadline) : 0;
    });
    var doneCount = tasks.filter(function (t) { return t.done; }).length;
    $('taskProgress').textContent = doneCount + ' av ' + tasks.length + ' ferdig';
    if (!tasks.length) list.appendChild(el('li', 'empty', 'Ingen oppgaver.'));

    tasks.forEach(function (t) {
      var li = el('li', t.done ? 'done' : '');
      var label = el('label');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!t.done;
      cb.addEventListener('change', function () {
        t.done = cb.checked;
        save();
        render();
        toast(cb.checked ? 'Ferdig! Planen er oppdatert.' : 'Oppgaven er tilbake i planen.');
      });
      label.appendChild(cb);

      var body = el('div');
      body.appendChild(el('div', 'title', t.name));
      var meta = el('div', 'meta');
      meta.appendChild(codeChip(t.courseId, t.category));
      if (t.deadline) meta.appendChild(el('span', null, 'frist ' + shortDate(t.deadline)));
      body.appendChild(meta);
      label.appendChild(body);

      var total = Math.round(t.hours * 60);
      var pr = progress[t.id];
      var hrs;
      if (t.done) hrs = el('span', 'hrs', formatHours(total));
      else if (pr && pr.missing) hrs = el('span', 'hrs bad', formatHours(total - pr.missing) + ' / ' + formatHours(total));
      else hrs = el('span', 'hrs', formatHours(total));
      hrs.title = t.done ? 'Ferdig' : 'Planlagt denne uka / totalt';
      label.appendChild(hrs);

      li.appendChild(label);
      list.appendChild(li);
    });
  }

  // ---------- edit drawer ----------

  function listItem(title, meta, color, onDelete) {
    var li = el('li');
    var dot = el('span', 'dot');
    dot.style.setProperty('--c', color);
    li.appendChild(dot);
    var text = el('div', 'text');
    text.appendChild(el('div', 'title', title));
    text.appendChild(el('div', 'meta', meta));
    li.appendChild(text);
    var b = el('button', 'del');
    b.type = 'button';
    b.title = 'Slett';
    b.setAttribute('aria-label', 'Slett ' + title);
    b.appendChild(svgIcon('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6'));
    b.addEventListener('click', function () {
      if (onDelete() === false) return;
      save();
      render();
    });
    li.appendChild(b);
    return li;
  }

  function fillList(id, items, emptyText, build) {
    var ul = $(id);
    ul.textContent = '';
    if (!items.length) ul.appendChild(el('li', 'empty', emptyText));
    items.forEach(function (it) { ul.appendChild(build(it)); });
  }

  function removeById(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { arr.splice(i, 1); return; }
  }

  function renderEditLists() {
    fillList('courseList', state.courses, 'Ingen fag ennå', function (c) {
      return listItem(c.code, c.name, c.color, function () {
        var linked = state.lectures.filter(function (l) { return l.courseId === c.id; }).length +
          state.exams.filter(function (x) { return x.courseId === c.id; }).length;
        if (linked && !confirm('Slette ' + c.code + '? Timeplan og eksamener for faget slettes også.')) return false;
        removeById(state.courses, c.id);
        state.lectures = state.lectures.filter(function (l) { return l.courseId !== c.id; });
        state.exams = state.exams.filter(function (x) { return x.courseId !== c.id; });
        state.tasks.forEach(function (t) { if (t.courseId === c.id) t.courseId = null; });
      });
    });

    var lectures = state.lectures.slice().sort(function (a, b) {
      return a.day - b.day || P.parseTime(a.start) - P.parseTime(b.start);
    });
    fillList('lectureList', lectures, 'Ingen timer i timeplanen ennå', function (l) {
      var c = course(l.courseId);
      return listItem((c ? c.code : 'Fag') + ' · ' + l.kind, P.DAY_NAMES[l.day] + ' ' + l.start + '–' + l.end,
        colorOf(l.courseId, 'Fag'), function () { removeById(state.lectures, l.id); });
    });

    fillList('taskList', state.tasks, 'Ingen oppgaver ennå', function (t) {
      var c = course(t.courseId);
      var meta = (c ? c.code : t.category) + ' · ' + formatHours(t.hours * 60) +
        (t.deadline ? ' · frist ' + shortDate(t.deadline) : '') + (t.done ? ' · ferdig' : '');
      return listItem(t.name, meta, colorOf(t.courseId, t.category), function () { removeById(state.tasks, t.id); });
    });

    var exams = state.exams.slice().sort(function (a, b) { return diffDays(a.date, b.date); });
    fillList('examList', exams, 'Ingen eksamener ennå', function (x) {
      var c = course(x.courseId);
      return listItem((c ? c.code : 'Fag') + ' · Eksamen', shortDate(x.date) + ' ' + x.date.slice(0, 4) +
        ' · ' + x.start + '–' + x.end, colorOf(x.courseId, 'Fag'), function () { removeById(state.exams, x.id); });
    });

    $('courseCount').textContent = state.courses.length;
    $('lectureCount').textContent = state.lectures.length;
    $('taskCount').textContent = state.tasks.length;
    $('examCount').textContent = state.exams.length;

    Array.prototype.forEach.call(document.querySelectorAll('.course-select'), function (sel) {
      var prev = sel.value;
      sel.textContent = '';
      if (sel.getAttribute('data-optional')) {
        var none = el('option', null, 'Ingen');
        none.value = '';
        sel.appendChild(none);
      }
      state.courses.forEach(function (c) {
        var o = el('option', null, c.code + ' – ' + c.name);
        o.value = c.id;
        sel.appendChild(o);
      });
      if (prev && course(prev)) sel.value = prev;
    });

    var goalForm = $('goalForm');
    goalForm.sessions.value = state.interviewGoal.sessions;
    goalForm.minutes.value = state.interviewGoal.minutes;
  }

  function openDrawer() {
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    $('backdrop').hidden = false;
    document.body.classList.add('drawer-open');
  }

  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('backdrop').hidden = true;
    document.body.classList.remove('drawer-open');
  }

  function selectTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var active = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
      p.hidden = p.getAttribute('data-panel') !== name;
    });
  }

  function showError(form, msg) {
    form.querySelector('[data-error]').textContent = msg || '';
    return !msg;
  }

  function needCourse(form) {
    if (!form.course.value) return showError(form, 'Legg til et fag først (fanen «Fag»).');
    return true;
  }

  function changed(msg) {
    save();
    render();
    if (msg) toast(msg);
  }

  // ---------- calendar export (.ics) ----------

  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function icsStamp(iso, minutes) {
    return iso.replace(/-/g, '') + 'T' + pad(Math.floor(minutes / 60)) + pad(minutes % 60) + '00';
  }

  function exportIcs() {
    var plan = P.makePlan(buildInput(weekStart));
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' +
      pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ukeplanlegger//NO', 'CALSCALE:GREGORIAN'];
    var n = 0;
    plan.days.forEach(function (day) {
      dayItems(day).forEach(function (it) {
        n += 1;
        lines.push('BEGIN:VEVENT',
          'UID:' + weekStart + '-' + n + '@ukeplanlegger',
          'DTSTAMP:' + stamp,
          'DTSTART:' + icsStamp(day.date, it.start),
          'DTEND:' + icsStamp(day.date, it.end),
          'SUMMARY:' + icsEscape(it.name),
          'CATEGORIES:' + icsEscape(it.label),
          'END:VEVENT');
      });
    });
    lines.push('END:VCALENDAR');
    var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ukeplan-uke' + isoWeek(weekStart) + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast(n + ' hendelser lastet ned. Importer filen i kalenderen din.');
  }

  // ---------- sample data ----------
  // Courses, assignments and the AI exam date come from the user's own course material
  // (ITPE3200, DAVE3625, ITPE3100). Weekly lecture times are assumptions.

  function sampleData() {
    var ws = isoFromDate(new Date()); // deadlines are relative to today so the demo always makes sense
    return {
      courses: [
        { id: 'itpe3200', code: 'ITPE3200', name: 'Webapplikasjoner', color: '#2563eb' },
        { id: 'dave3625', code: 'DAVE3625', name: 'Introduksjon til kunstig intelligens', color: '#9333ea' },
        { id: 'itpe3100', code: 'ITPE3100', name: 'Datasikkerhet', color: '#0891b2' }
      ],
      lectures: [
        { id: 'l1', courseId: 'itpe3200', kind: 'Forelesning', day: 0, start: '10:15', end: '12:00' },
        { id: 'l2', courseId: 'dave3625', kind: 'Forelesning', day: 1, start: '10:15', end: '12:00' },
        { id: 'l3', courseId: 'itpe3200', kind: 'Lab', day: 2, start: '12:15', end: '14:00' },
        { id: 'l4', courseId: 'itpe3100', kind: 'Forelesning', day: 3, start: '09:15', end: '11:00' },
        { id: 'l5', courseId: 'dave3625', kind: 'Lab', day: 3, start: '14:15', end: '16:00' },
        { id: 'l6', courseId: 'itpe3100', kind: 'Øving', day: 4, start: '10:15', end: '12:00' }
      ],
      exams: [
        { id: 'x1', courseId: 'dave3625', date: '2026-11-20', start: '09:00', end: '13:00' }
      ],
      tasks: [
        { id: 't1', name: 'Eksamensøving: ordinær eksamen 2025', category: 'Fag', courseId: 'itpe3100', hours: 3, deadline: ws },
        { id: 't2', name: 'Modul 4: AES- og RSA-oppgaver', category: 'Fag', courseId: 'itpe3100', hours: 2.5, deadline: addDays(ws, 1) },
        { id: 't3', name: 'Lab 5: gå gjennom notebook', category: 'Fag', courseId: 'dave3625', hours: 2, deadline: addDays(ws, 2) },
        { id: 't4', name: 'Gruppeprosjekt: API-endepunkter for quiz (sub-app 2)', category: 'Fag', courseId: 'itpe3200', hours: 4, deadline: addDays(ws, 3) },
        { id: 't5', name: 'Dokumentasjon: arkitektur- og UML-diagrammer', category: 'Fag', courseId: 'itpe3200', hours: 3, deadline: addDays(ws, 5) },
        { id: 't6', name: 'Eksamensøving: ordinær eksamen 2025', category: 'Fag', courseId: 'dave3625', hours: 3, deadline: '2026-11-19' },
        { id: 't7', name: 'React-klient: side for quiz-historikk', category: 'Fag', courseId: 'itpe3200', hours: 2 },
        { id: 't9', name: 'Repetisjon modul 2–3: CIA-triaden, kryptografi og hash', category: 'Fag', courseId: 'itpe3100', hours: 1.5 },
        { id: 't10', name: 'Søknad: traineeprogram hos Eksempel AS', category: 'Jobbsøking', courseId: null, hours: 2, deadline: addDays(ws, -3) },
        { id: 't11', name: 'Oppdatere CV og GitHub-profil', category: 'Jobbsøking', courseId: null, hours: 1.5 },
        { id: 't12', name: 'LeetCode: arrays og hashing', category: 'Intervjuøving', courseId: null, hours: 2 },
        { id: 't13', name: 'Mandatory Assignment 2: maskinlæring', category: 'Fag', courseId: 'dave3625', hours: 6, done: true }
      ],
      interviewGoal: { sessions: 3, minutes: 45 }
    };
  }

  // ---------- wiring ----------

  function init() {
    P.DAY_NAMES.forEach(function (name, i) {
      var o = el('option', null, name);
      o.value = i;
      $('daySelect').appendChild(o);
    });
    P.CATEGORIES.forEach(function (c) {
      var o = el('option', null, c);
      o.value = c;
      $('categorySelect').appendChild(o);
    });
    COLORS.forEach(function (c) {
      var o = el('option', null, c.name);
      o.value = c.value;
      $('colorSelect').appendChild(o);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { selectTab(t.getAttribute('data-tab')); });
    });

    $('prevWeek').addEventListener('click', function () { weekStart = addDays(weekStart, -7); render(); });
    $('nextWeek').addEventListener('click', function () { weekStart = addDays(weekStart, 7); render(); });
    $('todayBtn').addEventListener('click', function () { weekStart = P.mondayOf(new Date()); render(); });

    $('editBtn').addEventListener('click', openDrawer);
    $('closeDrawer').addEventListener('click', closeDrawer);
    $('backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    $('planBtn').addEventListener('click', function () {
      render();
      toast('Planen er laget for uke ' + isoWeek(weekStart) + '.');
    });
    $('icsBtn').addEventListener('click', exportIcs);

    Array.prototype.forEach.call(document.querySelectorAll('[data-action]'), function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-action') === 'edit') return openDrawer();
        state = sampleData();
        weekStart = P.mondayOf(new Date());
        changed('Eksempeldata er lagt inn.');
        closeDrawer();
      });
    });
    $('clearBtn').addEventListener('click', function () {
      if (!confirm('Slette alle fag, timer, oppgaver og eksamener?')) return;
      state = emptyState();
      changed('Alle data er slettet.');
    });

    $('courseForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var code = f.code.value.trim().toUpperCase();
      var name = f.itemName.value.trim();
      if (!code || !name) return showError(f, 'Fyll inn emnekode og navn.');
      showError(f, '');
      state.courses.push({ id: uid(), code: code, name: name, color: f.color.value });
      f.code.value = '';
      f.itemName.value = '';
      f.color.selectedIndex = state.courses.length % COLORS.length;
      changed('Faget er lagt til.');
    });

    $('lectureForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      if (!needCourse(f)) return;
      if (P.parseTime(f.end.value) <= P.parseTime(f.start.value)) return showError(f, 'Slutt må være etter start.');
      showError(f, '');
      state.lectures.push({ id: uid(), courseId: f.course.value, kind: f.kind.value,
        day: Number(f.day.value), start: f.start.value, end: f.end.value });
      changed('Lagt til i timeplanen.');
    });

    $('taskForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var name = f.itemName.value.trim();
      var hours = Number(f.hours.value);
      if (!name) return showError(f, 'Skriv inn et navn.');
      if (!(hours > 0)) return showError(f, 'Estimert tid må være større enn 0.');
      showError(f, '');
      var task = { id: uid(), name: name, category: f.category.value, courseId: f.course.value || null, hours: hours };
      if (f.deadline.value) task.deadline = f.deadline.value;
      state.tasks.push(task);
      f.itemName.value = '';
      f.deadline.value = '';
      changed('Oppgaven er lagt til.');
    });

    $('examForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      if (!needCourse(f)) return;
      if (!f.date.value) return showError(f, 'Velg en dato.');
      if (P.parseTime(f.end.value) <= P.parseTime(f.start.value)) return showError(f, 'Slutt må være etter start.');
      showError(f, '');
      state.exams.push({ id: uid(), courseId: f.course.value, date: f.date.value, start: f.start.value, end: f.end.value });
      f.date.value = '';
      changed('Eksamen er lagt til.');
    });

    $('goalForm').addEventListener('change', function (e) {
      var f = e.currentTarget;
      var sessions = Math.max(0, Math.min(14, Math.floor(Number(f.sessions.value) || 0)));
      var minutes = Math.max(15, Math.min(120, Math.round(Number(f.minutes.value) || 45)));
      state.interviewGoal = { sessions: sessions, minutes: minutes };
      changed();
    });
    $('goalForm').addEventListener('submit', function (e) { e.preventDefault(); });

    // First visit: start with sample data so the app is ready for a demo.
    if (firstVisit) {
      state = sampleData();
      save();
    }
    render();
    // Keep "now" indicators fresh.
    setInterval(function () { if (!$('drawer').classList.contains('open')) render(); }, 60000);
  }

  init();
})();
