(() => {
  const SUPPORTED_PAGE = /^\/[^/]+\/(team\/[^/]+\/(cycle\/|active|backlog|all|issues)|view\/|project\/[^/]+\/issues)/;
  const NO_ASSIGNEE = { id: 'none', label: 'No assignee', avatarUrl: '' };
  const MAX_VISIBLE = 12;
  const MAX_RETRIES = 5;
  const SAMPLE_SIZE = 20;
  const HOVER_SCALE = 1.6;
  const EDGE_MARGIN = 2;
  const HEADER_GAP = 8;
  const BAR_ROW_HEIGHT = 30;
  const FALLBACK_TOP = 8;
  const FALLBACK_RIGHT = 16;

  let enabled = false;
  let people = [];
  let cacheInfo = {};
  let expanded = false;
  let retries = 0;
  let retryTimer = 0;
  let lastHref = location.href;
  let lastPath = location.pathname;

  const norm = (s) => (s || '').trim().toLowerCase();
  const isSupportedPage = () => SUPPORTED_PAGE.test(location.pathname);

  /* ---------- People, from Linear's local cache for this workspace ---------- */

  const request = (req) => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  // Linear's store names are hashed, so stores are recognised by their records' fields. Empty
  // fields are left out of records, so a single record isn't enough: a bot user has no email.
  // "active" separates real users from external ones (Slack contacts etc.), which look similar.
  async function readDatabase(name) {
    const db = await request(indexedDB.open(name));
    try {
      const found = { orgs: [] };
      for (const store of db.objectStoreNames) {
        const samples = await request(db.transaction(store).objectStore(store).getAll(null, SAMPLE_SIZE));
        const any = (test) => samples.some((r) => r && typeof r === 'object' && test(r));
        if (any((r) => 'displayName' in r && 'email' in r && 'active' in r)) found.users = store;
        else if (any((r) => 'urlKey' in r && 'name' in r && !('teamId' in r))) found.orgs.push(store);
        else if (any((r) => 'key' in r && 'name' in r && ('cycleDuration' in r || 'timezone' in r))) found.teams = store;
        else if (any((r) => 'teamId' in r && 'userId' in r && 'owner' in r)) found.memberships = store;
      }
      if (!found.users) return null;
      const all = (store) => (store ? request(db.transaction(store).objectStore(store).getAll()) : Promise.resolve([]));
      const [users, teams, memberships, orgs] = await Promise.all([
        all(found.users), all(found.teams), all(found.memberships), Promise.all(found.orgs.map(all)),
      ]);
      return { users, teams, memberships, orgs: orgs.flat() };
    } finally {
      db.close();
    }
  }

  async function loadPeople() {
    clearTimeout(retryTimer);
    const [, workspace, , teamKey] = location.pathname.match(/^\/([^/]+)(\/team\/([^/]+))?/) || [];
    let found = [];
    try {
      const names = (await indexedDB.databases()).map((d) => d.name)
        .filter((n) => n && n.startsWith('linear_') && n !== 'linear_databases');
      const results = (await Promise.all(names.map((n) => readDatabase(n).catch(() => null)))).filter(Boolean);
      // Only ever use this workspace's data: another workspace's user IDs would filter to nothing.
      const data = results.find((r) => r.orgs.some((o) => [o.urlKey, ...(o.previousUrlKeys || [])]
        .some((key) => norm(key) === norm(workspace))));
      cacheInfo = { databases: names.length, withUsers: results.length, workspaceMatched: !!data };
      if (data) {
        const active = data.users.filter((u) => u.active !== false && !u.archivedAt && !u.app);
        const team = teamKey && data.teams.find((t) => norm(t.key) === norm(teamKey));
        const memberIds = team && new Set(data.memberships.filter((m) => m.teamId === team.id).map((m) => m.userId));
        const members = memberIds && memberIds.size ? active.filter((u) => memberIds.has(u.id)) : active;
        cacheInfo.teamMatched = !!team;
        found = members.map((u) => ({ id: u.id, label: u.displayName || u.name, avatarUrl: u.avatarUrl || '' }));
      }
    } catch (err) {
      cacheInfo = { error: err.message };
    }
    people = found.sort((a, b) => a.label.localeCompare(b.label));
    render();

    // Linear can still be filling its cache just after a page loads.
    if (!people.length && enabled && isSupportedPage() && retries < MAX_RETRIES) {
      retries += 1;
      retryTimer = setTimeout(loadPeople, 3000);
    }
  }

  /* ---------- The filter lives in the URL, as base64url-encoded JSON:
   * ?filter= {"and":[{"assignee":{"or":[{"id":{"in":["<user id>"]}},{"null":true}]}}]}
   * The URL is the source of truth, so the bar also stays right after a reload or when the
   * filter is changed in Linear itself. Any other filter (status, label...) is left alone.
   * ---------- */

  function readFilter() {
    const raw = new URLSearchParams(location.search).get('filter');
    if (!raw) return {};
    try {
      const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    } catch {
      return null;
    }
  }

  function encodeFilter(filter) {
    const binary = String.fromCharCode(...new TextEncoder().encode(JSON.stringify(filter)));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function clausesOf(filter) {
    if (Array.isArray(filter.and)) return filter.and;
    return Object.keys(filter).length ? [filter] : [];
  }

  function selectedIn(filter) {
    const selected = new Set();
    for (const clause of clausesOf(filter || {})) {
      if (!clause.assignee) continue;
      for (const part of clause.assignee.or || [clause.assignee]) {
        for (const id of part.id?.in || []) selected.add(id);
        if (part.null) selected.add(NO_ASSIGNEE.id);
      }
    }
    return selected;
  }

  function writeSelection(filter, selected) {
    const ids = [...selected].filter((id) => id !== NO_ASSIGNEE.id);
    const parts = [];
    if (ids.length) parts.push({ id: { in: ids } });
    if (selected.has(NO_ASSIGNEE.id)) parts.push({ null: true });

    const clauses = clausesOf(filter).filter((clause) => !clause.assignee);
    if (parts.length) clauses.push({ assignee: { or: parts } });

    // Always write the parameter: Linear remembers filters per view, so removing it just brings
    // the old filter back. An empty {"and":[]} is what clears it, and Linear then tidies the URL.
    const url = new URL(location.href);
    url.searchParams.set('filter', encodeFilter({ and: clauses }));

    // replaceState keeps avatar clicks out of the Back button; popstate tells Linear to re-read the URL.
    history.replaceState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    lastHref = location.href;
    render();
  }

  function update(change) {
    const filter = readFilter();
    if (!filter) {
      toast("Couldn't read this page's filter, so nothing was changed.");
      return;
    }
    const selected = selectedIn(filter);
    change(selected);
    writeSelection(filter, selected);
  }

  const toggle = (id) => update((selected) => (selected.has(id) ? selected.delete(id) : selected.add(id)));
  const clearAll = () => update((selected) => selected.clear());

  /* ---------- The bar ---------- */

  const host = document.createElement('div');
  host.id = 'linear-assignee-filter';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { all: initial; position: fixed; z-index: 2147483000; }
    /* Set here, not on :host: the page's own CSS can override :host, but can't reach inside. */
    .bar, .toast { font-family: var(--page-font, Inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 12px; font-weight: 500; line-height: 1.2; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    .bar { position: relative; display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; min-height: ${BAR_ROW_HEIGHT}px; box-sizing: border-box; padding: 2px 6px; background: #1f2023; border: 1px solid #3a3b40; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,.3); transition: transform .22s cubic-bezier(.2,.8,.3,1); }
    button { all: unset; box-sizing: border-box; cursor: pointer; }
    .avatar { position: relative; width: 24px; height: 24px; border-radius: 50%; border: 2px solid #1f2023; background: #4b4e58; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 500; letter-spacing: .01em; overflow: hidden; }
    .avatar + .avatar { margin-left: -5px; }
    .avatar.on { border-color: #7d88f0; z-index: 1; }
    .avatar:hover, .avatar:focus-visible { z-index: 2; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .text { margin-right: 8px; color: #b4b6bc; }
    .text:hover { color: #fff; }
    /* Sits outside the layout, so appearing doesn't resize the bar and move avatars from the cursor. */
    .clear { position: absolute; right: 100%; top: 50%; transform: translateY(-50%); margin: 0; padding: 4px 6px 4px 8px; background: #1f2023; border-radius: 10px 0 0 10px; }
    .toast { position: absolute; top: 100%; right: 0; margin-top: 8px; width: max-content; max-width: 80vw; padding: 5px 9px; border-radius: 6px; background: #b3372f; color: #fff; }
    @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
  </style><div class="bar"></div>`;
  const bar = shadow.querySelector('.bar');

  /* Sit in the top row of Linear's header, to the right, left of any controls there (the bell and
   * New issue, on some pages). Linear can change this row at any time, so this is re-checked
   * regularly. Without a recognisable header, the corner of the window is fine. */
  function placeBar() {
    const header = [...document.querySelectorAll('header')].find((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 200 && box.top < 100;
    });
    const buttons = header
      ? [...header.querySelectorAll('button,[role="button"]')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
      : [];
    let top = FALLBACK_TOP;
    let rightEdge = window.innerWidth - FALLBACK_RIGHT;
    let leftEdge = 0;
    if (buttons.length) {
      const box = header.getBoundingClientRect();
      const rowTop = Math.min(...buttons.map((r) => r.top));
      const row = buttons.filter((r) => r.top - rowTop < HEADER_GAP);
      const middle = box.left + box.width / 2;
      rightEdge = Math.min(box.right, ...row.filter((r) => r.left > middle).map((r) => r.left)) - HEADER_GAP;
      leftEdge = Math.max(box.left, ...row.filter((r) => r.left <= middle).map((r) => r.right)) + HEADER_GAP;
      top = rowTop + row[0].height / 2 - BAR_ROW_HEIGHT / 2;
    }
    bar.style.maxWidth = `${Math.max(120, rightEdge - leftEdge)}px`;
    // Everyone right of the hovered person moves right when zoomed, so leave room for the
    // furthest case: hovering the first avatar. Otherwise they'd run off the window.
    const first = bar.querySelector('.avatar');
    const reach = first ? bar.offsetWidth - first.offsetLeft - first.offsetWidth / 2 : 0;
    const zoomRoom = window.innerWidth - EDGE_MARGIN - (HOVER_SCALE - 1) * reach;
    host.style.top = `${top}px`;
    host.style.right = `${window.innerWidth - Math.min(rightEdge, zoomRoom)}px`;
  }

  /* Zoom the whole bar around the avatar under the cursor, so that avatar stays exactly where it
   * is. The anchor is only chosen on entry: moving it while zoomed would make the bar jump. */
  function zoomLimit(rect, x, y) {
    const limits = [
      [rect.left, x],
      [window.innerWidth - rect.right, rect.width - x],
      [rect.top, y],
      [window.innerHeight - rect.bottom, rect.height - y],
    ].map(([room, reach]) => (reach > 0 ? 1 + Math.max(0, room - EDGE_MARGIN) / reach : Infinity));
    return Math.min(HOVER_SCALE, ...limits);
  }

  bar.addEventListener('pointerenter', (event) => {
    const rect = bar.getBoundingClientRect();
    if (rect.width / bar.offsetWidth < 1.01) {
      const avatar = shadow.elementFromPoint(event.clientX, event.clientY)?.closest('.avatar');
      const x = avatar ? bar.clientLeft + avatar.offsetLeft + avatar.offsetWidth / 2 : event.clientX - rect.left;
      const y = avatar ? bar.clientTop + avatar.offsetTop + avatar.offsetHeight / 2 : event.clientY - rect.top;
      bar.style.transformOrigin = `${x}px ${y}px`;
      bar.dataset.zoom = zoomLimit(rect, x, y);
    }
    // Coming back while it's still shrinking keeps the old anchor, so there's no jump.
    bar.style.transform = `scale(${bar.dataset.zoom})`;
  });

  bar.addEventListener('pointerleave', () => { bar.style.transform = ''; });

  function initials(label) {
    const words = label.split(/[\s._-]+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : label.slice(0, 2)).toUpperCase();
  }

  function avatarButton(person, selected) {
    const on = selected.has(person.id);
    const button = document.createElement('button');
    button.className = `avatar${on ? ' on' : ''}`;
    button.title = person.label;
    button.setAttribute('aria-label', `Filter by ${person.label}`);
    button.setAttribute('aria-pressed', String(on));
    if (person.id === NO_ASSIGNEE.id) {
      button.textContent = '\u2205';
    } else if (person.avatarUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = person.avatarUrl;
      img.onerror = () => { img.remove(); button.textContent = initials(person.label); };
      button.append(img);
    } else {
      button.textContent = initials(person.label);
    }
    button.addEventListener('click', () => toggle(person.id));
    return button;
  }

  function textButton(label, onClick, extraClass = '') {
    const button = document.createElement('button');
    button.className = `text ${extraClass}`.trim();
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function render() {
    if (!enabled || !isSupportedPage() || !people.length) {
      host.remove();
      return;
    }
    if (!host.isConnected) document.documentElement.append(host);
    // Use whatever font Linear is using. Custom properties get through to the shadow DOM.
    host.style.setProperty('--page-font', getComputedStyle(document.body).fontFamily);

    const selected = selectedIn(readFilter());
    // Selected people always stay visible, even when the list is collapsed.
    const hidden = expanded ? [] : people.filter((p) => !selected.has(p.id)).slice(MAX_VISIBLE);
    const shown = people.filter((p) => !hidden.includes(p));
    bar.replaceChildren(
      ...(selected.size ? [textButton('Clear', clearAll, 'clear')] : []),
      ...(hidden.length ? [textButton(`+${hidden.length}`, () => { expanded = true; render(); })] : []),
      ...shown.map((p) => avatarButton(p, selected)),
      avatarButton(NO_ASSIGNEE, selected),
    );
    placeBar();
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    shadow.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  /* ---------- Wiring ---------- */

  function start() {
    retries = 0;
    render();
    if (enabled) loadPeople();
  }

  chrome.storage.local.get({ enabled: false }, (stored) => {
    enabled = stored.enabled;
    start();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.enabled) return;
    enabled = changes.enabled.newValue;
    start();
  });

  // Linear changes pages without a reload, and its own filter controls update the URL too.
  setInterval(() => {
    if (host.isConnected) placeBar();
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      expanded = false;
      start();
    } else {
      render();
    }
  }, 300);

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type !== 'debug-report') return;
    const filter = readFilter();
    reply({
      path: location.pathname,
      supportedPage: isSupportedPage(),
      enabled,
      peopleCount: people.length,
      cache: cacheInfo,
      filterReadable: !!filter,
      selectedCount: selectedIn(filter).size,
    });
  });
})();
