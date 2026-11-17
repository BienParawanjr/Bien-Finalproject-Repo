(function () {
  'use strict';

  /* =======================================================
     1. CONSTANTS
     ======================================================= */
  var SESSION_KEY = 'sabaings:session';   // who is logged in
  var USERS_KEY = 'sabaings:users';       // everyone who has logged in on this device
  var DATA_PREFIX = 'sabaings:data:';     // one data object per student
  var LOW_BALANCE = 500;                  // show a warning below this balance (₱)
  var WARN_RATIO = 0.8;                   // "almost at limit" starts at 80% of a budget
  var MINUS = '\u2212';
  var THEME_KEY = 'sabaings:theme';       // NEW: saved dark / light choice

  // Expense category keys match the ids used in expenses.html (food-budget, progress-food, ...)
  var EXPENSE_CATEGORIES = [
    { key: 'food', label: 'Food', budget: 1500 },
    { key: 'transpo', label: 'Transportation', budget: 800 },
    { key: 'entertainment', label: 'Entertainment', budget: 300 },
    { key: 'shopping', label: 'Shopping', budget: 250 },
    { key: 'housing', label: 'Housing', budget: 600 },
    { key: 'health', label: 'Health Care', budget: 150 },
    { key: 'learning', label: 'Improvement & Learning', budget: 300 },
    { key: 'sub', label: 'Subscription', budget: 150 },
    { key: 'others', label: 'Others', budget: 200 }
  ];

  var INCOME_CATEGORIES = [
    { key: 'allowance', label: 'Allowance' },
    { key: 'scholarship', label: 'Scholarship' },
    { key: 'side-hustle', label: 'Side Hustle' },
    { key: 'gift', label: 'Gift' },
    { key: 'other', label: 'Other' }
  ];

  var PAYMENT_LABELS = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', bank: 'Debit Card / Bank', other: 'Other' };
  var FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', 'one-time': 'One-time' };
  var STATUS_LABELS = { received: 'Received', expected: 'Expected', overdue: 'Overdue' };
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  var DEFAULT_GOALS = [
    { id: 'baon-buffer', name: 'Baon Buffer', description: 'Emergency money for unexpected school expenses.', target: 1000, initial: 0, category: 'emergency', targetDate: '' },
    { id: 'tech-gear', name: 'Tech & Gear Fund', description: 'Saving for a mouse, keyboard, headphones, or laptop accessories.', target: 5000, initial: 0, category: 'technology', targetDate: '' },
    { id: 'transport', name: 'Transport Fund', description: 'Saving for commuting expenses or future transportation needs.', target: 1500, initial: 0, category: 'transportation', targetDate: '' },
    { id: 'fun-leisure', name: 'Fun & Leisure Fund', description: 'Saving for games, manga, hobbies, or outings with friends.', target: 2000, initial: 0, category: 'leisure', targetDate: '' }
  ];

  /* =======================================================
     2. STATE
     ======================================================= */
  var user = null;   // { name, studentId, key }
  var data = null;   // { transactions, budgets, goals, savingsLog, notes }

  // NEW: state for the snackbar, delete modal and Google Charts
  var snackbarTimer = null;   // hides the snackbar after 3 seconds
  var deleteCallback = null;  // what to do when the user presses Delete in the modal
  var deleteTrigger = null;   // the button that opened the modal (focus returns to it)
  var chartsReady = false;    // true once the Google Charts library has loaded

  /* =======================================================
     3. SMALL HELPERS
     ======================================================= */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function pad(n) { return String(n).padStart(2, '0'); }

  function peso(value) {
    var n = Number(value) || 0;
    var text = Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : '') + '\u20B1' + text;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function sumAmounts(list) {
    return list.reduce(function (total, item) { return total + Number(item.amount || 0); }, 0);
  }

  function setText(selector, text, root) {
    var el = $(selector, root);
    if (el) el.textContent = text;
  }

  // ----- dates (all dates are stored as "YYYY-MM-DD" text) -----
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return toISO(new Date()); }
  function parseISO(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function monthOf(s) { return s ? s.slice(0, 7) : ''; }
  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

  function formatDate(s) {
    if (!s) return '\u2014';
    return parseISO(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function formatShort(s) {
    return parseISO(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function monthLabel(ym) {
    var p = ym.split('-');
    return MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0];
  }
  function daysLeftThisMonth() {
    var now = new Date();
    return daysInMonth(now.getFullYear(), now.getMonth() + 1) - now.getDate() + 1;
  }

  // "2026-W43" <-> a Monday-to-Sunday range
  function isoWeekValue(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + '-W' + pad(week);
  }
  function weekRange(value) {
    var m = /^(\d{4})-W(\d{2})$/.exec(value || '');
    if (!m) return null;
    var jan4 = new Date(Number(m[1]), 0, 4);
    var dow = (jan4.getDay() + 6) % 7;
    var start = new Date(Number(m[1]), 0, 4 - dow + (Number(m[2]) - 1) * 7);
    var end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: toISO(start), end: toISO(end) };
  }
  function inRange(date, range) { return !!date && date >= range.start && date <= range.end; }

  function ensureYearOption(select, year) {
    if (!select) return;
    var has = $$('option', select).some(function (o) { return o.value === String(year); });
    if (!has) {
      var opt = document.createElement('option');
      opt.value = String(year);
      opt.textContent = String(year);
      select.appendChild(opt);
    }
  }

  function fillSelect(select, items, placeholder) {
    select.innerHTML = '';
    if (placeholder) {
      var first = document.createElement('option');
      first.value = '';
      first.textContent = placeholder;
      first.disabled = true;
      first.selected = true;
      select.appendChild(first);
    }
    items.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.key;
      opt.textContent = item.label;
      select.appendChild(opt);
    });
  }

  function labelOf(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label;
    return key || '';
  }

  function showFeedback(form, message, isError) {
    var el = $('.form-feedback', form);
    if (!el) {
      el = document.createElement('p');
      el.className = 'form-feedback';
      el.setAttribute('role', 'status');
      form.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
    if (!isError) showSnackbar(message);   // NEW: success messages pop up as a snackbar
    clearTimeout(el._timer);
    if (!isError) el._timer = setTimeout(function () { el.textContent = ''; }, 3500);
  }

  function scrollToSection(selector, focusSelector) {
    var section = $(selector);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var field = focusSelector ? $(focusSelector) : null;
    if (field) setTimeout(function () { field.focus({ preventScroll: true }); }, 250);
  }

  function parseAmount(value) {
    var n = parseFloat(value);
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  /* =======================================================
     4. STORAGE (localStorage)
     ======================================================= */
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('SaBaings: could not save to localStorage', e); }
  }

  // Make sure saved data always has every field the pages expect
  function normalizeData(d) {
    d = d && typeof d === 'object' ? d : {};
    var budgets = {};
    EXPENSE_CATEGORIES.forEach(function (c) {
      var v = d.budgets ? Number(d.budgets[c.key]) : NaN;
      budgets[c.key] = isFinite(v) && v >= 0 ? v : c.budget;
    });
    return {
      transactions: Array.isArray(d.transactions) ? d.transactions : [],
      budgets: budgets,
      goals: Array.isArray(d.goals) ? d.goals : DEFAULT_GOALS.map(function (g) { return Object.assign({}, g); }),
      savingsLog: Array.isArray(d.savingsLog) ? d.savingsLog : [],
      notes: Array.isArray(d.notes) ? d.notes : [],
      avatar: typeof d.avatar === 'string' && d.avatar.indexOf('data:image/') === 0 ? d.avatar : ''   // NEW: profile picture
    };
  }
  function persist() { save(DATA_PREFIX + user.key, data); }

  /* =======================================================
     5. LOG-IN / LOG-OUT
     ======================================================= */
  function userKey(name) { return name.trim().toLowerCase().replace(/\s+/g, ' '); }

  function bindLogin() {
    var form = $('#login-form');
    if (form) form.addEventListener('submit', onLogin);
  }

  function onLogin(event) {
    event.preventDefault();
    var errorBox = $('#login-error');
    var name = $('#login-name').value.trim().replace(/\s+/g, ' ');
    var studentId = $('#login-student-id') ? $('#login-student-id').value.trim() : '';
    var pin = $('#login-pin') ? $('#login-pin').value.trim() : '';

    function fail(message) { errorBox.textContent = message; }

    if (name.length < 2) return fail('Please enter your name (at least 2 characters).');
    if (pin && !/^\d{4,6}$/.test(pin)) return fail('Your PIN must be 4 to 6 digits.');

    var key = userKey(name);
    var users = load(USERS_KEY, {});
    var existing = users[key];

    if (existing && existing.pin && existing.pin !== pin) {
      return fail('That PIN does not match this student name.');
    }
    users[key] = {
      name: existing ? existing.name : name,
      studentId: studentId || (existing ? existing.studentId : ''),
      pin: (existing && existing.pin) || pin || ''
    };
    save(USERS_KEY, users);

    user = { name: users[key].name, studentId: users[key].studentId, key: key };
    save(SESSION_KEY, user);
    errorBox.textContent = '';
    $('#login-form').reset();
    startApp();
  }

  function logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    window.location.reload();
  }

  function lockApp() {
    document.body.classList.add('is-locked');
    var field = $('#login-name');
    if (field) field.focus();
  }

  /* =======================================================
     6. CALCULATIONS
     ======================================================= */
  function allExpenses() { return data.transactions.filter(function (t) { return t.type === 'expense'; }); }
  function allIncome() { return data.transactions.filter(function (t) { return t.type === 'income'; }); }
  function receivedIncome() { return allIncome().filter(function (t) { return t.status === 'received'; }); }
  function pendingIncome() { return allIncome().filter(function (t) { return t.status !== 'received'; }); }

  // An expected payment becomes "overdue" automatically once its date has passed
  function effectiveStatus(t) {
    if (t.status === 'received') return 'received';
    if (t.expectedDate && t.expectedDate < todayISO()) return 'overdue';
    return t.status === 'overdue' ? 'overdue' : 'expected';
  }

  function sortNewestFirst(list) {
    return list.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function expensesInMonth(ym) { return allExpenses().filter(function (t) { return monthOf(t.date) === ym; }); }
  function receivedInMonth(ym) { return receivedIncome().filter(function (t) { return monthOf(t.date) === ym; }); }

  function spentByCategory(ym) {
    var map = {};
    EXPENSE_CATEGORIES.forEach(function (c) { map[c.key] = 0; });
    expensesInMonth(ym).forEach(function (t) { map[t.category] = (map[t.category] || 0) + Number(t.amount); });
    return map;
  }

  function budgetTotal() {
    return EXPENSE_CATEGORIES.reduce(function (total, c) { return total + data.budgets[c.key]; }, 0);
  }

  function budgetState(spent, budget) {
    if (budget <= 0) return { key: spent > 0 ? 'limit' : 'ok', label: 'No budget set', pct: spent > 0 ? 100 : 0 };
    var pct = Math.round(spent / budget * 100);
    if (spent > budget) return { key: 'limit', label: 'Over budget', pct: pct };
    if (spent === budget) return { key: 'limit', label: 'Limit reached', pct: pct };
    if (spent / budget >= WARN_RATIO) return { key: 'warning', label: 'Almost at limit', pct: pct };
    return { key: 'ok', label: 'On track', pct: pct };
  }

  function addTransaction(tx) {
    tx.id = uid();
    tx.createdAt = Date.now();
    data.transactions.push(tx);
    persist();
  }
  function findTransaction(id) {
    for (var i = 0; i < data.transactions.length; i++) if (data.transactions[i].id === id) return data.transactions[i];
    return null;
  }
  function removeTransaction(id) {
    data.transactions = data.transactions.filter(function (t) { return t.id !== id; });
    persist();
  }

  // Simple horizontal bar chart drawn with HTML (no chart library needed)
  function renderBars(box, items, emptyText) {
    if (!box) return;
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([0]));
    if (!items.length || max === 0) {
      box.innerHTML = '<p>' + escapeHtml(emptyText) + '</p>';
      return;
    }
    box.innerHTML = '<ul class="bar-chart">' + items.map(function (i) {
      return '<li class="bar-row"><span class="bar-label">' + escapeHtml(i.label) + '</span>' +
        '<span class="bar-track"><span class="bar-fill"></span></span>' +
        '<span class="bar-value">' + peso(i.value) + '</span></li>';
    }).join('') + '</ul>';
    $$('.bar-fill', box).forEach(function (el, idx) {
      el.style.setProperty('--value', (items[idx].value / max * 100).toFixed(1));
    });
    box.setAttribute('aria-label', 'Bar chart: ' + items.map(function (i) { return i.label + ' ' + peso(i.value); }).join(', '));
  }

  /* =======================================================
     NEW A. SNACKBAR  (W3Schools "Snackbar")
     showSnackbar('text') shows the #snackbar bar for 3 seconds.
     It is called after adding, updating and deleting things.
     ======================================================= */
  function showSnackbar(message, isError) {
    var bar = $('#snackbar');
    if (!bar) return;
    bar.textContent = message;
    bar.classList.toggle('is-error', !!isError);
    bar.classList.remove('show');
    void bar.offsetWidth;                  // restart the fade animation if another message follows quickly
    bar.classList.add('show');
    clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(function () { bar.classList.remove('show'); }, 3000);
  }

  /* =======================================================
     NEW B. DELETE MODAL  (W3Schools "Delete Modal")
     confirmDelete('question', function () { ...delete... }) opens the modal.
     The function is only run if the user presses the Delete button.
     ======================================================= */
  function confirmDelete(message, onConfirm) {
    var modal = $('#delete-modal');
    if (!modal) { if (window.confirm(message)) onConfirm(); return; }   // safety net
    deleteCallback = onConfirm;
    deleteTrigger = document.activeElement;
    setText('#delete-modal-text', message);
    modal.classList.add('is-open');
    $('#delete-cancel-button').focus();    // the safe choice has the focus first
  }

  function closeDeleteModal() {
    var modal = $('#delete-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    deleteCallback = null;
    if (deleteTrigger && document.contains(deleteTrigger)) deleteTrigger.focus();
    deleteTrigger = null;
  }

  function bindDeleteModal() {
    var modal = $('#delete-modal');
    if (!modal) return;
    var closeButton = $('.delete-modal-close', modal);
    var cancelButton = $('#delete-cancel-button');
    var confirmButton = $('#delete-confirm-button');

    confirmButton.addEventListener('click', function () {
      var run = deleteCallback;
      closeDeleteModal();
      if (run) run();                      // delete only after the user confirmed
    });
    cancelButton.addEventListener('click', closeDeleteModal);
    closeButton.addEventListener('click', closeDeleteModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeDeleteModal(); });   // click outside

    document.addEventListener('keydown', function (e) {
      if (!modal.classList.contains('is-open')) return;
      if (e.key === 'Escape') { closeDeleteModal(); return; }
      if (e.key === 'Tab') {               // keep the keyboard focus inside the modal
        var items = [closeButton, cancelButton, confirmButton];
        var index = items.indexOf(document.activeElement);
        e.preventDefault();
        index = e.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
        items[index].focus();
      }
    });
  }

  /* =======================================================
     NEW C. DARK MODE  (W3Schools "Toggle Dark Mode")
     Adds / removes data-theme="dark" on <html>. style.css (section 23)
     changes all the colors. The choice is saved on this device.
     ======================================================= */
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    var button = $('#theme-toggle');
    if (button) {
      var dark = theme === 'dark';
      button.textContent = dark ? '\u2600 Light' : '\u263E Dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }
    redrawCharts(true);                    // the charts use the theme colors too
  }

  function initTheme() {
    applyTheme(load(THEME_KEY, 'light') === 'dark' ? 'dark' : 'light');
    var button = $('#theme-toggle');
    if (!button) return;
    button.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      save(THEME_KEY, next);
      showSnackbar(next === 'dark' ? 'Dark mode is on.' : 'Light mode is on.');
    });
  }

  /* =======================================================
     NEW D. SCROLL TO TOP BUTTON  (W3Schools "Scroll To Top Button")
     Shows after scrolling down 300px. Clicking it scrolls smoothly to the top.
     ======================================================= */
  function initScrollTop() {
    var button = $('#scroll-top-button');
    if (!button) return;
    function update() { button.classList.toggle('is-visible', window.pageYOffset > 300); }
    window.addEventListener('scroll', update, { passive: true });
    update();
    button.addEventListener('click', function () {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* =======================================================
     NEW E. GOOGLE CHARTS  (official library, loaded by the <script> in each page's <head>)
     drawChart(box, spec) draws one chart inside a .chart-box:
       spec.type     'PieChart' | 'BarChart' | 'ColumnChart' | 'LineChart'
       spec.header   column names, e.g. ['Category', 'Spent']
       spec.rows     [[label, number, ...], ...]   (numbers are pesos)
       spec.colors   color names from chartTheme().named, e.g. ['income', 'expense']
       spec.options  extra Google Charts options
       spec.items    [{label, value}] -> the old HTML bars are used if Google Charts cannot load
     ======================================================= */
  function loadGoogleCharts() {
    if (!window.google || !google.charts) return;          // offline: the old HTML bars (or a message) are shown
    google.charts.load('current', { packages: ['corechart'] });
    google.charts.setOnLoadCallback(function () {
      chartsReady = true;
      redrawCharts(true);
    });

    var resizeTimer;
    window.addEventListener('resize', function () {         // redraw so the charts fit the new screen width
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { redrawCharts(false); }, 250);
    });
  }

  function chartTheme() {
    var dark = currentTheme() === 'dark';
    var css = getComputedStyle(document.documentElement);
    return {
      text: css.getPropertyValue('--ink').trim() || '#2A1B4D',
      grid: css.getPropertyValue('--border').trim() || '#D2C7EE',
      bg: css.getPropertyValue('--chart-bg').trim() || '#FFFFFF',
      slices: dark
        ? ['#B49BF2', '#FF7DA5', '#E0A04A', '#8CA6FF', '#3FBFAE', '#D98A4A', '#C7B8F7', '#9AA5B1', '#FFB3CF']
        : ['#5B3FA6', '#C23A80', '#C9822B', '#3A59C8', '#2A9D8F', '#8F1F46', '#9275D9', '#6C757D', '#B5651D'],
      named: dark
        ? { income: '#8CA6FF', expense: '#FF7DA5', budget: '#B49BF2', spent: '#FF7DA5', saved: '#8CA6FF', remaining: '#5A4C94', bar: '#B49BF2', line: '#B49BF2' }
        : { income: '#3A59C8', expense: '#C23A80', budget: '#9275D9', spent: '#C23A80', saved: '#3A59C8', remaining: '#D9CEF3', bar: '#5B3FA6', line: '#5B3FA6' }
    };
  }

  function mergeOptions(base, extra) {
    Object.keys(extra || {}).forEach(function (key) {
      var value = extra[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
        mergeOptions(base[key], value);
      } else {
        base[key] = value;
      }
    });
    return base;
  }

  function drawChart(box, spec) {
    if (!box) return;
    box._chartSpec = spec;                                  // remembered so the chart can be redrawn (resize, dark mode)

    var hasData = spec.rows.some(function (row) {
      return row.slice(1).some(function (value) { return value > 0; });
    });
    if (!hasData) {
      box.classList.remove('has-gchart');
      box._drawn = false;
      box.innerHTML = '<p>' + escapeHtml(spec.empty) + '</p>';
      box.setAttribute('aria-label', spec.empty);
      return;
    }

    if (chartsReady) {
      try { drawGoogleChart(box, spec); return; }
      catch (error) { console.warn('SaBaings: Google Charts could not draw this chart', error); }
    }

    // Library missing, still loading, or failed: show the old bars (or a short message)
    box.classList.remove('has-gchart');
    box._drawn = false;
    if (spec.items) renderBars(box, spec.items, spec.empty);
    else box.innerHTML = '<p>' + (window.google && google.charts && !chartsReady
      ? 'Loading chart\u2026'
      : 'The chart could not be loaded. Check your internet connection.') + '</p>';
  }

  function drawGoogleChart(box, spec) {
    var theme = chartTheme();
    var isPie = spec.type === 'PieChart';
    var narrow = box.clientWidth < 520;
    var height = spec.height || 320;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var holder = $('.gchart', box);
    if (!holder) {
      box.innerHTML = '';
      holder = document.createElement('div');
      holder.className = 'gchart';
      box.appendChild(holder);
    }
    box.classList.add('has-gchart');
    holder.style.height = height + 'px';

    // data table (first column = label, other columns = pesos)
    var table = new google.visualization.DataTable();
    spec.header.forEach(function (name, index) { table.addColumn(index === 0 ? 'string' : 'number', name); });
    table.addRows(spec.rows);
    var pesoFormat = new google.visualization.NumberFormat({ prefix: '\u20B1', fractionDigits: 2 });
    for (var col = 1; col < spec.header.length; col++) pesoFormat.format(table, col);

    var axis = {
      textStyle: { color: theme.text },
      titleTextStyle: { color: theme.text },
      gridlines: { color: theme.grid },
      baselineColor: theme.grid
    };
    var options = {
      height: height,
      backgroundColor: { fill: 'transparent' },
      fontName: 'Inter, Segoe UI, Arial, sans-serif',
      fontSize: 13,
      colors: (isPie || !spec.colors) ? theme.slices : spec.colors.map(function (name) { return theme.named[name]; }),
      legend: {
        position: isPie ? (narrow ? 'bottom' : 'right') : (spec.header.length > 2 ? 'top' : 'none'),
        textStyle: { color: theme.text }
      },
      hAxis: mergeOptions({}, axis),
      vAxis: mergeOptions({}, axis),
      animation: { startup: !box._drawn, duration: reduceMotion ? 0 : 600, easing: 'out' }
    };
    if (isPie) {
      options.pieSliceText = 'percentage';
      options.pieSliceTextStyle = { color: '#FFFFFF', fontSize: 12 };
      options.pieSliceBorderColor = theme.bg;
      options.sliceVisibilityThreshold = 0;
    }
    mergeOptions(options, spec.options);

    new google.visualization[spec.type](holder).draw(table, options);

    box._drawn = true;
    box._drawnWidth = box.clientWidth;
    box.setAttribute('aria-label', spec.summary + ': ' + spec.rows.map(function (row) {
      return row[0] + ' ' + row.slice(1).map(peso).join(' / ');
    }).join('; '));
  }

  // Redraw every chart on the page (after the library loads, a theme change or a resize)
  function redrawCharts(force) {
    $$('.chart-box').forEach(function (box) {
      if (!box._chartSpec) return;
      if (!force && box._drawnWidth === box.clientWidth) return;
      drawChart(box, box._chartSpec);
    });
  }

    /* =======================================================
     7. START THE APP AFTER LOG-IN
     ======================================================= */
  function startApp() {
    data = normalizeData(load(DATA_PREFIX + user.key, null));
    document.body.classList.remove('is-locked');

    setText('#welcome-message', 'Welcome back, ' + user.name + '!');
    var logoutButton = $('#logout-button');
    if (logoutButton && !logoutButton._bound) {
      logoutButton.addEventListener('click', logout);
      logoutButton._bound = true;
    }

    var page = document.body.getAttribute('data-page');
    initHeroVideo();                       // does nothing on pages without the video hero
    if (page === 'dashboard') initDashboard();
    else if (page === 'expenses') initExpenses();
    else if (page === 'income') initIncome();
    else if (page === 'saving') initSaving();
  }

  function init() {
    initTheme();               // NEW: dark mode
    initScrollTop();           // NEW: scroll to top button
    bindDeleteModal();         // NEW: delete modal
    loadGoogleCharts();        // NEW: Google Charts
    bindLogin();
    var session = load(SESSION_KEY, null);
    if (session && session.key && session.name) {
      user = session;
      startApp();
    } else {
      lockApp();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* =======================================================
     7b. HERO VIDEO (all pages)
     The video sits behind the navbar + header, so its height must
     match them. We measure the header and set --hero-height in CSS.
     ======================================================= */
  function initHeroVideo() {
    var wrap = $('.hero-video');
    var hero = $('.site-header.hero');
    if (!wrap || !hero) return;

    function sizeHero() {
      wrap.style.setProperty('--hero-height', (hero.offsetTop + hero.offsetHeight) + 'px');
    }
    sizeHero();
    window.addEventListener('resize', sizeHero);
    if (window.ResizeObserver) new ResizeObserver(sizeHero).observe(hero);

    var video = $('video', wrap);
    if (!video) return;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      video.pause();                       // people who prefer less motion just see the poster picture
      video.removeAttribute('autoplay');
    } else {
      var playing = video.play();          // the page was hidden behind the log-in, so start it now
      if (playing && playing.catch) playing.catch(function () { /* autoplay blocked: poster stays */ });
    }
  }

  /* =======================================================
     8. DASHBOARD PAGE  (index.html)
     ======================================================= */
  var dashboardBound = false;

  function initDashboard() {
    if (!dashboardBound) {
      dashboardBound = true;
      initProfilePic();      // NEW: profile picture
      initQuickForm();
      var feed = $('#transaction-feed');
      if (feed) feed.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action="delete"]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        // NEW: delete modal + snackbar
        confirmDelete('Delete this transaction? This action cannot be undone.', function () {
          removeTransaction(id);
          renderDashboard();
          showSnackbar('Transaction deleted.');
        });
      });
    }
    renderDashboard();
  }

  function renderDashboard() {
    var ym = monthOf(todayISO());
    var balance = sumAmounts(receivedIncome()) - sumAmounts(allExpenses());   // Total Balance = Income - Expenses
    var monthSpent = sumAmounts(expensesInMonth(ym));
    var monthIncome = sumAmounts(receivedInMonth(ym));
    var budget = budgetTotal();
    var remaining = budget - monthSpent;
    var daysLeft = daysLeftThisMonth();
    var perDay = Math.max(remaining, 0) / daysLeft;

    var total = $('#total-money');
    if (total) {
      total.textContent = peso(balance);
      total.classList.toggle('is-negative', balance < 0);
    }
    setText('#monthly-expenses', peso(monthSpent));
    setText('#monthly-income', peso(monthIncome));
    setText('#allowance-left', peso(remaining));
    setText('#daily-allowance', remaining > 0
      ? 'About ' + peso(perDay) + ' per day for the next ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's')
      : 'No budget left for this month');

    // Circle shows how much of this month's budget is still available
    var circle = $('.circle-progress');
    if (circle) {
      var share = budget > 0 ? Math.max(0, Math.min(100, remaining / budget * 100)) : 0;
      circle.style.setProperty('--progress', share.toFixed(1));
      circle.classList.toggle('is-warning', budget > 0 && share <= 20 && remaining > 0);
      circle.classList.toggle('is-limit', remaining <= 0);
    }

    renderDashboardAlerts(balance, spentByCategory(ym));
    renderBudgetProgress(spentByCategory(ym));
    renderFeed();
    renderProfilePic();           // NEW: profile picture
    renderDashboardChart();       // NEW: Google Chart
  }

  function renderDashboardAlerts(balance, spent) {
    var list = $('#dashboard-alerts');
    if (!list) return;
    var items = [];

    if (!data.transactions.length) {
      items.push({ cls: 'alert', text: 'Welcome! Add your first income or expense below to get started.' });
    } else if (balance < LOW_BALANCE) {
      items.push({ cls: 'alert alert--warning', text: 'Low balance: you only have ' + peso(balance) + ' left. Spend carefully!' });
    }

    EXPENSE_CATEGORIES.forEach(function (c) {
      var state = budgetState(spent[c.key], data.budgets[c.key]);
      if (state.key === 'limit' && spent[c.key] > 0) {
        items.push({ cls: 'alert alert--limit', text: c.label + ': ' + state.label.toLowerCase() + ' (' + peso(spent[c.key]) + ' of ' + peso(data.budgets[c.key]) + ').' });
      } else if (state.key === 'warning') {
        items.push({ cls: 'alert alert--warning', text: c.label + ' is at ' + state.pct + '% of its budget.' });
      }
    });

    if (!items.length) items.push({ cls: 'alert alert--ok', text: 'You are within budget this month. Keep it up!' });
    list.innerHTML = items.map(function (i) { return '<li class="' + i.cls + '">' + escapeHtml(i.text) + '</li>'; }).join('');
  }

  function renderBudgetProgress(spent) {
    var list = $('#budget-progress-list');
    if (!list) return;
    list.innerHTML = EXPENSE_CATEGORIES.map(function (c) {
      var state = budgetState(spent[c.key], data.budgets[c.key]);
      return '<li><div class="budget-row-top"><strong>' + escapeHtml(c.label) + '</strong>' +
        '<span>' + peso(spent[c.key]) + ' of ' + peso(data.budgets[c.key]) + '</span></div>' +
        '<progress class="budget-progress is-' + state.key + '" max="100" value="' + Math.min(100, state.pct) +
        '" aria-label="' + escapeHtml(c.label) + ' budget used">' + state.pct + '%</progress></li>';
    }).join('');
  }

  function renderFeed() {
    var feed = $('#transaction-feed');
    if (!feed) return;
    var recent = sortNewestFirst(data.transactions.filter(function (t) {
      return t.type === 'expense' || t.status === 'received';
    })).slice(0, 8);

    if (!recent.length) {
      feed.innerHTML = '<li class="empty-state">No transactions yet. Use the form to add one.</li>';
      return;
    }
    feed.innerHTML = recent.map(function (t) {
      var isIncome = t.type === 'income';
      var catLabel = labelOf(isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES, t.category);
      var title = t.description || catLabel;
      return '<li class="transaction-item">' +
        '<span class="transaction-icon transaction-icon--' + t.type + '" aria-hidden="true">' + (isIncome ? '+' : MINUS) + '</span>' +
        '<div><p class="transaction-title">' + escapeHtml(title) + '</p>' +
        '<p class="transaction-meta">' + escapeHtml(catLabel) + ' &middot; ' + formatDate(t.date) + '</p></div>' +
        '<p class="transaction-amount ' + (isIncome ? 'amount--income' : 'amount--expense') + '">' +
        (isIncome ? '+' : MINUS) + peso(t.amount) + '</p>' +
        '<button type="button" class="button button--delete button--small" data-action="delete" data-id="' + t.id +
        '" aria-label="Delete ' + escapeHtml(title) + '">Delete</button></li>';
    }).join('');
  }

  /* =======================================================
     NEW F. PROFILE PICTURE (dashboard)
     Each user can pick a photo from their device. It is shrunk to a small
     square (so it fits in localStorage) and saved with that user's data.
     ======================================================= */
  function initials(name) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  }

  function renderProfilePic() {
    var img = $('#profile-pic-img');
    var letters = $('#profile-pic-initials');
    var remove = $('#profile-pic-remove');
    if (!img || !letters) return;
    var has = !!data.avatar;
    if (has) img.src = data.avatar; else img.removeAttribute('src');
    img.hidden = !has;
    letters.hidden = has;
    letters.textContent = initials(user.name);
    if (remove) remove.hidden = !has;
  }

  // Crop the picture to a centered square and shrink it to 256 x 256
  function shrinkImage(file, done, fail) {
    var reader = new FileReader();
    reader.onerror = fail;
    reader.onload = function () {
      var image = new Image();
      image.onerror = fail;
      image.onload = function () {
        var size = 256;
        var side = Math.min(image.width, image.height);
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
        done(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function initProfilePic() {
    var button = $('#profile-pic-button');
    var input = $('#profile-pic-input');
    var remove = $('#profile-pic-remove');
    if (!button || !input) return;

    button.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';                                   // lets the same file be chosen again later
      if (!file) return;
      if (file.type.indexOf('image/') !== 0) return showSnackbar('Please choose an image file.', true);
      if (file.size > 10 * 1024 * 1024) return showSnackbar('That picture is too big. Choose one under 10 MB.', true);
      shrinkImage(file, function (url) {
        data.avatar = url;
        persist();
        renderProfilePic();
        showSnackbar('Profile picture updated.');
      }, function () { showSnackbar('Sorry, that picture could not be opened.', true); });
    });
    if (remove) remove.addEventListener('click', function () {
      confirmDelete('Remove your profile picture? This action cannot be undone.', function () {
        data.avatar = '';
        persist();
        renderProfilePic();
        showSnackbar('Profile picture removed.');
      });
    });
  }

  // NEW: Google column chart - income vs expenses for the last 6 months
  function renderDashboardChart() {
    var rows = [];
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      rows.push([MONTH_NAMES[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear(), sumAmounts(receivedInMonth(ym)), sumAmounts(expensesInMonth(ym))]);
    }
    drawChart($('#income-expense-chart'), {
      type: 'ColumnChart',
      header: ['Month', 'Income', 'Expenses'],
      rows: rows,
      colors: ['income', 'expense'],
      height: 320,
      empty: 'Add some income or expenses to see this chart.',
      summary: 'Column chart of income and expenses for the last 6 months'
    });
  }

  function initQuickForm() {
    var form = $('#quick-form');
    if (!form) return;
    var categorySelect = $('#quick-category');
    var dateInput = $('#quick-date');

    function currentType() { return form.elements.quick_type.value; }
    function syncCategories() {
      fillSelect(categorySelect, currentType() === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES, 'Select a category');
    }
    syncCategories();
    dateInput.value = todayISO();

    $$('input[name="quick_type"]', form).forEach(function (radio) { radio.addEventListener('change', syncCategories); });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var type = currentType();
      var amount = parseAmount($('#quick-amount').value);
      var category = categorySelect.value;
      var date = dateInput.value || todayISO();
      var note = $('#quick-note').value.trim();

      if (!category) return showFeedback(form, 'Please choose a category.', true);
      if (!(amount > 0)) return showFeedback(form, 'Enter an amount greater than zero.', true);

      var categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      var tx = { type: type, category: category, amount: amount, date: date, description: note || labelOf(categories, category), note: note };
      if (type === 'income') {
        tx.frequency = 'one-time';
        tx.receivedDate = date;
        tx.expectedDate = '';
        tx.status = 'received';
      } else {
        tx.payment = 'cash';
      }
      addTransaction(tx);
      form.reset();
      syncCategories();
      dateInput.value = todayISO();
      showFeedback(form, (type === 'income' ? 'Income' : 'Expense') + ' of ' + peso(amount) + ' saved.', false);
      renderDashboard();
    });
  }

  /* =======================================================
     9. EXPENSES PAGE  (pages/expenses.html)
     ======================================================= */
  function initExpenses() {
    var monthSel = $('#expenses-month');
    var yearSel = $('#expenses-year');
    var form = $('#expense-form');
    var budgetForm = $('#budget-form');
    var filterForm = $('.filter-bar');
    var editingId = null;
    var filters = { search: '', category: 'all' };

    var now = new Date();
    ensureYearOption(yearSel, now.getFullYear());
    monthSel.value = String(now.getMonth() + 1);
    yearSel.value = String(now.getFullYear());
    $('#expense-date').value = todayISO();

    function selectedMonth() { return yearSel.value + '-' + pad(Number(monthSel.value)); }
    function render() {
      var ym = selectedMonth();
      renderExpenseSummary(ym);
      renderCategoryCards(ym);
      renderExpenseAlerts(ym);
      renderExpenseChart(ym);
      renderExpenseTable(ym, filters);
    }
    function fillBudgetInputs() {
      EXPENSE_CATEGORIES.forEach(function (c) {
        var input = $('#set-' + c.key);
        if (input) input.value = data.budgets[c.key].toFixed(2);
      });
    }
    function resetFormState() {
      editingId = null;
      $('button[type="submit"]', form).textContent = 'Add Expense';
      $('#expense-date').value = todayISO();
    }

    fillBudgetInputs();
    render();

    // month selector
    $('.period-selector').addEventListener('submit', function (e) { e.preventDefault(); render(); });
    monthSel.addEventListener('change', render);
    yearSel.addEventListener('change', render);

    // add / edit expense
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var amount = parseAmount($('#expense-amount').value);
      if (!(amount > 0)) return showFeedback(form, 'Enter an amount greater than zero.', true);

      var fields = {
        type: 'expense',
        description: $('#expense-description').value.trim(),
        category: $('#expense-category').value,
        amount: amount,
        date: $('#expense-date').value || todayISO(),
        payment: $('#expense-payment').value,
        note: $('#expense-notes').value.trim()
      };
      if (!fields.description) return showFeedback(form, 'Please say what you bought.', true);

      if (editingId) {
        Object.assign(findTransaction(editingId), fields);
        persist();
        showFeedback(form, 'Expense updated.', false);
      } else {
        addTransaction(fields);
        showFeedback(form, 'Expense of ' + peso(amount) + ' added.', false);
      }
      // jump to the month of the saved expense so it is visible in the table
      ensureYearOption(yearSel, Number(fields.date.slice(0, 4)));
      yearSel.value = fields.date.slice(0, 4);
      monthSel.value = String(Number(fields.date.slice(5, 7)));
      form.reset();
      resetFormState();
      render();
    });
    form.addEventListener('reset', function () { setTimeout(resetFormState, 0); });

    // edit / delete buttons inside the table
    $('.expenses-table tbody').addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var tx = findTransaction(id);
      if (!tx) return;

      if (btn.getAttribute('data-action') === 'delete') {
        // NEW: delete modal + snackbar
        confirmDelete('Delete "' + tx.description + '"? This action cannot be undone.', function () {
          removeTransaction(id);
          if (editingId === id) { form.reset(); resetFormState(); }
          render();
          showSnackbar('Expense deleted.');
        });
      } else {
        editingId = id;
        $('#expense-description').value = tx.description;
        $('#expense-category').value = tx.category;
        $('#expense-amount').value = tx.amount;
        $('#expense-date').value = tx.date;
        $('#expense-payment').value = tx.payment || 'cash';
        $('#expense-notes').value = tx.note || '';
        $('button[type="submit"]', form).textContent = 'Save Changes';
        scrollToSection('#add-expense', '#expense-description');
      }
    });

    // search and category filter
    function applyFilters() {
      filters.search = $('#filter-search').value.trim().toLowerCase();
      filters.category = $('#filter-category').value;
      renderExpenseTable(selectedMonth(), filters);
    }
    filterForm.addEventListener('submit', function (e) { e.preventDefault(); applyFilters(); });
    filterForm.addEventListener('input', applyFilters);
    filterForm.addEventListener('reset', function () { setTimeout(applyFilters, 0); });

    // budgets
    budgetForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var updated = {};
      for (var i = 0; i < EXPENSE_CATEGORIES.length; i++) {
        var c = EXPENSE_CATEGORIES[i];
        var value = parseAmount($('#set-' + c.key).value);
        if (!(value >= 0)) return showFeedback(budgetForm, 'Budget for ' + c.label + ' must be zero or more.', true);
        updated[c.key] = value;
      }
      data.budgets = updated;
      persist();
      render();
      showFeedback(budgetForm, 'Budgets saved.', false);
    });
    budgetForm.addEventListener('reset', function () { setTimeout(fillBudgetInputs, 0); });
  }

  function renderExpenseSummary(ym) {
    var spent = sumAmounts(expensesInMonth(ym));
    var budget = budgetTotal();
    var remaining = budget - spent;
    var pct = budget > 0 ? Math.round(spent / budget * 100) : 0;

    setText('#summary-budget', peso(budget));
    setText('#summary-spent', peso(spent));
    var remainingEl = $('#summary-remaining');
    remainingEl.textContent = peso(remaining);
    remainingEl.classList.toggle('is-negative', remaining < 0);
    setText('.summary-card--remaining .card-note', pct + '% of your budget is used');

    if (ym === monthOf(todayISO())) {
      var days = daysLeftThisMonth();
      setText('#summary-daily', peso(Math.max(remaining, 0) / days));
      setText('.summary-card--daily .card-note', 'For the ' + days + ' day' + (days === 1 ? '' : 's') + ' left this month');
    } else {
      setText('#summary-daily', '\u2014');
      setText('.summary-card--daily .card-note', 'Shown for the current month only');
    }
  }

  function renderCategoryCards(ym) {
    var spent = spentByCategory(ym);
    EXPENSE_CATEGORIES.forEach(function (c) {
      var budget = data.budgets[c.key];
      var state = budgetState(spent[c.key], budget);
      setText('#' + c.key + '-budget', peso(budget));
      setText('#' + c.key + '-spend', peso(spent[c.key]));
      var remainingEl = $('#' + c.key + '-remaining');
      if (remainingEl) {
        remainingEl.textContent = peso(budget - spent[c.key]);
        remainingEl.classList.toggle('is-negative', budget - spent[c.key] < 0);
      }
      var bar = $('#progress-' + c.key);
      if (bar) {
        bar.value = Math.min(100, state.pct);
        bar.textContent = state.pct + '%';
        bar.className = 'budget-progress is-' + state.key;
      }
      var status = $('.category-card--' + c.key + ' .card-status');
      if (status) {
        status.className = 'card-status card-status--' + state.key;
        status.textContent = state.pct + '% used \u00B7 ' + state.label;
      }
    });
  }

  function renderExpenseAlerts(ym) {
    var list = $('#spending-alerts .alert-list');
    if (!list) return;
    var spent = spentByCategory(ym);
    var items = [];
    EXPENSE_CATEGORIES.forEach(function (c) {
      var state = budgetState(spent[c.key], data.budgets[c.key]);
      var left = data.budgets[c.key] - spent[c.key];
      if (state.key === 'limit' && spent[c.key] > 0) {
        items.push({ cls: 'alert alert--limit', text: c.label + ': ' + state.label.toLowerCase() + (left < 0 ? ' by ' + peso(-left) : '') + '.' });
      } else if (state.key === 'warning') {
        items.push({ cls: 'alert alert--warning', text: c.label + ' is at ' + state.pct + '% of its budget. Only ' + peso(left) + ' left.' });
      }
    });
    if (!items.length) items.push({ cls: 'alert alert--ok', text: 'All categories are within budget for ' + monthLabel(ym) + '.' });
    list.innerHTML = items.map(function (i) { return '<li class="' + i.cls + '">' + escapeHtml(i.text) + '</li>'; }).join('');
  }

  function renderExpenseChart(ym) {
    var spent = spentByCategory(ym);
    var items = EXPENSE_CATEGORIES.map(function (c) { return { label: c.label, value: spent[c.key] }; })
      .filter(function (i) { return i.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    // NEW: Google pie chart (spending by category) and bar chart (budget vs spent)
    drawChart($('#spending-chart .chart-box'), {
      type: 'PieChart',
      header: ['Category', 'Spent'],
      rows: items.map(function (i) { return [i.label, i.value]; }),
      items: items,
      height: 340,
      options: { pieHole: 0.45 },
      empty: 'No expenses recorded for this month yet.',
      summary: 'Pie chart of spending by category for ' + monthLabel(ym)
    });
    drawChart($('#budget-vs-spent-chart'), {
      type: 'BarChart',
      header: ['Category', 'Budget', 'Spent'],
      rows: EXPENSE_CATEGORIES.map(function (c) { return [c.label, data.budgets[c.key], spent[c.key]]; }),
      colors: ['budget', 'spent'],
      height: 460,
      empty: 'Set your monthly budgets below to see this chart.',
      summary: 'Bar chart of budget and amount spent for ' + monthLabel(ym)
    });
  }

  function renderExpenseTable(ym, filters) {
    var rows = sortNewestFirst(expensesInMonth(ym)).filter(function (t) {
      if (filters.category !== 'all' && t.category !== filters.category) return false;
      if (filters.search) {
        var hay = ((t.description || '') + ' ' + (t.note || '')).toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
    var tbody = $('.expenses-table tbody');
    setText('.expenses-table caption', 'Expense records for ' + monthLabel(ym) + ' (' + rows.length + ' record' + (rows.length === 1 ? '' : 's') + ')');

    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No expenses to show for this month.</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function (t, i) {
        var title = escapeHtml(t.description);
        return '<tr>' +
          '<td class="col-number">' + (i + 1) + '</td>' +
          '<td><time datetime="' + t.date + '">' + formatDate(t.date) + '</time></td>' +
          '<th scope="row">' + title + '</th>' +
          '<td>' + escapeHtml(labelOf(EXPENSE_CATEGORIES, t.category)) + '</td>' +
          '<td>' + escapeHtml(PAYMENT_LABELS[t.payment] || t.payment || '') + '</td>' +
          '<td class="col-amount amount--expense">' + MINUS + peso(t.amount) + '</td>' +
          '<td>' + (t.note ? escapeHtml(t.note) : '<span class="empty-cell">\u2014</span>') + '</td>' +
          '<td class="col-actions">' +
          '<button type="button" class="button button--edit" data-action="edit" data-id="' + t.id + '" aria-label="Edit ' + title + '">Edit</button>' +
          '<button type="button" class="button button--delete" data-action="delete" data-id="' + t.id + '" aria-label="Delete ' + title + '">Delete</button>' +
          '</td></tr>';
      }).join('');
    }
    setText('.expenses-table tfoot .amount--expense', MINUS + peso(sumAmounts(rows)));
    setText('.expenses-table tfoot th', rows.length === 1 ? 'Total of listed record' : 'Total of listed records');
  }

  /* =======================================================
     10. INCOME PAGE  (pages/income.html)
     ======================================================= */
  function initIncome() {
    var form = $('#income-form');
    var weekInput = $('#weekly-select');
    var monthSel = $('#monthly-month');
    var yearSel = $('#monthly-year');
    var editingId = null;

    var now = new Date();
    weekInput.value = isoWeekValue(now);
    ensureYearOption(yearSel, now.getFullYear());
    monthSel.value = String(now.getMonth() + 1);
    yearSel.value = String(now.getFullYear());

    function render() {
      renderIncomeCards();
      renderIncomeTable();
      renderIncomeWeekly(weekInput.value);
      renderIncomeMonthly(yearSel.value + '-' + pad(Number(monthSel.value)));
      renderIncomeOverview();
      renderNotes();
    }
    function resetFormState() {
      editingId = null;
      $('button[type="submit"]', form).textContent = 'Add Income';
    }
    render();

    // week and month viewers
    $('#weekly-income .period-selector').addEventListener('submit', function (e) { e.preventDefault(); render(); });
    $('#monthly-income .period-selector').addEventListener('submit', function (e) { e.preventDefault(); render(); });
    [weekInput, monthSel, yearSel].forEach(function (el) { el.addEventListener('change', render); });

    // add / edit income
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var amount = parseAmount($('#income-amount').value);
      if (!(amount > 0)) return showFeedback(form, 'Enter an amount greater than zero.', true);

      var status = $('#income-status').value;
      var received = $('#date-received').value;
      var expected = $('#expected-date').value;

      if (status === 'received') {
        received = received || expected || todayISO();
      } else {
        if (!expected) return showFeedback(form, 'Please add an expected date for money you have not received yet.', true);
        received = '';
      }
      var fields = {
        type: 'income',
        description: $('#income-source').value.trim(),
        category: $('#income-category').value,
        frequency: $('#income-frequency').value,
        amount: amount,
        receivedDate: received,
        expectedDate: expected,
        status: status,
        note: $('#income-notes').value.trim(),
        date: status === 'received' ? received : expected
      };
      if (!fields.description) return showFeedback(form, 'Please enter the income source.', true);

      if (editingId) {
        Object.assign(findTransaction(editingId), fields);
        persist();
        showFeedback(form, 'Income updated.', false);
      } else {
        addTransaction(fields);
        showFeedback(form, 'Income of ' + peso(amount) + ' added.', false);
      }
      form.reset();
      resetFormState();
      render();
    });
    form.addEventListener('reset', function () { setTimeout(resetFormState, 0); });

    // edit / delete buttons inside the table
    $('.income-table tbody').addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var tx = findTransaction(id);
      if (!tx) return;

      if (btn.getAttribute('data-action') === 'delete') {
        // NEW: delete modal + snackbar
        confirmDelete('Delete "' + tx.description + '"? This action cannot be undone.', function () {
          removeTransaction(id);
          if (editingId === id) { form.reset(); resetFormState(); }
          render();
          showSnackbar('Income record deleted.');
        });
      } else {
        editingId = id;
        $('#income-source').value = tx.description;
        $('#income-category').value = tx.category;
        $('#income-frequency').value = tx.frequency || 'one-time';
        $('#income-amount').value = tx.amount;
        $('#date-received').value = tx.receivedDate || '';
        $('#expected-date').value = tx.expectedDate || '';
        $('#income-status').value = tx.status;
        $('#income-notes').value = tx.note || '';
        $('button[type="submit"]', form).textContent = 'Save Changes';
        scrollToSection('#add-income', '#income-source');
      }
    });

    // reminder notes
    $('.notes-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var field = $('#reminder-note');
      var text = field.value.trim();
      if (!text) return;
      data.notes.unshift({ id: uid(), text: text });
      persist();
      field.value = '';
      renderNotes();
      showSnackbar('Reminder saved.');          // NEW
    });
    $('.notes-list').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-action="delete-note"]');
      if (!btn) return;
      var noteId = btn.getAttribute('data-id');
      // NEW: delete modal + snackbar
      confirmDelete('Delete this reminder? This action cannot be undone.', function () {
        data.notes = data.notes.filter(function (n) { return n.id !== noteId; });
        persist();
        renderNotes();
        showSnackbar('Reminder deleted.');
      });
    });
  }

  function renderIncomeCards() {
    var ym = monthOf(todayISO());
    var week = weekRange(isoWeekValue(new Date()));
    var monthTotal = sumAmounts(receivedInMonth(ym));
    var weeklyAllowance = sumAmounts(receivedIncome().filter(function (t) {
      return t.category === 'allowance' && inRange(t.date, week);
    }));
    var pending = pendingIncome();

    setText('.summary-card--total .card-value', peso(monthTotal));
    setText('.summary-card--weekly .card-value', peso(weeklyAllowance));
    setText('.summary-card--monthly .card-value', peso(monthTotal));
    setText('.summary-card--expected .card-value', peso(sumAmounts(pending)));
    setText('.summary-card--expected .card-note', pending.length
      ? pending.length + ' payment' + (pending.length === 1 ? '' : 's') + ' still coming in'
      : 'Nothing pending');
  }

  function renderIncomeTable() {
    var tbody = $('.income-table tbody');
    var rows = sortNewestFirst(allIncome());
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No income recorded yet. Add your first one below.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (t, i) {
      var status = effectiveStatus(t);
      var title = escapeHtml(t.description);
      return '<tr>' +
        '<td class="col-number">' + (i + 1) + '</td>' +
        '<th scope="row">' + title + '</th>' +
        '<td>' + escapeHtml(labelOf(INCOME_CATEGORIES, t.category)) + '</td>' +
        '<td>' + escapeHtml(FREQUENCY_LABELS[t.frequency] || t.frequency || '') + '</td>' +
        '<td>' + (t.receivedDate ? '<time datetime="' + t.receivedDate + '">' + formatDate(t.receivedDate) + '</time>' : '<span class="empty-cell">\u2014</span>') + '</td>' +
        '<td>' + (t.expectedDate ? '<time datetime="' + t.expectedDate + '">' + formatDate(t.expectedDate) + '</time>' : '<span class="empty-cell">\u2014</span>') + '</td>' +
        '<td class="col-amount">' + peso(t.amount) + '</td>' +
        '<td><span class="status status--' + status + '">' + STATUS_LABELS[status] + '</span></td>' +
        '<td>' + (t.note ? escapeHtml(t.note) : '<span class="empty-cell">\u2014</span>') + '</td>' +
        '<td class="col-actions">' +
        '<button type="button" class="button button--edit" data-action="edit" data-id="' + t.id + '" aria-label="Edit ' + title + '">Edit</button>' +
        '<button type="button" class="button button--delete" data-action="delete" data-id="' + t.id + '" aria-label="Delete ' + title + '">Delete</button>' +
        '</td></tr>';
    }).join('');
  }

  function breakdownHtml(received) {
    return INCOME_CATEGORIES.map(function (c) {
      var total = sumAmounts(received.filter(function (t) { return t.category === c.key; }));
      return '<li><span class="breakdown-name">' + escapeHtml(c.label) + '</span> <span class="breakdown-amount">' + peso(total) + '</span></li>';
    }).join('');
  }

  function renderIncomeWeekly(weekValue) {
    var range = weekRange(weekValue);
    var section = $('#weekly-income');
    var totals = $$('.period-total', section);
    if (!range) return;

    var received = receivedIncome().filter(function (t) { return inRange(t.date, range); });
    var expected = pendingIncome().filter(function (t) { return inRange(t.expectedDate, range); });

    setText('.card-value', peso(sumAmounts(received)), totals[0]);
    setText('.card-note', formatShort(range.start) + ' \u2013 ' + formatDate(range.end), totals[0]);
    setText('.card-value', peso(sumAmounts(expected)), totals[1]);
    setText('.card-note', expected.length + ' payment' + (expected.length === 1 ? '' : 's') + ' expected this week', totals[1]);
    $('.breakdown-list', section).innerHTML = breakdownHtml(received);
  }

  function renderIncomeMonthly(ym) {
    var section = $('#monthly-income');
    var totals = $$('.period-total', section);
    var received = receivedInMonth(ym);
    var expected = pendingIncome().filter(function (t) { return monthOf(t.expectedDate) === ym; });

    setText('.card-value', peso(sumAmounts(received)), totals[0]);
    setText('.card-note', monthLabel(ym), totals[0]);
    setText('.card-value', peso(sumAmounts(expected)), totals[1]);
    setText('.card-note', expected.length + ' payment' + (expected.length === 1 ? '' : 's') + ' not yet received', totals[1]);
    $('.breakdown-list', section).innerHTML = breakdownHtml(received);

    var items = INCOME_CATEGORIES.map(function (c) {
      return { label: c.label, value: sumAmounts(received.filter(function (t) { return t.category === c.key; })) };
    }).filter(function (i) { return i.value > 0; });
    // NEW: Google column chart (income by source)
    drawChart($('.chart-box', section), {
      type: 'ColumnChart',
      header: ['Source', 'Received'],
      rows: items.map(function (i) { return [i.label, i.value]; }),
      items: items,
      colors: ['bar'],
      height: 300,
      empty: 'No income received in ' + monthLabel(ym) + ' yet.',
      summary: 'Column chart of income by source for ' + monthLabel(ym)
    });
  }

  function renderIncomeOverview() {
    var items = [];
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      items.push({ label: MONTH_NAMES[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear(), value: sumAmounts(receivedInMonth(ym)) });
    }
    // NEW: Google line chart (income over time)
    drawChart($('#income-overview-chart .chart-box'), {
      type: 'LineChart',
      header: ['Month', 'Income received'],
      rows: items.map(function (i) { return [i.label, i.value]; }),
      items: items,
      colors: ['line'],
      height: 320,
      options: { pointSize: 6, lineWidth: 3, vAxis: { minValue: 0 } },
      empty: 'No income received in the last 6 months yet.',
      summary: 'Line chart of income received in the last 6 months'
    });
  }

  function renderNotes() {
    var list = $('.notes-list');
    if (!data.notes.length) {
      list.innerHTML = '<li>No reminders yet. Add one above.</li>';
      return;
    }
    list.innerHTML = data.notes.map(function (n) {
      return '<li><span>' + escapeHtml(n.text) + '</span>' +
        '<button type="button" class="button button--delete button--small" data-action="delete-note" data-id="' + n.id + '">Delete</button></li>';
    }).join('');
  }

  /* =======================================================
     11. SAVINGS PAGE  (pages/saving.html)
     ======================================================= */
  // A goal's balance = starting amount + deposits - withdrawals
  function goalSaved(goal, log) {
    var entries = (log || data.savingsLog).filter(function (l) { return l.goalId === goal.id; });
    var deposits = sumAmounts(entries.filter(function (l) { return l.type === 'deposit'; }));
    var withdrawals = sumAmounts(entries.filter(function (l) { return l.type === 'withdrawal'; }));
    return Number(goal.initial || 0) + deposits - withdrawals;
  }
  function findGoal(id) {
    for (var i = 0; i < data.goals.length; i++) if (data.goals[i].id === id) return data.goals[i];
    return null;
  }

  function initSaving() {
    var txForm = $('#transaction-form');
    var goalForm = $('#create-goal-form');
    var goalSelect = $('#transaction-goal');
    var editingGoalId = null;

    $('#transaction-date').value = todayISO();
    renderSaving();

    function resetGoalForm() {
      editingGoalId = null;
      $('button[type="submit"]', goalForm).textContent = 'Create Goal';
    }

    // add / withdraw money
    txForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var type = txForm.elements.transaction_type.value;     // "deposit" or "withdrawal"
      var goal = findGoal(goalSelect.value);
      var amount = parseAmount($('#transaction-amount').value);

      if (!goal) return showFeedback(txForm, 'Please choose a savings goal.', true);
      if (!(amount > 0)) return showFeedback(txForm, 'Enter an amount greater than zero.', true);

      var balance = goalSaved(goal);
      if (type === 'withdrawal' && amount > balance) {
        return showFeedback(txForm, 'You can only withdraw up to ' + peso(balance) + ' from ' + goal.name + '.', true);
      }
      data.savingsLog.push({
        id: uid(), goalId: goal.id, type: type, amount: amount,
        date: $('#transaction-date').value || todayISO(),
        note: $('#transaction-note').value.trim(), createdAt: Date.now()
      });
      persist();
      txForm.reset();
      $('#transaction-date').value = todayISO();
      showFeedback(txForm, (type === 'deposit' ? 'Added ' : 'Withdrew ') + peso(amount) + (type === 'deposit' ? ' to ' : ' from ') + goal.name + '.', false);
      renderSaving();
    });
    txForm.addEventListener('reset', function () { setTimeout(function () { $('#transaction-date').value = todayISO(); }, 0); });

    // create / edit goal
    goalForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var target = parseAmount($('#goal-target').value);
      var initial = parseAmount($('#goal-initial').value || '0');
      if (!(target > 0)) return showFeedback(goalForm, 'Target amount must be greater than zero.', true);
      if (!(initial >= 0)) return showFeedback(goalForm, 'Initial savings cannot be negative.', true);

      var fields = {
        name: $('#goal-name').value.trim(),
        category: $('#goal-category').value,
        target: target,
        initial: initial,
        targetDate: $('#goal-date').value,
        description: $('#goal-description').value.trim()
      };
      if (!fields.name) return showFeedback(goalForm, 'Please name your goal.', true);

      if (editingGoalId) {
        Object.assign(findGoal(editingGoalId), fields);
        showFeedback(goalForm, 'Goal updated.', false);
      } else {
        fields.id = uid();
        data.goals.push(fields);
        showFeedback(goalForm, 'Goal "' + fields.name + '" created.', false);
      }
      persist();
      goalForm.reset();
      resetGoalForm();
      renderSaving();
    });
    goalForm.addEventListener('reset', function () { setTimeout(resetGoalForm, 0); });

    $('#add-new-goal-button').addEventListener('click', function () { scrollToSection('#create-goal', '#goal-name'); });

    // buttons on each goal card
    $('.goal-grid').addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-action]');
      if (!btn) return;
      var goal = findGoal(btn.getAttribute('data-goal-id'));
      if (!goal) return;
      var action = btn.getAttribute('data-action');

      if (action === 'add' || action === 'withdraw') {
        $(action === 'add' ? '#type-add' : '#type-withdraw').checked = true;
        goalSelect.value = goal.id;
        scrollToSection('#manage-savings', '#transaction-amount');
      } else if (action === 'edit') {
        editingGoalId = goal.id;
        $('#goal-name').value = goal.name;
        $('#goal-category').value = goal.category || '';
        $('#goal-target').value = goal.target;
        $('#goal-initial').value = goal.initial || 0;
        $('#goal-date').value = goal.targetDate || '';
        $('#goal-description').value = goal.description || '';
        $('button[type="submit"]', goalForm).textContent = 'Save Goal';
        scrollToSection('#create-goal', '#goal-name');
      } else if (action === 'delete') {
        // NEW: delete modal + snackbar
        confirmDelete('Delete "' + goal.name + '" and its savings history? This action cannot be undone.', function () {
          data.goals = data.goals.filter(function (g) { return g.id !== goal.id; });
          data.savingsLog = data.savingsLog.filter(function (l) { return l.goalId !== goal.id; });
          persist();
          renderSaving();
          showSnackbar('Goal "' + goal.name + '" deleted.');
        });
      }
    });

    // delete a history entry (blocked if it would make a balance negative)
    $('.savings-table tbody').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-action="delete"]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var entry = data.savingsLog.filter(function (l) { return l.id === id; })[0];
      if (!entry) return;
      var goal = findGoal(entry.goalId);
      var remaining = data.savingsLog.filter(function (l) { return l.id !== id; });
      if (goal && goalSaved(goal, remaining) < 0) {
        // NEW: shown as a snackbar instead of a browser alert
        showSnackbar('This entry cannot be deleted because ' + goal.name + ' would end up with a negative balance.', true);
        return;
      }
      // NEW: delete modal + snackbar
      confirmDelete('Delete this savings entry? This action cannot be undone.', function () {
        data.savingsLog = remaining;
        persist();
        renderSaving();
        showSnackbar('Savings entry deleted.');
      });
    });
  }

  function renderSaving() {
    var ym = monthOf(todayISO());
    var monthLog = data.savingsLog.filter(function (l) { return monthOf(l.date) === ym; });
    var savedThisMonth = sumAmounts(monthLog.filter(function (l) { return l.type === 'deposit'; }));
    var withdrawnThisMonth = sumAmounts(monthLog.filter(function (l) { return l.type === 'withdrawal'; }));
    var monthIncome = sumAmounts(receivedInMonth(ym));
    var totalSavings = data.goals.reduce(function (t, g) { return t + goalSaved(g); }, 0);

    // summary cards
    setText('.summary-card--total .card-value', peso(totalSavings));
    setText('.summary-card--saved .card-value', peso(savedThisMonth));
    setText('.summary-card--withdrawn .card-value', peso(withdrawnThisMonth));
    setText('.summary-card--rate .card-value', monthIncome > 0 ? Math.round(savedThisMonth / monthIncome * 100) + '%' : '0%');
    setText('.summary-card--rate .card-note', monthIncome > 0
      ? 'Share of this month\'s income added to savings'
      : 'Add income this month to see your saving rate');

    // goal select (keep the current choice if possible)
    var select = $('#transaction-goal');
    var previous = select.value;
    fillSelect(select, data.goals.map(function (g) { return { key: g.id, label: g.name }; }), 'Choose a goal');
    if (previous && findGoal(previous)) select.value = previous;

    renderGoalCards();
    renderSavingsChart();         // NEW: Google Chart
    renderSavingsHistory();
    renderQuests();
  }

  // NEW: Google stacked bar chart - saved vs remaining for every goal
  function renderSavingsChart() {
    var rows = data.goals.map(function (g) {
      var saved = Math.max(goalSaved(g), 0);
      return [g.name, saved, Math.max(g.target - saved, 0)];
    });
    drawChart($('#savings-chart'), {
      type: 'BarChart',
      header: ['Goal', 'Saved', 'Remaining'],
      rows: rows,
      colors: ['saved', 'remaining'],
      height: Math.max(240, 120 + rows.length * 55),
      options: { isStacked: true },
      empty: 'Create a savings goal to see this chart.',
      summary: 'Stacked bar chart of saved and remaining money for each savings goal'
    });
  }

  function renderGoalCards() {
    var grid = $('.goal-grid');
    if (!data.goals.length) {
      grid.innerHTML = '<p class="empty-state">No goals yet. Create your first savings goal below.</p>';
      return;
    }
    grid.innerHTML = data.goals.map(function (g) {
      var saved = goalSaved(g);
      var pct = g.target > 0 ? Math.min(100, Math.round(saved / g.target * 100)) : 0;
      var remaining = Math.max(g.target - saved, 0);
      var name = escapeHtml(g.name);
      return '<article class="goal-card" id="goal-' + g.id + '" data-goal-id="' + g.id + '">' +
        '<h3 class="goal-name">' + name + '</h3>' +
        '<p class="goal-description">' + escapeHtml(g.description || '') +
        (g.targetDate ? ' <small>Target date: ' + formatDate(g.targetDate) + '</small>' : '') + '</p>' +
        '<dl class="goal-stats">' +
        '<div class="goal-stat"><dt>Target</dt><dd>' + peso(g.target) + '</dd></div>' +
        '<div class="goal-stat"><dt>Saved</dt><dd>' + peso(saved) + '</dd></div>' +
        '<div class="goal-stat"><dt>Remaining</dt><dd>' + peso(remaining) + '</dd></div>' +
        '<div class="goal-stat"><dt>Completed</dt><dd>' + pct + '%</dd></div></dl>' +
        '<label for="progress-' + g.id + '" class="visually-hidden">' + name + ' progress</label>' +
        '<progress id="progress-' + g.id + '" class="goal-progress" max="100" value="' + pct + '">' + pct + '%</progress>' +
        '<div class="goal-actions">' +
        '<button type="button" class="button button--add" data-action="add" data-goal-id="' + g.id + '">Add Money</button>' +
        '<button type="button" class="button button--withdraw" data-action="withdraw" data-goal-id="' + g.id + '">Withdraw Money</button>' +
        '<button type="button" class="button button--edit" data-action="edit" data-goal-id="' + g.id + '">Edit Goal</button>' +
        '<button type="button" class="button button--delete" data-action="delete" data-goal-id="' + g.id + '">Delete Goal</button>' +
        '</div></article>';
    }).join('');
  }

  function renderSavingsHistory() {
    var tbody = $('.savings-table tbody');
    var rows = sortNewestFirst(data.savingsLog);
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No savings activity yet. Add money to a goal to get started.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (l, i) {
      var goal = findGoal(l.goalId);
      var isDeposit = l.type === 'deposit';
      return '<tr class="row--' + l.type + '">' +
        '<td class="col-number">' + (i + 1) + '</td>' +
        '<td><time datetime="' + l.date + '">' + formatDate(l.date) + '</time></td>' +
        '<th scope="row">' + escapeHtml(goal ? goal.name : 'Deleted goal') + '</th>' +
        '<td><span class="type-badge type-badge--' + l.type + '">' + (isDeposit ? 'Deposit' : 'Withdrawal') + '</span></td>' +
        '<td class="col-amount amount--' + l.type + '">' + (isDeposit ? '+' : MINUS) + peso(l.amount) + '</td>' +
        '<td>' + (l.note ? escapeHtml(l.note) : '<span class="empty-cell">\u2014</span>') + '</td>' +
        '<td class="col-actions"><button type="button" class="button button--delete" data-action="delete" data-id="' + l.id +
        '" aria-label="Delete savings entry ' + (i + 1) + '">Delete</button></td></tr>';
    }).join('');
  }

  // Quest badges unlock based on your best goal
  function renderQuests() {
    var best = data.goals.reduce(function (max, g) {
      return g.target > 0 ? Math.max(max, Math.min(100, goalSaved(g) / g.target * 100)) : max;
    }, 0);
    $$('.quest-badge').forEach(function (badge, i) {
      var unlocked = best >= [25, 50, 75, 100][i];
      badge.classList.toggle('quest-badge--unlocked', unlocked);
      badge.classList.toggle('quest-badge--locked', !unlocked);
      setText('.quest-status', unlocked ? 'Unlocked' : 'Locked', badge);
    });
    setText('.quests-section .section-intro', 'Reach each milestone on a goal to unlock a badge. Your best goal is at ' + Math.floor(best) + '%.');
  }
})();
