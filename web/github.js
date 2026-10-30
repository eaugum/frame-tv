/*
 * GitHub on the home screen (AUG-1448): the commits of the last half year across our own repos, the latest commit of
 * the most recently pushed ones, the languages they're written in, and the latest deploys on Vercel. Two modules:
 * github (github_token) and vercel (vercel_token); each brings its own half of the tab, so either works alone
 * (AUG-1474). The last good answer stays in localStorage, so the tab draws at once and asks again every
 * half hour. An error keeps the last answer; a 401 says the token isn't valid.
 * A repo GitHub hasn't pushed to since the last answer isn't asked about again, so a refresh is mostly one call; the
 * languages are asked about once a day per repo.
 * In a desktop browser without a token it shows made-up sample data, so the tab can be previewed.
 */
var GitHub = (function () {
  'use strict';

  var TOKEN = Modules.on('github') ? Settings.get('githubToken').replace(/^\s+|\s+$/g, '') : '';
  var VERCEL = Modules.on('vercel') ? Settings.get('vercelToken').replace(/^\s+|\s+$/g, '') : '';
  var TEAM = Settings.get('vercelTeam').replace(/^\s+|\s+$/g, '');
  var HIDE = Settings.get('githubHide').map(function (s) { return s.toLowerCase(); });
  var ON = Modules.on('github') || Modules.on('vercel');
  var SAMPLE = ON && !TOKEN && !VERCEL && TV.name === 'browser';
  var CACHE = 'fmtv.github';
  var EVERY = 30 * 60000, RETRY = 20000, RETRIES = 4;
  var REPOS = 8, PROJECTS = 6, WEEKS = 26, DAY = 86400000, LANGUAGES = 5;

  // repos: [{name, full, pushedAt, weeks: [{w: unix s (Sunday, UTC), d: [7, Sunday first]}] | null,
  //          last: {message, at} | null, activityFor, lastFor: the pushedAt they were read at,
  //          langs: {language: bytes} | null, langsAt: when they were read}]
  // deploys: [{project, production, state, at}] | null
  var data = {repos: [], deploys: null, at: 0};
  var problem = '', vercelProblem = '';

  /** A short fingerprint of the tokens, so a new token doesn't show the old one's cache. */
  function stamp() {
    var s = TOKEN + '|' + VERCEL + '|' + TEAM + '|' + HIDE.join(','), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return String(h);
  }

  try {
    var c = JSON.parse(localStorage.getItem(CACHE));
    if ((TOKEN || VERCEL) && c && c.stamp === stamp() && c.data) data = c.data;
    // A repo without its languages (a cache from before AUG-1474) asks again at once.
    for (var r = 0; r < data.repos.length; r++) if (!data.repos[r].langsAt) data.at = 0;
  } catch (e) {}

  function save() { try { localStorage.setItem(CACHE, JSON.stringify({stamp: stamp(), data: data})); } catch (e) {} }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  /** GET a JSON document; done(status, json). Status 0: no connection. */
  function get(url, headers, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', url, true);
    x.timeout = 15000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var json = null;
      try { json = JSON.parse(x.responseText); } catch (e) {}
      done(x.status, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(0, null); } };
    x.send(null);
  }

  function gh(path, done) {
    get('https://api.github.com' + path, {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + TOKEN}, done);
  }

  function isList(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  /** Our own repos worth showing: no forks, nothing archived or hidden, pushed in the last half year, newest first. */
  function pickRepos(list, now) {
    var out = [];
    for (var i = 0; i < list.length && out.length < REPOS; i++) {
      var r = list[i];
      if (!r || r.fork || r.archived || HIDE.indexOf(String(r.name).toLowerCase()) >= 0) continue;
      if (!(Date.parse(r.pushed_at || '') >= now - WEEKS * 7 * DAY)) continue;
      out.push(r);
    }
    out.sort(function (a, b) { return Date.parse(b.pushed_at) - Date.parse(a.pushed_at); });
    return out;
  }

  // MARK: - Asking

  var busy = false, failedAt = 0, retryTimer = 0, retries = 0;

  /** commit_activity for one repo; done(true) when GitHub had it, done(false) while it's still counting (202). */
  function readActivity(r, done) {
    gh('/repos/' + r.full + '/stats/commit_activity', function (status, json) {
      if (status === 200 && isList(json)) {
        r.weeks = json.slice(-(WEEKS + 1)).map(function (w) { return {w: w.week, d: w.days}; });
        r.activityFor = r.pushedAt;
      } else if (status === 204) {
        r.weeks = [];   // an empty repo
        r.activityFor = r.pushedAt;
      }
      done(status !== 202);
    });
  }

  function readLast(r, done) {
    gh('/repos/' + r.full + '/commits?per_page=1', function (status, json) {
      if (status === 200 && isList(json) && json[0] && json[0].commit) {
        var cm = json[0].commit, who = cm.committer || cm.author || {};
        r.last = {message: String(cm.message || '').split('\n')[0], at: Date.parse(who.date || '') || 0};
        r.lastFor = r.pushedAt;
      } else if (status === 409) {
        r.last = null;   // no commits yet
        r.lastFor = r.pushedAt;
      }
      done();
    });
  }

  /** The languages of one repo in bytes, as GitHub's linguist counts them. */
  function readLanguages(r, done) {
    gh('/repos/' + r.full + '/languages', function (status, json) {
      if (status === 200 && json && typeof json === 'object' && !isList(json)) r.langs = json;
      // A refusal waits a day too; only a lost connection asks again at the next refresh.
      if (status) r.langsAt = Date.now();
      done();
    });
  }

  function readDeploys(done) {
    var q = TEAM ? (/^team_/.test(TEAM) ? '&teamId=' : '&slug=') + encodeURIComponent(TEAM) : '';
    get('https://api.vercel.com/v6/deployments?limit=20' + q, {Authorization: 'Bearer ' + VERCEL}, function (status, json) {
      if (status === 401 || status === 403) vercelProblem = 'token';
      if (status !== 200 || !json || !isList(json.deployments)) { done(null); return; }
      vercelProblem = '';
      done(json.deployments.map(function (d) {
        return {project: d.name || '', production: d.target === 'production', state: d.state || d.readyState || '',
          at: d.created || d.createdAt || 0};
      }));
    });
  }

  /** Runs the jobs side by side; done() after the last one. */
  function all(jobs, done) {
    var left = jobs.length;
    if (!left) { done(); return; }
    for (var i = 0; i < jobs.length; i++) jobs[i](function () { if (--left === 0) done(); });
  }

  function refresh(force) {
    if (!ON || !(TOKEN || VERCEL) || busy) return;
    var t = Date.now();
    if (!force && t - data.at < EVERY && t >= data.at) return;
    if (!force && failedAt && t - failedAt < 5 * 60000 && t >= failedAt) return;
    busy = true;
    if (!TOKEN) {
      // Vercel alone: just the deploys.
      readDeploys(function (d) {
        data = {repos: [], deploys: d || data.deploys, at: Date.now()};
        busy = false;
        save();
        changed();
      });
      return;
    }
    gh('/user/repos?sort=pushed&per_page=30&affiliation=owner', function (status, list) {
      if (status !== 200 || !isList(list)) {
        if (status === 401) problem = 'token';
        busy = false;
        failedAt = Date.now();
        changed();
        return;
      }
      problem = '';
      var old = {}, i;
      for (i = 0; i < data.repos.length; i++) old[data.repos[i].full] = data.repos[i];
      var repos = pickRepos(list, Date.now()).map(function (r) {
        var o = old[r.full_name] || {};
        return {name: r.name, full: r.full_name, pushedAt: r.pushed_at, weeks: o.weeks || null, last: o.last || null,
          activityFor: o.activityFor || '', lastFor: o.lastFor || '', langs: o.langs || null, langsAt: o.langsAt || 0};
      });
      var now = Date.now();
      var jobs = [], pending = [], deploys = data.deploys;
      repos.forEach(function (r, n) {
        if (r.activityFor !== r.pushedAt) {
          jobs.push(function (next) { readActivity(r, function (ok) { if (!ok) pending.push(r); next(); }); });
        }
        if (n < PROJECTS && r.lastFor !== r.pushedAt) jobs.push(function (next) { readLast(r, next); });
        if (!(now - r.langsAt < DAY && now >= r.langsAt)) jobs.push(function (next) { readLanguages(r, next); });
      });
      if (VERCEL) jobs.push(function (next) { readDeploys(function (d) { if (d) deploys = d; next(); }); });
      all(jobs, function () {
        data = {repos: repos, deploys: deploys, at: Date.now()};
        busy = false;
        failedAt = 0;
        save();
        changed();
        retries = 0;
        if (pending.length) retry(pending);
      });
    });
  }

  /** GitHub counts commit_activity in the background and answers 202 meanwhile: ask again for those in a while. */
  function retry(pending) {
    clearTimeout(retryTimer);
    if (retries++ >= RETRIES) return;
    retryTimer = setTimeout(function () {
      var still = [];
      all(pending.map(function (r) {
        return function (next) { readActivity(r, function (ok) { if (!ok) still.push(r); next(); }); };
      }), function () {
        save();
        changed();
        if (still.length) retry(still);
      });
    }, RETRY);
  }

  // MARK: - Sample data for the browser preview

  function sample() {
    var now = Date.now(), seed = 7, repos = [];
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var names = ['sample-app', 'sample-web', 'sample-api', 'sample-site', 'sample-tools', 'sample-notes'];
    var msgs = ['Faster start on old TVs', 'New settings page', 'Fix the time zone on the weather card',
      'Translate the last strings', 'Clean up the build script', 'Notes from the meeting'];
    var langs = [{JavaScript: 412000, CSS: 61000, HTML: 9000, Python: 48000}, {TypeScript: 530000, CSS: 88000},
      {TypeScript: 240000, Go: 150000}, {Swift: 310000, Shell: 4000}, {Python: 96000, Shell: 12000}, {}];
    var sunday = Math.floor(now / DAY / 7) * 7 - 3;   // the Unix epoch was a Thursday
    for (var i = 0; i < names.length; i++) {
      var weeks = [];
      for (var w = WEEKS; w >= 0; w--) {
        var d = [], busyWeek = rand() < 0.75 - i * 0.1;
        for (var k = 0; k < 7; k++) d.push(busyWeek && rand() < 0.6 ? Math.floor(rand() * (40 - i * 6)) : 0);
        weeks.push({w: (sunday - w * 7) * 86400, d: d});
      }
      var at = now - i * i * 0.6 * DAY - 3 * 3600000;
      repos.push({name: names[i], full: 'sample/' + names[i], pushedAt: new Date(at).toISOString(), weeks: weeks,
        last: {message: msgs[i], at: at}, langs: langs[i]});
    }
    var deploys = [
      {project: 'sample-app', production: true, state: 'READY', at: now - 3600000},
      {project: 'sample-web', production: false, state: 'ERROR', at: now - 6 * 3600000},
      {project: 'sample-site', production: false, state: 'CANCELED', at: now - 9 * 3600000},
      {project: 'sample-web', production: true, state: 'READY', at: now - 2 * DAY},
      {project: 'sample-api', production: false, state: 'BUILDING', at: now - 2 * DAY}
    ];
    return {repos: repos, deploys: deploys, at: now};
  }

  // MARK: - The numbers

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function isoLocal(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }
  function isoUTC(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate()); }

  /**
   * What the tab and the Hjem tile show, for the day of `now`:
   *  heat: 26 weeks, Monday first, of {date (yyyy-mm-dd), n, future}; last30, streak (days in a row with commits,
   *  through yesterday when today has none yet); repos: [{name, commits}] over the half year, most first;
   *  projects: [{name, message, at}] newest first; deploys: the newest of each project and target, and failed: how
   *  many of those didn't build (both null without Vercel); problem, vercelProblem: 'token' when it was refused.
   * GitHub's days are UTC days, the heat map's are the TV's: close enough for a picture of the half year.
   */
  function summary(now) {
    var d = SAMPLE ? sample() : data, days = {}, perRepo = [], i, j, k;
    now = now || Date.now();
    var today = new Date(now);
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7 - (WEEKS - 1) * 7);
    var from = isoLocal(start);
    for (i = 0; i < d.repos.length; i++) {
      var r = d.repos[i], sum = 0;
      for (j = 0; r.weeks && j < r.weeks.length; j++) {
        for (k = 0; k < 7; k++) {
          var n = r.weeks[j].d[k] || 0, key = isoUTC((r.weeks[j].w + k * 86400) * 1000);
          if (!n || key < from) continue;
          days[key] = (days[key] || 0) + n;
          sum += n;
        }
      }
      if (r.weeks) perRepo.push({name: r.name, commits: sum});
    }
    perRepo.sort(function (a, b) { return b.commits - a.commits; });

    var heat = [], counts = [], todayIso = isoLocal(today);
    for (var w = 0; w < WEEKS; w++) {
      var col = [];
      for (k = 0; k < 7; k++) {
        var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + k), iso = isoLocal(day);
        var future = iso > todayIso;
        col.push({date: iso, n: days[iso] || 0, future: future});
        if (!future) counts.push(days[iso] || 0);
      }
      heat.push(col);
    }
    var last30 = 0, streak = 0, c;
    for (c = counts.length - 1; c >= 0 && c >= counts.length - 30; c--) last30 += counts[c];
    c = counts.length - 1;
    if (c >= 0 && !counts[c]) c--;
    for (; c >= 0 && counts[c] > 0; c--) streak++;

    var projects = [];
    for (i = 0; i < d.repos.length && projects.length < PROJECTS; i++) {
      if (d.repos[i].last) projects.push({name: d.repos[i].name, message: d.repos[i].last.message, at: d.repos[i].last.at});
    }

    projects.sort(function (a, b) { return b.at - a.at; });

    // The languages across the repos, in bytes: the biggest five, and the rest as one (null without GitHub).
    var languages = null, bytes = {}, total = 0, name;
    if (TOKEN || SAMPLE) {
      for (i = 0; i < d.repos.length; i++) {
        for (name in d.repos[i].langs || {}) {
          if (!d.repos[i].langs.hasOwnProperty(name) || !(d.repos[i].langs[name] > 0)) continue;
          bytes[name] = (bytes[name] || 0) + d.repos[i].langs[name];
          total += d.repos[i].langs[name];
        }
      }
      languages = [];
      for (name in bytes) if (bytes.hasOwnProperty(name)) languages.push({name: name, bytes: bytes[name]});
      languages.sort(function (a, b) { return b.bytes - a.bytes; });
      if (languages.length > LANGUAGES) {
        var rest = 0;
        for (i = LANGUAGES; i < languages.length; i++) rest += languages[i].bytes;
        languages = languages.slice(0, LANGUAGES).concat([{name: '', bytes: rest, other: true}]);
      }
      for (i = 0; i < languages.length; i++) languages[i].share = total ? languages[i].bytes / total : 0;
    }

    // The newest deploy of each project and target, newest first; failed: those that didn't build.
    var deploys = null, failed = null;
    if (VERCEL || SAMPLE) {
      var seen = {}, sorted = (d.deploys || []).slice().sort(function (a, b) { return b.at - a.at; });
      deploys = [];
      failed = 0;
      for (i = 0; i < sorted.length; i++) {
        var id = sorted[i].project + (sorted[i].production ? ':p' : ':v');
        if (seen[id]) continue;
        seen[id] = true;
        deploys.push(sorted[i]);
        if (sorted[i].state === 'ERROR') failed++;
      }
    }
    return {heat: heat, last30: last30, streak: streak, repos: perRepo, projects: projects, languages: languages,
      deploys: deploys, failed: failed, at: d.at, loaded: d.at > 0, sample: SAMPLE, problem: problem, vercelProblem: vercelProblem};
  }

  return {
    /** The module is on and has github_token or vercel_token (or the browser preview, with sample data). */
    enabled: function () { return ON && !!(TOKEN || VERCEL) || SAMPLE; },
    /** GitHub is set up (github_token), so there are commits and languages to show. */
    github: function () { return ON && !!TOKEN || SAMPLE; },
    /** The numbers are made up (the browser preview without a token). */
    sample: function () { return SAMPLE; },
    /** Vercel is set up (vercel_token), so there are deploys to show. */
    vercel: function () { return ON && !!VERCEL || SAMPLE; },
    onChange: function (fn) { listeners.push(fn); },
    refresh: refresh,
    summary: summary,
    // For tests: the repo filter.
    pickRepos: pickRepos
  };
})();
