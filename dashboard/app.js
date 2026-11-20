// Token Radar (radar-2) — the dashboard's page script. No network, no framework.
//
// It reads window.RADAR (written by main.ts as data.js) and renders the board, the live-token
// view, the method, and one protocol's detail view. The URL hash carries the view, so a link opens
// exactly the screen it names:
//
//   #board                      the ranked board
//   #board&cat=RWA              the board filtered to one category
//   #board&watchlist=1          the board with watchlist rows only
//   #detail=steakhouse-financial  the board with one protocol's detail open
//   #live                       the protocols whose token already trades
//   #method                     how the implied value is calculated
//
// Everything a reader sees comes from the snapshot: no name is ever special-cased, and no value is
// fetched from anywhere. What the page cannot know it says so.

(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R || !Array.isArray(R.rows)) {
    app.innerHTML = '<div class="wrap"><p class="empty">Token Radar could not load its data.</p></div>';
    return;
  }

  var watchSet = new Set(R.watchlist_slugs || []);

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + trimNum(n / 1e9, 2) + 'B';
    if (abs >= 1e6) return '$' + trimNum(n / 1e6, 1) + 'M';
    if (abs >= 1e3) return '$' + trimNum(n / 1e3, 1) + 'K';
    return '$' + Math.round(n);
  }

  function trimNum(n, dp) {
    var s = n.toFixed(dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  function fmtFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }

  function fmtMult(m) {
    return (Math.round(m * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0') + '×';
  }

  function chainList(chains) {
    if (!chains || chains.length === 0) return '—';
    return chains.slice(0, 3).join(', ') + (chains.length > 3 ? ' +' + (chains.length - 3) : '');
  }

  /* ---------------- state ---------------- */

  var SORTS = {
    implied: { label: 'Implied value', get: function (r) { return r.implied_value_usd; }, dir: -1 },
    tvl: { label: 'TVL', get: function (r) { return r.tvl_usd; }, dir: -1 },
    growth: { label: '7d change', get: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; }, dir: -1 },
    age: { label: 'Age', get: function (r) { return r.age_days === null ? -1 : r.age_days; }, dir: -1 },
    name: { label: 'Name', get: function (r) { return r.name.toLowerCase(); }, dir: 1 },
  };

  function defaultState() {
    return { view: 'board', slug: null, q: '', cat: '', chain: '', watchlist: false, minTvl: 0, sort: 'implied', sortDir: -1 };
  }

  function parseHash() {
    var s = defaultState();
    var raw = (location.hash || '').replace(/^#/, '');
    if (!raw) return s;
    var parts = raw.split('&');
    var view = parts[0] || 'board';
    if (view === 'live' || view === 'method') { s.view = view; return s; }
    if (view.indexOf('detail=') === 0) { s.view = 'detail'; s.slug = decodeURIComponent(view.slice(7)); return s; }
    s.view = 'board';
    for (var i = 1; i < parts.length; i++) {
      var kv = parts[i].split('=');
      var k = kv[0];
      var v = kv[1] === undefined ? '' : decodeURIComponent(kv[1]);
      if (k === 'cat') s.cat = v;
      else if (k === 'chain') s.chain = v;
      else if (k === 'q') s.q = v;
      else if (k === 'watchlist') s.watchlist = v === '1';
      else if (k === 'minTvl') s.minTvl = parseInt(v, 10) || 0;
      else if (k === 'sort') s.sort = SORTS[v] ? v : 'implied';
    }
    return s;
  }

  var state = parseHash();

  function writeHash() {
    var h = '#board';
    if (state.view === 'live') h = '#live';
    else if (state.view === 'method') h = '#method';
    else if (state.view === 'detail' && state.slug) h = '#detail=' + encodeURIComponent(state.slug);
    else {
      var q = [];
      if (state.cat) q.push('cat=' + encodeURIComponent(state.cat));
      if (state.chain) q.push('chain=' + encodeURIComponent(state.chain));
      if (state.q) q.push('q=' + encodeURIComponent(state.q));
      if (state.watchlist) q.push('watchlist=1');
      if (state.minTvl) q.push('minTvl=' + state.minTvl);
      if (state.sort !== 'implied') q.push('sort=' + state.sort);
      if (q.length) h += '&' + q.join('&');
    }
    history.replaceState(null, '', h);
  }

  /* ---------------- data ---------------- */

  var rows = R.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var isWatch = function (r) { return watchSet.has(r.slug); };

  var categories = Array.from(new Set(rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
  var chains = Array.from(new Set(rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
  var totalImplied = rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watchlist && !isWatch(r)) return false;
      if (state.cat && (r.category || 'Uncategorized') !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var spec = SORTS[state.sort];
    var dir = state.sortDir;
    list.sort(function (a, b) {
      var av = spec.get(a);
      var bv = spec.get(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
    return list;
  }

  /* ---------------- rendering: chrome ---------------- */

  function headerHtml() {
    return '<header class="top">' +
      '<div class="eyebrow">DeFiLlama snapshot · ' + esc(R.as_of) + ' · ' + R.rows.length + ' ranked rows</div>' +
      '<h1>Token Radar<span class="dot">.</span></h1>' +
      '<p class="sub">The pre-token protocols of DeFi, ranked by <b>what a launch would be worth</b> — and how to farm each one before it happens. Values are this entry\u2019s model (radar-2), not a prediction: no token is promised.</p>' +
      '</header>';
  }

  function statsHtml() {
    return '<section class="stats" aria-label="Board summary">' +
      '<div class="stat"><div class="k">Watchlist</div><div class="v">' + R.watchlist_size + '</div><div class="d">protocols at or above ' + fmtUsd(R.floor_usd) + ' TVL, no token</div></div>' +
      '<div class="stat"><div class="k">Board rows</div><div class="v">' + R.board_size + '</div><div class="d">' + R.early_size + ' early finds below the floor</div></div>' +
      '<div class="stat"><div class="k">Combined implied value</div><div class="v">' + fmtUsd(totalImplied) + '</div><div class="d">sum of all ' + R.board_size + ' ranked rows</div></div>' +
      '<div class="stat"><div class="k">Live tokens set aside</div><div class="v">' + R.live_size + '</div><div class="d">already trading — shown, never ranked</div></div>' +
      '</section>';
  }

  function tabsHtml() {
    function tab(view, label) {
      var sel = (state.view === view || (view === 'board' && state.view === 'detail')) ? ' aria-selected="true"' : '';
      return '<button class="tab" data-action="tab" data-view="' + view + '"' + sel + '>' + label + '</button>';
    }
    return '<nav class="tabs" aria-label="Views">' + tab('board', 'Board') + tab('live', 'Live tokens') + tab('method', 'Method') + '</nav>';
  }

  function controlsHtml(list) {
    function opts(values, current, allLabel) {
      var h = '<option value="">' + allLabel + '</option>';
      values.forEach(function (v) {
        h += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
      });
      return h;
    }
    var tvlOpts = [[0, 'Any TVL'], [50000000, '≥ $50M'], [100000000, '≥ $100M'], [250000000, '≥ $250M'], [500000000, '≥ $500M'], [1000000000, '≥ $1B']];
    var tvlHtml = tvlOpts.map(function (o) {
      return '<option value="' + o[0] + '"' + (state.minTvl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" data-field="q" placeholder="Name, slug or category" value="' + esc(state.q) + '"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat" data-field="cat">' + opts(categories, state.cat, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" data-field="chain">' + opts(chains, state.chain, 'All chains') + '</select></div>' +
      '<div class="field"><label for="minTvl">TVL</label><select id="minTvl" data-field="minTvl">' + tvlHtml + '</select></div>' +
      '<label class="check"><input type="checkbox" data-field="watchlist"' + (state.watchlist ? ' checked' : '') + '> Watchlist only</label>' +
      '<div class="count">Showing <b>' + list.length + '</b> of ' + rows.length + ' rows · ' + rows.filter(isWatch).length + ' watchlist</div>' +
      '</div>';
  }

  function sortArrow(key) {
    if (state.sort !== key) return '';
    return ' <span class="arr">' + (state.sortDir === -1 ? '↓' : '↑') + '</span>';
  }

  function tableHtml(list) {
    if (list.length === 0) return '<div class="tablewrap"><p class="empty">No protocol matches this filter. Clear the search or widen the filters.</p></div>';
    var h = '<div class="tablewrap"><table><thead><tr>' +
      '<th class="n sortable" data-action="sort" data-sort="implied">#</th>' +
      '<th class="sortable" data-action="sort" data-sort="name">Protocol' + sortArrow('name') + '</th>' +
      '<th class="n sortable" data-action="sort" data-sort="tvl">TVL' + sortArrow('tvl') + '</th>' +
      '<th class="n sortable" data-action="sort" data-sort="growth">7d' + sortArrow('growth') + '</th>' +
      '<th class="n sortable" data-action="sort" data-sort="age">Age' + sortArrow('age') + '</th>' +
      '<th class="n sortable" data-action="sort" data-sort="implied">Implied value' + sortArrow('implied') + '</th>' +
      '</tr></thead><tbody>';
    list.forEach(function (r) {
      var g = r.change_7d;
      var gCls = g === null ? 'mut' : (g >= 0 ? 'pos' : 'neg');
      h += '<tr data-action="open" data-slug="' + esc(r.slug) + '"' + (isWatch(r) ? ' class="watch"' : '') + '>' +
        '<td class="rank n' + (r.rank <= 3 ? ' top3' : '') + '">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + (isWatch(r) ? '<span class="tag">WATCHLIST</span>' : '') +
        '<span class="slug">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorized') + ' · ' + esc(chainList(r.chains)) + '</span></span></td>' +
        '<td class="n">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="n ' + gCls + '">' + fmtPct(g) + '</td>' +
        '<td class="n">' + fmtAge(r.age_days) + '</td>' +
        '<td class="n"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function footerHtml() {
    return '<footer><p>Built from a sealed DeFiLlama snapshot (' + esc(R.as_of) + ', ' + esc(R.source) + '). ' +
      'Implied values are the radar-2 model\u2019s claim, never make.fun\u2019s and never a prediction of whether or when a token is issued.</p>' +
      '<p>\u201cRecords no token\u201d means the protocol\u2019s DeFiLlama record carries none — a protocol on this board may still have a token its record does not carry. ' +
      'Farm plans farm the protocol as it is; never pay anyone to claim for you.</p></footer>';
  }

  /* ---------------- detail view ---------------- */

  function splitStep(step) {
    var costAt = step.indexOf(' Cost: ');
    var timeAt = step.indexOf(' Time: ');
    if (costAt < 0 || timeAt < 0 || timeAt < costAt) return { text: step, cost: null, time: null };
    return {
      text: step.slice(0, costAt).replace(/\.$/, ''),
      cost: step.slice(costAt + 7, timeAt).replace(/\.$/, ''),
      time: step.slice(timeAt + 7).replace(/\.$/, ''),
    };
  }

  function multipleNote(row) {
    var cat = row.category || 'Uncategorized';
    var found = null;
    (R.multiples || []).forEach(function (m) { if (m.category === cat) found = m; });
    if (!found) return 'No tokenized protocol in this category, so the board uses the global median ' + fmtMult(R.global_multiple) + '.';
    return 'Median market-cap / TVL of ' + found.n + ' tokenized ' + cat + ' protocol' + (found.n === 1 ? '' : 's') +
      ' is ' + fmtMult(found.median) + ', shrunk toward the global median ' + fmtMult(R.global_multiple) + ' (k = ' + R.model.shrink_k + ').';
  }

  function detailHtml(slug) {
    var r = bySlug[slug];
    if (!r) return '';
    var growthPct = r.change_7d === null ? 0 : Math.min(120, Math.max(-60, r.change_7d));
    var age = r.age_days === null ? R.model.unknown_age_days : r.age_days;
    var maturity = R.model.maturity_floor + (Math.min(Math.max(age, 0), R.model.maturity_days) / R.model.maturity_days) * R.model.maturity_range;
    var steps = (r.farm_steps || []).map(function (s) {
      var p = splitStep(s);
      return '<li><div class="body">' + esc(p.text) + '.</div>' +
        '<div class="meta2">' +
        (p.cost ? '<span class="pill">Cost: <b>' + esc(p.cost) + '</b></span>' : '') +
        (p.time ? '<span class="pill">Time: <b>' + esc(p.time) + '</b></span>' : '') +
        '</div></li>';
    }).join('');
    return '<aside class="drawer" role="dialog" aria-label="' + esc(r.name) + ' detail">' +
      '<button class="close" data-action="close" aria-label="Close detail">×</button>' +
      '<div class="eyebrow">Rank #' + r.rank + (isWatch(r) ? ' · Watchlist' : '') + '</div>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">' + esc(r.category || 'Uncategorized') + ' · ' + esc(chainList(r.chains)) + ' · listed ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<div class="kv">' +
      '<div class="cell"><div class="k">Implied value</div><div class="v">' + fmtUsd(r.implied_value_usd) + '</div><div class="d">what a launch would be worth</div></div>' +
      '<div class="cell"><div class="k">TVL</div><div class="v">' + fmtUsd(r.tvl_usd) + '</div><div class="d">total value locked</div></div>' +
      '<div class="cell"><div class="k">7-day change</div><div class="v ' + (r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg')) + '">' + fmtPct(r.change_7d) + '</div><div class="d">TVL growth, 7 days</div></div>' +
      '<div class="cell"><div class="k">Age</div><div class="v">' + fmtAge(r.age_days) + '</div><div class="d">tracked with no token</div></div>' +
      '</div>' +
      '<h3>How the value is calculated</h3>' +
      '<table class="breakdown"><tbody>' +
      '<tr><td>TVL</td><td>' + fmtFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>× Category multiple (' + esc(r.category || 'Uncategorized') + ')</td><td>' + fmtMult(r.category_multiple) + '</td></tr>' +
      '<tr><td>× Growth (7d ' + fmtPct(r.change_7d) + ' → ' + growthPct.toFixed(1) + '%)</td><td>' + r.growth_multiplier.toFixed(3) + '×</td></tr>' +
      '<tr><td>× Maturity (' + fmtAge(r.age_days) + ' → ' + maturity.toFixed(3) + '×)</td><td>' + r.maturity_multiplier.toFixed(3) + '×</td></tr>' +
      '<tr class="total"><td>= Implied value</td><td>' + fmtFull(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="note">' + esc(multipleNote(r)) + '</p>' +
      '<h3>Farm plan</h3>' +
      '<p class="note"><b>No token is promised.</b> This plan farms the protocol as it is. If it ever issues a token, the steps above are the activity a snapshot would count.</p>' +
      '<ol class="steps">' + steps + '</ol>' +
      '</aside>';
  }

  /* ---------------- live view ---------------- */

  function liveHtml() {
    var h = '<div class="card"><h2>Live tokens — already trading</h2>' +
      '<p>These protocols already have a token that trades, so the board does <b>not</b> rank them. Their value is the market\u2019s own, not the model\u2019s. ' +
      'They are here so a reader can tell at a glance what is still to come from what already arrived — the top ' + R.live.length + ' by market cap.</p></div>';
    h += '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Mcap / TVL</th><th class="n">7d</th></tr></thead><tbody>';
    R.live.forEach(function (p) {
      var ratio = (p.mcap_usd !== null && p.tvl_usd > 0) ? (p.mcap_usd / p.tvl_usd) : null;
      h += '<tr>' +
        '<td><span class="name">' + esc(p.name) + '<span class="slug">' + esc(p.slug) + ' · ' + esc(p.category || 'Uncategorized') + ' · ' + esc(chainList(p.chains)) + '</span></span></td>' +
        '<td class="n">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="n">' + fmtUsd(p.mcap_usd) + '</td>' +
        '<td class="n">' + (ratio === null ? '—' : fmtMult(ratio)) + '</td>' +
        '<td class="n ' + (p.change_7d === null ? 'mut' : (p.change_7d >= 0 ? 'pos' : 'neg')) + '">' + fmtPct(p.change_7d) + '</td>' +
        '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------------- method view ---------------- */

  function methodHtml() {
    var rows = (R.multiples || []).map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="n">' + m.n + '</td><td class="n">' + fmtMult(m.median) + '</td><td class="n"><b>' + fmtMult(m.multiple) + '</b></td></tr>';
    }).join('');
    return '<div class="card"><h2>Method — radar-2</h2>' +
      '<p>One formula scores every protocol on the board. No name is ever special-cased; the multiples come from the snapshot itself.</p>' +
      '<div class="formula">implied = TVL × <span class="hl">category multiple</span> × growth × maturity\n\ncategory multiple = median market-cap / TVL of the snapshot\u2019s tokenized\n  protocols in the category, shrunk toward the global median\n  (k = ' + R.model.shrink_k + '), clamped to [' + R.model.multiple_floor.toFixed(2) + ', ' + R.model.multiple_cap.toFixed(2) + ']\ngrowth            = 1 + clamp(7d change, ' + R.model.growth_floor + '%, +' + R.model.growth_cap + '%) × ' + R.model.growth_weight + '\nmaturity          = ' + R.model.maturity_floor + ' + min(age, ' + R.model.maturity_days + ' days) / ' + R.model.maturity_days + ' × ' + R.model.maturity_range + '\n  (age unknown: ' + R.model.unknown_age_days + ' days)</div>' +
      '<h3>What the model does not do</h3>' +
      '<p>It does not predict <b>whether or when</b> a token is issued — it prices what a launch would be worth if the protocol\u2019s record stayed as it is. ' +
      'It does not hardcode any protocol: a protocol the model has never seen gets the same treatment as the rest. ' +
      'And \u201crecords no token\u201d is not \u201chas no token\u201d: a protocol on this board may still have a token its DeFiLlama record does not carry.</p>' +
      '<h3>Category multiples from this snapshot</h3>' +
      '<p>Each multiple is the median market-cap / TVL of that category\u2019s tokenized protocols, shrunk toward the global median ' + fmtMult(R.global_multiple) + '. Thin categories — one or two peers — sit close to the global median; deep ones keep their own.</p>' +
      '<table class="mini"><thead><tr><th>Category</th><th class="n">Tokenized peers</th><th class="n">Median mcap / TVL</th><th class="n">Multiple used</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h3>The snapshot</h3>' +
      '<p>Sealed DeFiLlama data, fetched ' + esc(R.as_of) + ' (' + esc(R.source) + '). ' + R.rows.length + ' protocols ranked; the watchlist floor is ' + fmtUsd(R.floor_usd) + ' TVL. ' +
      'The board covers all ' + R.watchlist_size + ' watchlist protocols plus the ' + R.early_size + ' pre-token protocols below the floor with the most TVL.</p>' +
      '<div class="note"><b>Farm plans</b> give concrete steps with a cost and a time for each protocol, derived from its category, chains, TVL and age. They farm the protocol as it is and never promise a token or an airdrop.</div>' +
      '</div>';
  }

  /* ---------------- render ---------------- */

  function render() {
    var h = '<div class="wrap">' + headerHtml() + statsHtml() + tabsHtml();
    if (state.view === 'live') {
      h += liveHtml();
    } else if (state.view === 'method') {
      h += methodHtml();
    } else {
      var list = filteredRows();
      h += controlsHtml(list) + tableHtml(list);
    }
    h += footerHtml() + '</div>';
    if (state.view === 'detail' && state.slug) h += detailHtml(state.slug);
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
    var q = document.getElementById('q');
    if (q && document.activeElement !== q) { /* keep focus where the reader left it */ }
  }

  /* ---------------- events ---------------- */

  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    if (action === 'tab') {
      state.view = t.getAttribute('data-view');
      state.slug = null;
      writeHash();
      render();
    } else if (action === 'sort') {
      var key = t.getAttribute('data-sort');
      if (state.sort === key) state.sortDir = -state.sortDir;
      else { state.sort = key; state.sortDir = key === 'name' ? 1 : -1; }
      state.view = 'board';
      writeHash();
      render();
    } else if (action === 'open') {
      state.view = 'detail';
      state.slug = t.getAttribute('data-slug');
      writeHash();
      render();
    } else if (action === 'close') {
      state.view = 'board';
      state.slug = null;
      writeHash();
      render();
    }
  });

  app.addEventListener('input', function (e) {
    var t = e.target.closest('[data-field]');
    if (!t) return;
    var field = t.getAttribute('data-field');
    if (field === 'q') { state.q = t.value; }
    writeHash();
    render();
    var q = document.getElementById('q');
    if (q && field === 'q') { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  });

  app.addEventListener('change', function (e) {
    var t = e.target.closest('[data-field]');
    if (!t) return;
    var field = t.getAttribute('data-field');
    if (field === 'cat') state.cat = t.value;
    else if (field === 'chain') state.chain = t.value;
    else if (field === 'minTvl') state.minTvl = parseInt(t.value, 10) || 0;
    else if (field === 'watchlist') state.watchlist = t.checked;
    state.view = 'board';
    writeHash();
    render();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.view === 'detail') {
      state.view = 'board';
      state.slug = null;
      writeHash();
      render();
    }
  });

  window.addEventListener('hashchange', function () {
    state = parseHash();
    render();
  });

  render();
})();
