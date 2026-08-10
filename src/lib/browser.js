/**
 * The extension API namespace.
 *
 * Firefox exposes the promise-based `browser.*`; Chrome and Edge expose
 * `chrome.*`. Firefox also mirrors `chrome.*`, but `browser.*` is the one it
 * documents as promise-returning, so it is preferred where present.
 *
 * Access is resolved lazily through a Proxy rather than captured once at import
 * time. Capturing would break the tests, which install a fresh fake global
 * before each case: `lib/browser.js` is imported under the same specifier every
 * time and so is only evaluated once, and a captured reference would still
 * point at the first test's fake.
 */
export const api = new Proxy(
  {},
  {
    get(_target, prop) {
      const ns = globalThis.browser ?? globalThis.chrome;
      return ns ? ns[prop] : undefined;
    },
    has(_target, prop) {
      const ns = globalThis.browser ?? globalThis.chrome;
      return Boolean(ns) && prop in ns;
    }
  }
);

/**
 * True on Gecko. Detected through an API only Firefox implements rather than by
 * sniffing the user agent.
 */
export function isFirefox() {
  return typeof api.runtime?.getBrowserInfo === 'function';
}

/** True where `chrome.tabGroups` exists — absent in older builds. */
export function hasTabGroups() {
  return typeof api.tabGroups !== 'undefined';
}
