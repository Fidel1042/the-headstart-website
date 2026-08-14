/* Headstart first-touch attribution.
   Loads synchronously BEFORE the gtag config call so that every event,
   including the automatic page_view, carries the source the visitor
   originally arrived from.

   Exposes:
     window.HS_ATTRIBUTION         - the resolved attribution object
     window.HS_ATTRIBUTION_CONFIG  - params merged into gtag("config", ...)
     window.hsTrack(name, params)  - send a GA4 event with attribution attached
*/
(function () {
  'use strict';

  // Local development must never reach the live GA4 property. Without this,
  // testing the site locally pollutes real reports with file paths like
  // "/The headstart website code base/index.html".
  var host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '' ||
      host.indexOf('192.168.') === 0 || window.location.protocol === 'file:') {
    window['ga-disable-G-SMH2KVMJT2'] = true;
  }

  var STORAGE_KEY = 'hs_attr_v1';
  var TTL_DAYS = 90;
  var TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

  // Referrer hostname -> [source, medium]. First match wins, so the AI
  // assistants must sit ABOVE the search engines: gemini.google.com would
  // otherwise be caught by the 'google.' rule and mislabelled as organic.
  var REFERRER_MAP = [
    // AI assistants and answer engines. medium 'ai' so they can be grouped
    // as one channel, which is what GEO performance actually looks like.
    ['chatgpt.com',           ['chatgpt',    'ai']],
    ['chat.openai.com',       ['chatgpt',    'ai']],
    ['perplexity.ai',         ['perplexity', 'ai']],
    ['claude.ai',             ['claude',     'ai']],
    ['gemini.google.com',     ['gemini',     'ai']],
    ['copilot.microsoft.com', ['copilot',    'ai']],
    ['bing.com/chat',         ['copilot',    'ai']],
    ['you.com',               ['you',        'ai']],
    ['poe.com',               ['poe',        'ai']],
    ['grok.com',              ['grok',       'ai']],
    ['mistral.ai',            ['mistral',    'ai']],

    ['linkedin.com',      ['linkedin',  'referral']],
    ['lnkd.in',           ['linkedin',  'referral']],
    ['instagram.com',     ['instagram', 'referral']],
    ['l.instagram.com',   ['instagram', 'referral']],
    ['facebook.com',      ['facebook',  'referral']],
    ['l.facebook.com',    ['facebook',  'referral']],
    ['whatsapp.com',      ['whatsapp',  'chat']],
    ['t.co',              ['twitter',   'referral']],
    ['x.com',             ['twitter',   'referral']],
    ['reddit.com',        ['reddit',    'referral']],
    ['youtube.com',       ['youtube',   'referral']],
    ['tiktok.com',        ['tiktok',    'referral']],
    ['google.',           ['google',    'organic']],
    ['bing.com',          ['bing',      'organic']],
    ['duckduckgo.com',    ['duckduckgo','organic']],
    ['yahoo.com',         ['yahoo',     'organic']],
    ['baidu.com',         ['baidu',     'organic']],
    ['ecosia.org',        ['ecosia',    'organic']]
  ];

  function storage() {
    try {
      var t = '__hs_t__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      return window.localStorage;
    } catch (e) {
      return null; // Safari private mode, cookies blocked, etc.
    }
  }

  // Short forms people actually type in links, mapped to one canonical name.
  // Without this, "ig" and "instagram" become two separate channels in every
  // report, which is the exact fragmentation this whole setup exists to end.
  var SOURCE_ALIASES = {
    ig: 'instagram', insta: 'instagram', instagram_bio: 'instagram',
    li: 'linkedin', 'linked-in': 'linkedin', lnkd: 'linkedin',
    fb: 'facebook', wa: 'whatsapp', yt: 'youtube', tt: 'tiktok',
    email: 'brevo', newsletter: 'brevo',
  };

  function param(name) {
    try {
      var v = new URLSearchParams(window.location.search).get(name);
      if (!v) return '';
      v = v.trim().toLowerCase().slice(0, 100);
      if (name === 'utm_source' && SOURCE_ALIASES[v]) return SOURCE_ALIASES[v];
      return v;
    } catch (e) {
      return '';
    }
  }

  function classifyReferrer() {
    var ref = document.referrer || '';
    if (!ref) return ['direct', 'none'];

    var host;
    try {
      host = new URL(ref).hostname.toLowerCase();
    } catch (e) {
      return ['direct', 'none'];
    }

    if (host === window.location.hostname) return null; // internal navigation

    for (var i = 0; i < REFERRER_MAP.length; i++) {
      if (host.indexOf(REFERRER_MAP[i][0]) !== -1) return REFERRER_MAP[i][1];
    }
    return [host, 'referral'];
  }

  // Work out what this particular arrival looks like.
  // Returns null when there is nothing new to record (internal navigation).
  function currentTouch() {
    var utmSource = param('utm_source');
    if (utmSource) {
      return {
        source: utmSource,
        medium: param('utm_medium') || 'unknown',
        campaign: param('utm_campaign') || 'none',
        content: param('utm_content') || 'none',
        landing: window.location.pathname,
        ts: Date.now()
      };
    }

    var ref = classifyReferrer();
    if (!ref) return null;

    return {
      source: ref[0],
      medium: ref[1],
      campaign: 'none',
      content: 'none',
      landing: window.location.pathname,
      ts: Date.now()
    };
  }

  function read(store) {
    if (!store) return null;
    try {
      var raw = store.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.first || !data.first.ts) return null;
      if (Date.now() - data.first.ts > TTL_MS) return null; // expired, start fresh
      return data;
    } catch (e) {
      return null;
    }
  }

  function write(store, data) {
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* quota or blocked, run in-memory only */ }
  }

  var store = storage();
  var saved = read(store);
  var touch = currentTouch();

  if (!saved) {
    // No usable record. Seed from this arrival, or mark as direct.
    var seed = touch || {
      source: 'direct', medium: 'none', campaign: 'none',
      content: 'none', landing: window.location.pathname, ts: Date.now()
    };
    saved = { first: seed, last: seed };
    write(store, saved);
  } else if (touch) {
    // Known visitor arriving from somewhere new. First touch is never overwritten.
    saved.last = touch;
    write(store, saved);
  }

  var first = saved.first;
  var last = saved.last;
  var daysSinceFirst = Math.floor((Date.now() - first.ts) / 86400000);

  var attribution = {
    first_source: first.source,
    first_medium: first.medium,
    first_campaign: first.campaign,
    first_content: first.content,
    first_landing_page: first.landing,
    last_source: last.source,
    last_medium: last.medium,
    last_campaign: last.campaign,
    days_since_first_touch: daysSinceFirst,
    is_returning: daysSinceFirst > 0 ? 'yes' : 'no'
  };

  window.HS_ATTRIBUTION = attribution;

  // Merged into gtag("config", ...) so these ride along on every event,
  // including the automatic page_view.
  window.HS_ATTRIBUTION_CONFIG = (function () {
    var out = {};
    for (var k in attribution) {
      if (Object.prototype.hasOwnProperty.call(attribution, k)) out[k] = attribution[k];
    }
    // User-scoped copy so GA4 can segment people, not just events.
    out.user_properties = {
      first_source: attribution.first_source,
      first_medium: attribution.first_medium,
      first_campaign: attribution.first_campaign
    };
    return out;
  })();

  // Send a GA4 event with attribution attached. Safe to call before gtag loads.
  window.hsTrack = function (name, params) {
    if (typeof window.gtag !== 'function') return;
    var payload = {};
    for (var k in attribution) {
      if (Object.prototype.hasOwnProperty.call(attribution, k)) payload[k] = attribution[k];
    }
    if (params) {
      for (var p in params) {
        if (Object.prototype.hasOwnProperty.call(params, p)) payload[p] = params[p];
      }
    }
    window.gtag('event', name, payload);
  };
})();
