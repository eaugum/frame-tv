'use strict';
// AUG-1798 (T89): the playlist called "Frame TV" shows after sign-in and follows changes at a regular refresh.
// Fake Google answers only; no token is real.
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadApp} = require('./harness');

const MIN = 60000;
const NOW = Date.UTC(2026, 10, 24, 11, 0, 0);
const CHANNEL = 'UCfakechannel0000000000';   // UULF + the part after "UC"

function video(id, title) {
  return {id, snippet: {title, channelTitle: 'Fake Channel', publishedAt: new Date(NOW - 3600000).toISOString(),
    liveBroadcastContent: 'none', thumbnails: {high: {url: 'http://img.test/' + id + '.jpg'}}},
  contentDetails: {duration: 'PT10M'}, statistics: {viewCount: '5'}};
}

/** The playlist's items as the playlistItems answer has them, last added first. */
function items(ids) {
  return {items: ids.map((id, i) => ({snippet: {publishedAt: new Date(NOW - (i + 1) * 3600000).toISOString(), resourceId: {videoId: id}}}))};
}

/** Fake Google answers; `inList` is read at each request, so a test can change the playlist between refreshes. */
function google(state) {
  return [
    {url: /oauth2\.googleapis\.com\/token/, status: 200, body: {access_token: 'FAKE-ACCESS', expires_in: 3600}},
    {url: /youtube\/v3\/subscriptions/, status: 200, body: {items: [{snippet: {title: 'Fake Channel', resourceId: {channelId: CHANNEL}}}]}},
    {url: /youtube\/v3\/playlists\?/, status: 200, body: {items: [{id: 'PLother', snippet: {title: 'Music'}}, {id: 'PLframe', snippet: {title: 'Frame TV'}}]}},
    {url: /youtube\/v3\/playlistItems.*playlistId=UULF/, status: 200, body: {items: [{contentDetails: {videoId: 'up1', videoPublishedAt: new Date(NOW - 7200000).toISOString()}}]}},
    {url: /youtube\/v3\/playlistItems.*playlistId=PLframe/, respond: () => ({status: 200, body: items(state.inList)})},
    {url: /youtube\/v3\/videos/, respond: (req) => {
      const ids = /[?&]id=([^&]*)/.exec(req.url)[1].split(',');
      return {status: 200, body: {items: ids.map((id) => video(id, 'Title of ' + id))}};
    }}
  ];
}

/** YouTube signed in with a made-up refresh token and nothing cached: what a TV has right after sign-in. */
function signedIn(state) {
  const app = loadApp({
    config: {youtube: true, youtubeClientId: 'fake-client-id', youtubeClientSecret: 'fake-client-secret'},
    storage: {'fmtv.youtube.auth': {refresh: 'FAKE-REFRESH', access: '', expires: 0, name: 'Fake'}},
    xhr: google(state)
  });
  return app;
}

const savedIds = (app) => app.json('YouTube.saved().map(function (v) { return v.id; })');
const urls = (app) => app.requests.map((r) => r.method + ' ' + r.url.replace(/[?].*$/, '') + (/playlistId=([\w]+)/.exec(r.url) ? ' [' + /playlistId=([\w]+)/.exec(r.url)[1] + ']' : ''));

test('T89: after sign-in the playlist named Frame TV shows at the first regular refresh', () => {
  const state = {inList: ['a1', 'a2']};
  const app = signedIn(state);
  app.advance(0);
  app.advance(MIN);
  assert.equal(app.eval('YouTube.playlist().id'), 'PLframe');
  assert.deepEqual(savedIds(app), ['a1', 'a2']);
  assert.ok(app.requests.some((r) => /videos\?/.test(r.url) && /a1/.test(r.url)), 'the playlist videos were asked for');
  if (process.env.AUG1798_LOG) require('node:fs').writeFileSync(process.env.AUG1798_LOG, urls(app).join('\n') + '\nsaved: ' + JSON.stringify(savedIds(app)) + '\n');
});

test('T89: a video added to or removed from the playlist shows at the next regular refresh', () => {
  const state = {inList: ['a1', 'a2']};
  const app = signedIn(state);
  app.advance(0);
  app.advance(MIN);
  assert.deepEqual(savedIds(app), ['a1', 'a2']);
  state.inList = ['a3', 'a1'];   // a3 added on the phone, a2 removed
  app.advance(31 * MIN);
  assert.deepEqual(savedIds(app), ['a3', 'a1']);
  assert.equal(app.json('JSON.parse(localStorage.getItem("fmtv.youtube")).data.savedFor'), 'PLframe', 'and it is kept for the next start');
});
