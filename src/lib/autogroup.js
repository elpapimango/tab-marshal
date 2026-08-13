/**
 * Deciding which native tab group a tab belongs to, from an ordered list of
 * rules. Pure code — no `chrome`/`browser` access, same style as watch.js and
 * select.js, so it is unit testable with plain Node.
 *
 * Rules reuse the filter vocabulary select.js already defines (field/mode/
 * value/caseSensitive) rather than inventing a second one, and are evaluated
 * with the same matchesFilter() the Select and Reload panels use.
 */

import { matchesFilter } from './select.js';
import { COLOR_ORDER } from './sorter.js';

/** The fixed colour enum both chrome.tabGroups and Firefox's tabGroups accept. */
export const GROUP_COLORS = COLOR_ORDER;

export const DEFAULT_RULE = Object.freeze({
  field: 'domain',
  mode: 'contains',
  value: '',
  caseSensitive: false,
  groupName: '',
  /** A GROUP_COLORS id, or '' to auto-assign one from the group name. */
  color: ''
});

export const DEFAULT_AUTOGROUP_OPTIONS = Object.freeze({
  /** Group new tabs as they open. Off by default — this moves tabs on its own. */
  enabled: false,
  /** DEFAULT_RULE-shaped, in priority order: the first match wins. */
  rules: []
});

/** Compile each rule's regex once; throws a readable error on a bad pattern. */
export function prepareAutoGroupRules(rules) {
  return (rules || []).map((rule) => {
    const opts = { ...DEFAULT_RULE, ...rule };
    if (opts.mode === 'regex' && opts.value) {
      try {
        opts.compiledFilter = new RegExp(opts.value, opts.caseSensitive ? '' : 'i');
      } catch (err) {
        throw new Error(String(err.message).replace(/^SyntaxError:\s*/, ''));
      }
    }
    return opts;
  });
}

/**
 * Deterministic colour from a group name, so the same name always lands on
 * the same colour without the user having to pick one.
 */
export function colorForName(name) {
  const str = String(name || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

/**
 * The first prepared rule that matches, or null. A rule with no pattern value
 * or no group name is skipped rather than matching everything / nothing has
 * nowhere to go.
 */
export function matchRule(tab, preparedRules) {
  for (const rule of preparedRules) {
    if (!rule.value || !rule.groupName.trim()) continue;
    if (matchesFilter(tab, rule)) return rule;
  }
  return null;
}

/**
 * @param {Array} tabs eligible tabs — the caller has already excluded pinned
 *   tabs and anything out of scope
 * @param {Array} rawRules DEFAULT_RULE-shaped rules, in priority order
 * @param {Map<string, {id:number}>} existingGroupsByTitle group title
 *   (lowercased) -> group, for the window(s) the tabs belong to
 * @returns {Array<{tabId:number, groupTitle:string, color:string, existingGroupId:number|null}>}
 *   One entry per tab that should move; tabs already sitting in the group
 *   their rule points at are omitted, and unmatched tabs are left alone.
 */
export function planGroupAssignments(tabs, rawRules, existingGroupsByTitle = new Map()) {
  const rules = prepareAutoGroupRules(rawRules);
  const plan = [];
  for (const tab of tabs) {
    const rule = matchRule(tab, rules);
    if (!rule) continue;

    const title = rule.groupName.trim();
    const existing = existingGroupsByTitle.get(title.toLowerCase());
    if (existing && tab.groupId === existing.id) continue; // already correct

    plan.push({
      tabId: tab.id,
      groupTitle: title,
      color: rule.color || colorForName(title),
      existingGroupId: existing ? existing.id : null
    });
  }
  return plan;
}
