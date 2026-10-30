/* The grid tabs of the Kino mockups (AUG-1452): Hjem, Stasera, GitHub and Home Assistant. ES5.
   Each returns HTML; tiles carry data-goto (a tab) or data-toast (what OK would do). */
var Panes = function (D, NOW, DEPLOYS) {
  var S = D.stats, G = D.github;
  var TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());

  function hours(min) { return Math.round(min / 60); }
  function mins(m) { return (m.episodeMinutes || 0) + (m.movieMinutes || 0); }
  function ym(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function iso(d) { return ym(d) + '-' + ('0' + d.getDate()).slice(-2); }
  function attrs(o) {
    var s = '';
    for (var k in o) if (o[k]) s += ' data-' + k + '="' + K.esc(o[k]) + '"';
    return s;
  }
  function tile(w, html, opt) {
    opt = opt || {};
    return '<div class="tile ' + (opt.cls || '') + '" style="width:' + w + 'px;' + (opt.style || '') + '"' +
      attrs({ goto: opt.goto, toast: opt.toast }) + '>' + html + '<div class="card-ring"></div></div>';
  }
  function row(tiles) { return '<div class="grid-row">' + tiles.join('') + '</div>'; }
  function barList(rows, max, fmt, accent) {
    return '<div class="bars">' + rows.map(function (r, i) {
      return '<div class="b"><em>' + K.esc(r.label) + '</em><strong>' + fmt(r.value) + '</strong><u></u><i class="' +
        (accent(r, i) ? 'is-accent' : '') + '" style="transform:scaleX(' + (r.value / max).toFixed(3) + ')"></i></div>';
    }).join('') + '</div>';
  }
  function progressRows(list) {
    return '<div class="prog">' + list.map(function (c) {
      return '<div class="p"><em>' + K.esc(c.title) + '</em><span>' + c.watched + ' av ' + c.total + '</span>' +
        '<div class="progress"><i style="transform:scaleX(' + (c.watched / c.total).toFixed(3) + ')"></i></div></div>';
    }).join('') + '</div>';
  }

  // ── Shared numbers ─────────────────────────────────────────
  var byMonth = {};
  S.byMonth.forEach(function (m) { byMonth[m.month] = mins(m); });
  var months = [];
  for (var mi = 11; mi >= 0; mi--) {
    var md = new Date(NOW.getFullYear(), NOW.getMonth() - mi, 1);
    months.push({ label: K.MONTHS[md.getMonth()].replace('.', '').slice(0, 3), min: byMonth[ym(md)] || 0 });
  }
  var thisMonth = months[11].min;
  var monthName = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober',
    'november', 'desember'][NOW.getMonth()];

  // Commits per day, the last 26 weeks, Monday first.
  var weeks = 26, heatStart = new Date(TODAY);
  heatStart.setDate(TODAY.getDate() - ((TODAY.getDay() + 6) % 7) - (weeks - 1) * 7);
  var counts = [];
  for (var di = 0; di < weeks * 7; di++) {
    var dday = new Date(heatStart);
    dday.setDate(heatStart.getDate() + di);
    if (dday <= TODAY) counts.push(G.days[iso(dday)] || 0);
  }
  var last30 = 0, streak = 0, ci;
  for (ci = counts.length - 1; ci >= Math.max(0, counts.length - 30); ci--) last30 += counts[ci];
  for (ci = counts.length - 1; ci >= 0 && counts[ci] > 0; ci--) streak++;
  var failed = DEPLOYS.filter(function (d) { return d.state === 'ERROR'; });

  function isNew(c) {
    if (!c.airDate) return false;
    var days = Math.round((TODAY - K.parseDate(c.airDate)) / 86400000);
    return days >= 0 && days <= 14;
  }

  // ── Hjem: a little of everything ───────────────────────────
  function home() {
    var hour = new Date().getHours();
    var greeting = hour < 5 ? 'God natt' : hour < 10 ? 'God morgen' : hour < 18 ? 'God dag' : 'God kveld';
    var c = D.watching.filter(function (w) { return w.app && D.apps.indexOf(w.app) >= 0 && w.hero; })[0];
    var feature = tile(1040,
      '<div class="feat-img" style="background-image:url(' + c.hero + ')"></div><div class="feat-shade"></div>' +
      '<div class="feat-text"><div class="kicker">Fortsett å se</div>' +
      (c.logo ? '<img class="feat-logo" src="' + c.logo + '">' : '<div class="feat-title">' + K.esc(c.title) + '</div>') +
      '<div class="meta">' + K.ep(c) + (c.episodeName ? ' «' + K.esc(c.episodeName) + '»' : '') +
      '<span class="sep">·</span>' + K.esc(c.app) + '</div>' +
      '<div class="prog-line"><div class="progress"><i style="transform:scaleX(' + (c.watched / c.total).toFixed(3) + ')"></i></div>' +
      '<span>' + K.plural(c.remaining, 'episode', 'episoder') + ' igjen</span></div></div>',
      { cls: 'tile--feature', style: 'height:440px', toast: 'Åpner ' + c.title + ' ' + K.ep(c) + ' i ' + c.app });

    var fresh = D.watching.filter(isNew).sort(function (a, b) { return a.airDate < b.airDate ? 1 : -1; });
    var next = D.upcoming.filter(function (u) { return u.date > iso(TODAY); })[0];
    var news = fresh.slice(0, 2).map(function (n) {
      return '<div class="li"><span class="r">' + K.day(n.airDate, NOW) + '</span>' + K.esc(n.title) +
        ' <span class="dim">' + K.ep(n) + '</span></div>';
    });
    if (next) {
      news.push('<div class="li"><span class="r">' + K.day(next.date, NOW) + '</span>' + K.esc(next.title) +
        ' <span class="dim">S' + next.season + ' E' + next.episode + ' kommer</span></div>');
    }
    var episodes = tile(632, '<div class="label">Nye episoder</div><div class="list tight">' + news.slice(0, 3).join('') + '</div>',
      { style: 'height:208px', goto: 'tv' });

    var v = D.youtube[0];
    var yt = tile(632, '<div class="yt-thumb" style="background-image:url(' + v.thumb + ')"></div>' +
      '<div class="yt-text"><div class="label">YouTube</div><div class="yt-t">' + K.esc(v.title) + '</div>' +
      '<div class="sub">' + K.esc(v.channel) + ' · ' + K.ago(Date.parse(v.published), NOW.getTime()) + '</div></div>',
      { style: 'height:208px', goto: 'tv' });

    var small = [
      tile(406, '<div class="label">Stasera</div><div class="mini-num">' + hours(thisMonth) + '<small>t i ' + monthName + '</small></div>' +
        '<div class="sub">' + K.plural(D.watching.length, 'serie', 'serier') + ' på gang</div>', { style: 'height:210px', goto: 'stasera' }),
      tile(406, '<div class="label">GitHub</div><div class="mini-num">' + K.num(last30) + '<small>commits, 30 dager</small></div>' +
        '<div class="sub">' + (failed.length ? '<span class="st-err">✕ ' + K.plural(failed.length, 'deploy', 'deploys') + ' feilet</span>' :
        '<span class="st-ok">✓ Alle deploys klare</span>') + '</div>', { style: 'height:210px', goto: 'github' }),
      tile(406, '<div class="label">Home Assistant</div><div class="sub" style="margin-top:18px;font-size:23px;line-height:32px">' +
        'Lys, strøm og varsler.<br>Kommer når HA er klart.</div>', { cls: 'is-later', style: 'height:210px', goto: 'ha' }),
      tile(406, '<div class="label">Apper</div><div class="mini-num">' + D.apps.length + '<small>apper</small></div>' +
        '<div class="sub">' + D.apps.slice(3, 7).join(', ') + ' …</div>', { style: 'height:210px', goto: 'tv' })
    ];

    return '<div class="greet"><h1>' + greeting + '</h1><div class="sub">' +
      K.longDate(new Date()).replace(/^./, function (s) { return s.toUpperCase(); }) +
      '<span class="sep">·</span>Oslo 7°, skyet</div></div>' +
      '<div class="home-grid"><div class="hg-left">' + feature + '</div><div class="hg-right">' + episodes + yt + '</div>' +
      '<div class="hg-bottom">' + small.join('') + '</div></div>';
  }

  // ── Stasera ────────────────────────────────────────────────
  function stasera() {
    var max = Math.max.apply(null, months.map(function (m) { return m.min; }));
    var year = 0;
    S.byYear.forEach(function (y) { if (+y.year === NOW.getFullYear()) year = mins(y); });
    var cols = '<div class="cols"><div class="base"></div>' + months.map(function (m, i) {
      var h = Math.round(m.min / max * 64);
      return '<div class="col' + (i === 11 ? ' is-now' : '') + '" style="width:46px"><i style="height:' + h + 'px"></i>' +
        (i === 11 ? '<b style="bottom:' + (h + 28) + 'px">' + hours(m.min) + ' t</b>' : '') + '<span>' + m.label + '</span></div>';
    }).join('') + '</div>';
    var time = tile(620, '<div class="label">Tid sett</div><div class="hero-num">' + hours(thisMonth) + '<small>t i ' + monthName + '</small></div>' +
      '<div class="sub">' + hours(year) + ' t i år · ' + K.num(hours(S.totalRuntimeMinutes)) + ' t totalt, ' +
      K.num(S.totalEpisodes) + ' episoder og ' + S.totalMovies + ' filmer</div>' + cols);

    var top = S.topShows.slice(0, 5);
    var shows = tile(520, '<div class="label">Mest sett</div>' +
      barList(top.map(function (t) { return { label: t.title, value: t.minutes }; }), top[0].minutes,
        function (v) { return hours(v) + ' t'; }, function (r, i) { return i === 0; }) +
      '<div class="foot">Etter tid, alt du har sett</div>');

    var done = S.completions.filter(function (c) { return new Date(c.at).getFullYear() === NOW.getFullYear(); }).reverse();
    var series = tile(508, '<div class="label">Fullført i år</div><div class="stat-row"><div class="stat"><b>' + done.length + '</b><span>serier</span></div>' +
      '<div class="stat"><b>' + K.num(S.backlog.episodes) + '</b><span>episoder igjen i ' + S.backlog.shows + ' serier</span></div></div>' +
      '<div class="list">' + done.slice(0, 3).map(function (c) {
        return '<div class="li"><span class="r">' + K.day(c.at, NOW) + '</span>' + K.esc(c.name) + '</div>';
      }).join('') + '</div>');

    var progress = tile(380, '<div class="label">Framdrift</div>' + progressRows(D.watching.slice(0, 4)));

    var hc = S.hourCounts || [];
    var hmax = Math.max.apply(null, hc.concat([1]));
    var peak = hc.indexOf(hmax);
    var hcols = '<div class="cols" style="height:110px"><div class="base"></div>' + hc.map(function (n, h) {
      return '<div class="col' + (h === peak ? ' is-now' : '') + '" style="width:18px"><i style="height:' + Math.round(n / hmax * 76) + 'px"></i>' +
        (h % 6 === 0 ? '<span>' + ('0' + h).slice(-2) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
    var habits = tile(500, '<div class="label">Vaner</div><div class="stat-row"><div class="stat"><b>' + S.longestStreakDays + ' dager</b><span>lengste streak</span></div>' +
      '<div class="stat"><b>kl. ' + peak + '</b><span>ser du oftest</span></div></div>' + hcols +
      '<div class="foot">Klokkeslett fra ' + hc.reduce(function (a, b) { return a + b; }, 0) + ' registreringer med tid</div>');

    var nets = S.topNetworks.slice(0, 5);
    var services = tile(372, '<div class="label">Per kanal</div>' +
      barList(nets.map(function (n) { return { label: n.network, value: n.episodes }; }), nets[0].episodes,
        function (v) { return K.num(v); }, function () { return false; }) + '<div class="foot">Episoder</div>');

    // Stasera has no comparison data for the TV yet, and the only friend is the test account.
    var friends = [{ label: 'Marte', value: 1320 }, { label: 'Du', value: thisMonth }, { label: 'Jonas', value: 540 }];
    var friendsTile = tile(372, '<div class="label">Venner<span class="tag">eksempel</span></div>' +
      barList(friends, friends[0].value, function (v) { return hours(v) + ' t'; }, function (r) { return r.label === 'Du'; }) +
      '<div class="sub" style="margin-top:14px">Felles: Forræder, The Bear</div>');

    return '<div class="pane-note">Statistikken er fra ' + K.day(S.computedAt || D.generatedAt, NOW) + '</div>' +
      '<div class="grid">' + row([time, shows, series]) + row([progress, habits, services, friendsTile]) + '</div>';
  }

  // ── GitHub ─────────────────────────────────────────────────
  function github() {
    var cells = '', monthMarks = '', lastMonth = -1, lastMark = -1, n = 0;
    for (var w = 0; w < weeks; w++) {
      cells += '<div class="wk">';
      for (var dd = 0; dd < 7; dd++) {
        var d = new Date(heatStart);
        d.setDate(heatStart.getDate() + w * 7 + dd);
        if (dd === 0 && d.getMonth() !== lastMonth && (lastMark < 0 || w - lastMark >= 3)) {
          lastMonth = d.getMonth();
          lastMark = w;
          monthMarks += '<span style="left:' + (w * 24) + 'px">' + K.MONTHS[d.getMonth()] + '</span>';
        }
        if (d > TODAY) { cells += '<div class="d" style="opacity:0"></div>'; continue; }
        var c = counts[n++];
        cells += '<div class="d ' + (c === 0 ? '' : c < 10 ? 'l1' : c < 40 ? 'l2' : c < 100 ? 'l3' : 'l4') + '"></div>';
      }
      cells += '</div>';
    }
    var repos = G.repos.slice().sort(function (a, b) { return b.commits - a.commits; }).filter(function (r) { return r.commits; }).slice(0, 5);
    var activity = tile(1100, '<div class="label">Aktivitet</div><div class="stat-row"><div class="stat"><b>' + K.num(last30) + '</b><span>commits siste 30 dager</span></div>' +
      '<div class="stat"><b>' + streak + ' dager</b><span>på rad med commits</span></div></div>' +
      '<div class="months">' + monthMarks + '</div><div class="heat">' + cells + '</div>' +
      '<div class="per-repo"><div class="label">Per repo, et halvt år</div>' +
      barList(repos.map(function (r) { return { label: r.name, value: r.commits }; }), repos[0].commits,
        function (v) { return K.num(v); }, function (r, i) { return i === 0; }) + '</div>');

    var state = {
      READY: '<span class="st st-ok">✓ Klar</span>', ERROR: '<span class="st st-err">✕ Feilet</span>',
      CANCELED: '<span class="st st-off">– Avbrutt</span>'
    };
    var deploys = tile(572, '<div class="label">Deploy</div><div class="list">' + DEPLOYS.slice(0, 5).map(function (dp) {
      return '<div class="li"><span class="r">' + K.ago(dp.at, NOW.getTime()) + '</span>' + state[dp.state] + K.esc(dp.project) +
        ' <span class="dim">· ' + dp.target + '</span></div>';
    }).join('') + '<div class="li"><span class="st st-off">– Lokalt</span>GitHub Actions <span class="dim">· kjører ikke</span></div></div>');

    var list = G.repos.filter(function (r) { return r.last; }).slice(0, 6).map(function (r) {
      return '<div class="li"><span class="r">' + K.day(r.last.day, NOW) + '</span>' + K.esc(r.name) + '<small>' + K.esc(r.last.message) + '</small></div>';
    });
    var projects = tile(1696, '<div class="label">Prosjekter</div><div class="two"><div class="list">' + list.slice(0, 3).join('') +
      '</div><div class="list">' + list.slice(3, 6).join('') + '</div></div>', { style: 'height:300px' });
    return '<div class="grid">' + row([activity, deploys]) + row([projects]) + '</div>';
  }

  // ── Home Assistant: what AUG-1437 plans, not built yet ─────
  function ha() {
    var plans = [
      ['Huset', 'Lysscener og gardiner', 'Kveldslys på'],
      ['Strøm', 'Pris nå fra Tibber, nettleie fra Elvia', '1,12 kr/kWh'],
      ['Vask og tørk', 'Sier fra når maskinene er ferdige', 'Ferdig om 24 min'],
      ['Varsler', 'Ringeklokka med stillbilde, og det HA sender', 'Ingen nå'],
      ['Gjestenett', 'QR-kode når gjestemodus er på', 'Av'],
      ['Tesla', 'Lading og rekkevidde', '78 % · 312 km']
    ];
    var tiles = plans.map(function (p) {
      return tile(549, '<div class="label">' + p[0] + '<span class="tag">kommer</span></div><div class="ha-val">' + p[2] +
        '</div><div class="sub">' + p[1] + '</div>', { cls: 'is-later', toast: p[0] + ' kommer når HA-modulen er klar (AUG-1437)' });
    });
    return '<div class="pane-note">Eksempler på det HA-modulen kan vise (AUG-1437)</div>' +
      '<div class="grid">' + row(tiles.slice(0, 3)) + row(tiles.slice(3)) + '</div>';
  }

  return { home: home, stasera: stasera, github: github, ha: ha };
};

/* Moves focus among tiles by direction: the nearest tile that lies that way, weighing straight lines over
   diagonals. */
function spatialMove(tiles, cur, dir) {
  if (cur < 0) return 0;
  var a = tiles[cur].getBoundingClientRect(), best = -1, bestScore = 1e9;
  for (var i = 0; i < tiles.length; i++) {
    if (i === cur) continue;
    var b = tiles[i].getBoundingClientRect(), main, side;
    if (dir === 'right') { if (b.left < a.right - 4) continue; main = b.left - a.right; side = Math.abs((b.top + b.bottom) - (a.top + a.bottom)) / 2; }
    if (dir === 'left') { if (b.right > a.left + 4) continue; main = a.left - b.right; side = Math.abs((b.top + b.bottom) - (a.top + a.bottom)) / 2; }
    if (dir === 'down') { if (b.top < a.bottom - 4) continue; main = b.top - a.bottom; side = Math.abs((b.left + b.right) - (a.left + a.right)) / 2; }
    if (dir === 'up') { if (b.bottom > a.top + 4) continue; main = a.top - b.bottom; side = Math.abs((b.left + b.right) - (a.left + a.right)) / 2; }
    var score = main + side * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}
