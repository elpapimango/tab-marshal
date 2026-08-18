/**
 * URL / hostname helpers. Pure code — no `chrome` access, so it can be unit tested
 * with plain Node.
 */

/**
 * Public-suffix-ish list. This is deliberately a heuristic and not the full PSL:
 * it covers the common multi-label suffixes plus a handful of hosting providers
 * where the interesting grouping is the sub-label (contoso.sharepoint.com,
 * user.github.io, ...).
 */
const MULTI_LABEL_SUFFIXES = new Set([
  // country-code second level domains
  'ac.uk', 'co.uk', 'gov.uk', 'ltd.uk', 'me.uk', 'mod.uk', 'net.uk', 'nhs.uk', 'org.uk', 'plc.uk', 'police.uk', 'sch.uk',
  'asn.au', 'com.au', 'edu.au', 'gov.au', 'id.au', 'net.au', 'org.au',
  'ac.nz', 'co.nz', 'geek.nz', 'govt.nz', 'net.nz', 'org.nz', 'school.nz',
  'ac.jp', 'ad.jp', 'co.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp', 'ne.jp', 'or.jp',
  'com.br', 'edu.br', 'gov.br', 'net.br', 'org.br',
  'ac.in', 'co.in', 'edu.in', 'firm.in', 'gen.in', 'gov.in', 'ind.in', 'net.in', 'org.in', 'res.in',
  'ac.cn', 'com.cn', 'edu.cn', 'gov.cn', 'net.cn', 'org.cn',
  'ac.kr', 'co.kr', 'go.kr', 'ne.kr', 'or.kr', 'pe.kr', 're.kr',
  'com.mx', 'edu.mx', 'gob.mx', 'net.mx', 'org.mx',
  'ac.za', 'co.za', 'gov.za', 'net.za', 'org.za', 'web.za',
  'bel.tr', 'com.tr', 'edu.tr', 'gov.tr', 'net.tr', 'org.tr',
  'com.sg', 'edu.sg', 'gov.sg', 'net.sg', 'org.sg',
  'com.hk', 'edu.hk', 'gov.hk', 'idv.hk', 'net.hk', 'org.hk',
  'com.tw', 'edu.tw', 'gov.tw', 'net.tw', 'org.tw',
  'ac.il', 'co.il', 'gov.il', 'net.il', 'org.il',
  'com.ar', 'edu.ar', 'gov.ar', 'net.ar', 'org.ar',
  'ac.id', 'co.id', 'go.id', 'my.id', 'or.id', 'web.id',
  'com.my', 'edu.my', 'gov.my', 'net.my', 'org.my',
  'com.ph', 'edu.ph', 'gov.ph', 'net.ph', 'org.ph',
  'com.vn', 'edu.vn', 'gov.vn', 'net.vn', 'org.vn',
  'com.ua', 'edu.ua', 'gov.ua', 'in.ua', 'kiev.ua', 'net.ua', 'org.ua',
  'com.pl', 'edu.pl', 'gov.pl', 'net.pl', 'org.pl', 'waw.pl',
  'com.ru', 'edu.ru', 'gov.ru', 'msk.ru', 'net.ru', 'org.ru', 'spb.ru',
  'com.es', 'edu.es', 'gob.es', 'nom.es', 'org.es',
  'ac.th', 'go.th', 'in.th', 'net.th', 'or.th',
  'com.pk', 'edu.pk', 'gov.pk', 'net.pk', 'org.pk',
  'com.eg', 'edu.eg', 'gov.eg', 'net.eg', 'org.eg',
  'com.sa', 'edu.sa', 'gov.sa', 'net.sa', 'org.sa',
  'ac.ke', 'go.ke', 'ne.ke', 'or.ke',
  'com.ng', 'edu.ng', 'gov.ng', 'net.ng', 'org.ng',
  'com.co', 'edu.co', 'gov.co', 'net.co', 'org.co',
  'com.pe', 'edu.pe', 'gob.pe', 'net.pe', 'org.pe',
  'com.uy', 'edu.uy', 'gub.uy', 'net.uy', 'org.uy',
  'com.ec', 'edu.ec', 'gob.ec', 'net.ec', 'org.ec',
  'com.ve', 'edu.ve', 'gob.ve', 'net.ve', 'org.ve',
  'ac.at', 'co.at', 'gv.at', 'or.at',
  'co.no', 'co.cz', 'com.cy', 'com.mt', 'com.gr', 'com.gt', 'com.do', 'com.pa', 'com.py',
  'com.bo', 'com.ni', 'com.sv', 'com.hn', 'com.cu',
  // hosting providers where the sub-label identifies the actual site
  'appspot.com', 'azurewebsites.net', 'blogspot.com', 'cloudfront.net', 'firebaseapp.com',
  'fly.dev', 'github.io', 'gitlab.io', 'glitch.me', 'herokuapp.com', 'myshopify.com',
  'netlify.app', 'ngrok-free.app', 'ngrok.io', 'notion.site', 'onrender.com', 'pages.dev',
  'readthedocs.io', 'repl.co', 's3.amazonaws.com', 'sharepoint.com', 'sourceforge.net',
  'surge.sh', 'translate.goog', 'vercel.app', 'web.app', 'wordpress.com', 'workers.dev'
]);

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Longest string a user-supplied regular expression is ever tested against.
 *
 * Patterns come from the user, but the text they run over does not: a page picks
 * its own title, and Auto-Group tests every rule against a new tab's title in
 * the service worker as the tab opens. A pattern that backtracks badly plus a
 * long crafted title would hang the worker, taking the menus and the duplicate
 * watch with it. No filter or sort key anyone writes needs more of a title or
 * URL than this.
 */
export const MAX_MATCH_LENGTH = 2048;

/** Trim a haystack to the length a regex is allowed to see. */
export function clampForMatch(text) {
  const s = text || '';
  return s.length > MAX_MATCH_LENGTH ? s.slice(0, MAX_MATCH_LENGTH) : s;
}

/** Parse a URL, returning null instead of throwing. */
export function parseUrl(url) {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Strip a single leading `www.` label. */
export function stripWww(hostname) {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

/**
 * Best-effort registrable domain ("example.co.uk" from "www.a.example.co.uk").
 * IP addresses and single-label hosts are returned unchanged.
 */
export function getRegistrableDomain(hostname) {
  if (!hostname) return '';
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (IPV4_RE.test(host) || host.startsWith('[') || host.includes(':')) return host;

  const labels = host.split('.');
  if (labels.length <= 2) return host;

  for (let n = 3; n >= 2; n--) {
    if (labels.length <= n) continue;
    const suffix = labels.slice(-n).join('.');
    if (MULTI_LABEL_SUFFIXES.has(suffix)) return labels.slice(-(n + 1)).join('.');
  }
  return labels.slice(-2).join('.');
}

const WEB_SCHEMES = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:']);

/**
 * Hostname for a tab URL. For browser pages (edge://settings, about:blank,
 * file://) the "hostname" is not a site, so the scheme is kept in the key —
 * that clusters browser pages together instead of mixing them in with real
 * sites under a bare word like "settings".
 */
export function getHostname(url) {
  const u = parseUrl(url);
  if (!u) return '';
  const scheme = u.protocol.replace(':', '');
  if (WEB_SCHEMES.has(u.protocol)) return u.hostname.toLowerCase();
  return u.hostname ? `${scheme}://${u.hostname.toLowerCase()}` : scheme;
}

/** Registrable domain for a tab URL, `www.` stripped. */
export function getDomain(url) {
  const u = parseUrl(url);
  if (!u) return '';
  // Everything non-web collapses to its scheme, so all edge:// pages sort as one.
  if (!WEB_SCHEMES.has(u.protocol) || !u.hostname) return u.protocol.replace(':', '');
  return getRegistrableDomain(stripWww(u.hostname));
}

/** hostname + pathname, useful for clustering pages of the same site section. */
export function getHostPath(url) {
  const u = parseUrl(url);
  if (!u) return (url || '').toLowerCase();
  return getHostname(url) + decodeSafe(u.pathname).replace(/\/$/, '');
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
