const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

// ── Theme ──────────────────────────────────────────────
const THEME_KEY = 'sine-theme';

const applyTheme = theme => {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#11111b' : '#dce0e8';
};

const toggleTheme = () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
};

const saved = (() => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } })();
if (saved) applyTheme(saved);

$('#themeToggle')?.addEventListener('click', toggleTheme);

// ── Data ───────────────────────────────────────────────
const THEMES = await fetch('./marketplace.json').then(r => r.json());
const ENTRIES = Object.entries(THEMES).map(([id, t]) => ({ id, ...t }));
const NOW = Date.now();

// ── Utilities ──────────────────────────────────────────
const ts = s => {
  if (!s) return 0;
  let n = typeof s === 'string' && s.includes(' ') ? s.replace(' ', 'T') : s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) n += 'T00:00:00';
  const t = new Date(n).getTime();
  return isNaN(t) ? 0 : t;
};

const relTime = d => {
  const t = ts(d);
  if (!t) return '';
  const diff = NOW - t;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
};

const trunc = (s, n) => !s || s.length <= n ? s : s.slice(0, n).trimEnd() + '…';

const TOP_MOD = [...ENTRIES].sort((a, b) => (b.stars || 0) - (a.stars || 0))[0];

const addHottestBadge = card => {
  const badge = document.createElement('div');
  badge.className = 'hottest-badge';
  badge.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 2C6.5 7 4 9 4 13c0 4 3.5 7 8 7s8-3 8-7c0-4-2.5-6-3.5-11-1 4-2.5 6-5 6s-3-2.5-3-6z"/><path d="M8 17c1.5 1 3 1.5 5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Hottest`;
  card.querySelector('.theme-img').appendChild(badge);
};

const ghLinks = (homepage, author) => {
  const r = { author: author || 'Unknown', link: '#', repo: '#' };
  try {
    if (homepage) {
      const p = new URL(homepage).pathname.split('/').filter(Boolean);
      if (p.length >= 2) {
        r.author = author || p[0];
        r.link = `https://github.com/${p[0]}`;
        r.repo = `https://github.com/${p[0]}/${p[1]}`;
      }
    }
  } catch {}
  return r;
};

// ── Search helpers ─────────────────────────────────────
const highlight = (text, query) => {
  if (!query || !text) return text || '';
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
};

const searchIndex = (() => {
  return ENTRIES.map(e => {
    const name = (e.name || e.id || '').toLowerCase();
    const desc = (e.description || '').toLowerCase();
    const author = (e.author || '').toLowerCase();
    const tags = (e.tags || []).map(t => t.toLowerCase());
    const searchText = [name, desc, author, ...tags].join(' ');
    return { id: e.id, name, desc, author, tags, searchText, entry: e };
  });
})();

const querySearch = (q) => {
  if (!q) return { mods: [], tags: [], authors: [] };
  const lq = q.toLowerCase();
  const mods = [];
  const tagMatches = [];
  const authorMatches = [];

  searchIndex.forEach(({ id, name, desc, author, tags, entry }) => {
    if (name.includes(lq) || desc.includes(lq)) {
      mods.push({ entry, kind: 'mod', matchField: name.includes(lq) ? 'name' : 'desc' });
      return;
    }
    if (tags.some(t => t.includes(lq))) {
      tagMatches.push({ entry, kind: 'tag' });
      return;
    }
    if (author.includes(lq)) {
      authorMatches.push({ entry, kind: 'author' });
    }
  });

  return { mods, tags: tagMatches, authors: authorMatches };
};

// ── Search Panel ───────────────────────────────────────
const panelInput = $('#searchInput');
const panel = $('#searchPanel');
const panelInner = $('#searchPanelInner');

let panelIndex = -1;
let panelItems = [];

const closePanel = () => {
  panel.classList.remove('open');
  panelIndex = -1;
  panelItems = [];
};

const renderPanel = (q) => {
  const trimmed = q.trim();

  if (!trimmed) {
    const top = [...ENTRIES].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 8);
    panelInner.innerHTML = `
      <div class="search-panel-section">Recommendations</div>
      ${top.map((mod, i) => panelItemHTML(mod, '', i)).join('')}
      <div style="padding:0.5rem;text-align:center;border-top:var(--border);margin-top:0.25rem">
        <span class="search-panel-shortcut" style="margin:0 auto;width:fit-content">
          <kbd>↑</kbd> <kbd>↓</kbd> navigate &middot; <kbd>⏎</kbd> open
        </span>
      </div>`;
    panelItems = top;
    panel.classList.add('open');
    panelIndex = -1;
    return;
  }

  const results = querySearch(trimmed);
  const total = results.mods.length + results.tags.length + results.authors.length;

  if (!total) {
    panelInner.innerHTML = `<div class="search-panel-empty">No mods found for "<strong>${highlight(trimmed, trimmed)}</strong>"</div>`;
    panelItems = [];
    panel.classList.add('open');
    panelIndex = -1;
    return;
  }

  const html = [];
  const items = [];
  let idx = 0;

  if (results.mods.length) {
    html.push(`<div class="search-panel-section">Mods (${results.mods.length})</div>`);
    results.mods.forEach(r => {
      html.push(panelItemHTML(r.entry, trimmed, idx++));
      items.push(r.entry);
    });
  }

  if (results.authors.length) {
    html.push(`<div class="search-panel-section">Authors (${results.authors.length})</div>`);
    results.authors.forEach(r => {
      html.push(panelItemHTML(r.entry, trimmed, idx++));
      items.push(r.entry);
    });
  }

  if (results.tags.length) {
    html.push(`<div class="search-panel-section">Tags (${results.tags.length})</div>`);
    results.tags.forEach(r => {
      html.push(panelItemHTML(r.entry, trimmed, idx++));
      items.push(r.entry);
    });
  }

  panelInner.innerHTML = html.join('');
  panelItems = items;
  panel.classList.add('open');
  panelIndex = -1;
};

const panelItemHTML = (mod, query, i) => {
  const name = query ? highlight(mod.name || mod.id, query) : (mod.name || mod.id);
  const tags = (mod.tags || []).slice(0, 2);
  return `<div class="search-panel-item" data-index="${i}" data-id="${mod.id}">
    <img class="search-panel-item-img" src="${mod.image || 'assets/neko.gif'}" alt="" onerror="this.src='assets/neko.gif'" loading="lazy" />
    <div class="search-panel-item-body">
      <div class="search-panel-item-name">${name}</div>
      <div class="search-panel-item-meta">
        <span class="search-panel-item-stars">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          ${mod.stars || 0}
        </span>
        ${mod.author ? `<span>${query ? highlight(mod.author, query) : mod.author}</span>` : ''}
        ${tags.length ? `<span>${tags.join(', ')}</span>` : ''}
      </div>
    </div>
  </div>`;
};

const navigatePanel = (dir) => {
  if (!panel.classList.contains('open') || !panelItems.length) return;
  panelIndex = Math.max(-1, Math.min(panelIndex + dir, panelItems.length - 1));
  panelInner.querySelectorAll('.search-panel-item').forEach((el, i) => {
    el.classList.toggle('highlighted', i === panelIndex);
    if (i === panelIndex) el.scrollIntoView({ block: 'nearest' });
  });
};

const commitPanel = () => {
  if (!panel.classList.contains('open') || panelIndex < 0 || panelIndex >= panelItems.length) return;
  const mod = panelItems[panelIndex];
  closePanel();
  panelInput.value = '';
  filteredIds = new Set(ENTRIES.map(e => e.id));
  renderGrid();
  openModal(mod.id, mod);
};

// Panel events
panelInput.addEventListener('focus', () => renderPanel(panelInput.value));
panelInput.addEventListener('input', () => renderPanel(panelInput.value));
panelInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); navigatePanel(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); navigatePanel(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); commitPanel(); }
  else if (e.key === 'Escape') { closePanel(); panelInput.blur(); }
});

panel.addEventListener('mousedown', e => e.preventDefault());
panel.addEventListener('click', e => {
  const item = e.target.closest('.search-panel-item');
  if (!item) return;
  const mod = THEMES[item.dataset.id];
  if (!mod) return;
  closePanel();
  panelInput.value = '';
  filteredIds = new Set(ENTRIES.map(e => e.id));
  renderGrid();
  openModal(mod.id, mod);
});

document.addEventListener('click', e => {
  if (!panel.classList.contains('open')) return;
  if (!e.target.closest('.search-wrap')) closePanel();
});

// ── Seeded RNG (Mulberry32) ────────────────────────────
const seedFromDate = () => {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

const mulberry32 = a => {
  let t = a += 0x6D2B79F5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const pickModOfDay = entries => {
  const sorted = [...entries].sort((a, b) => (b.stars || 0) - (a.stars || 0));
  const top = sorted.slice(0, Math.max(10, Math.ceil(sorted.length * 0.2)));
  const seed = seedFromDate();
  const rng = mulberry32(seed);
  return top[Math.floor(rng * top.length)];
};

// ── Mod of the Day ─────────────────────────────────────
const renderMOTD = () => {
  const mod = pickModOfDay(ENTRIES);
  if (!mod) return;
  const { author, link: authorLink, repo } = ghLinks(mod.homepage, mod.author);
  const tags = (mod.tags || []).slice(0, 4);

  const el = document.createElement('div');
  el.className = 'motd';
  el.dataset.id = mod.id;
  el.innerHTML = `
    <div class="motd-image">
      <img src="${mod.image || 'assets/neko.gif'}" alt="${mod.name || mod.id}" onerror="this.src='assets/neko.gif'" />
    </div>
    <div class="motd-body">
      <div class="motd-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        Mod of the Day
      </div>
      <h2 class="motd-name">${mod.name || mod.id}</h2>
      <p class="motd-author">by <a href="${authorLink}" target="_blank" rel="noopener">${author}</a></p>
      <p class="motd-desc">${mod.description || ''}</p>
      <div class="motd-footer">
        <span class="motd-stars">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          ${mod.stars || 0}
        </span>
        ${tags.length ? `<div class="motd-tags">${tags.map(t => `<span class="motd-tag">${t}</span>`).join('')}</div>` : ''}
        <button class="motd-btn">View Details</button>
      </div>
    </div>`;
  $('#motd').appendChild(el);

  el.querySelector('.motd-btn').addEventListener('click', e => {
    e.stopPropagation();
    openModal(mod.id, mod);
  });
  el.addEventListener('click', () => openModal(mod.id, mod));
};

// ── Carousel ───────────────────────────────────────────
let carouselScrollPos = 0;

const renderCarousel = () => {
  const track = $('#carouselTrack');
  const top = [...ENTRIES].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 12);
  top.forEach((mod, i) => {
    const card = createCard(mod.id, mod);
    card.style.animationDelay = `${i * 0.04}s`;
    if (mod === TOP_MOD) addHottestBadge(card);
    track.appendChild(card);
  });
};

const renderRecentlyPublished = () => {
  const track = $('#recentTrack');
  const recent = [...ENTRIES].sort((a, b) => ts(b.createdAt) - ts(a.createdAt)).slice(0, 8);
  recent.forEach((mod, i) => {
    const card = createCard(mod.id, mod);
    card.style.animationDelay = `${i * 0.04}s`;
    if (mod === TOP_MOD) addHottestBadge(card);
    track.appendChild(card);
  });
};

const scrollCarousel = dir => {
  const track = $('#carouselTrack');
  const cw = track.querySelector('.theme')?.offsetWidth || 0;
  const gap = 14;
  const step = cw + gap;
  track.scrollBy({ left: dir * step * 2, behavior: 'smooth' });
};

// ── Card Factory ───────────────────────────────────────
const createCard = (id, mod) => {
  if (!mod) return null;
  const desc = trunc(mod.description, 90);
  const tags = (mod.tags || []).slice(0, 3);

  const card = document.createElement('div');
  card.className = 'theme';
  card.dataset.id = id;
  card.innerHTML = `
    <div class="theme-img">
      <img src="${mod.image || 'assets/neko.gif'}" alt="${mod.name || id}" loading="lazy" onerror="this.src='assets/neko.gif'" />
    </div>
    <div class="theme-body">
      <div class="theme-header">
        <h3 class="theme-name">${mod.name || id}</h3>
        <span class="theme-stars">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          ${mod.stars || 0}
        </span>
      </div>
      <p class="theme-desc">${desc}</p>
      <div class="theme-footer">
        <div class="theme-tags">${tags.map(t => `<span class="theme-tag">${t}</span>`).join('')}</div>
        <span class="theme-updated">${mod.updatedAt ? relTime(mod.updatedAt) : ''}</span>
      </div>
    </div>`;
  return card;
};

// ── Modal ──────────────────────────────────────────────
const closeModal = () => {
  const m = $('#themeModal');
  if (!m) return;
  m.classList.add('closing');
  m.addEventListener('animationend', () => m.remove(), { once: true });
};

const openModal = (id, mod) => {
  if (!mod) return;
  $('#themeModal')?.remove();
  const { author, link: authorLink, repo } = ghLinks(mod.homepage, mod.author);
  const tags = (mod.tags || []).map(t => `<span class="tag">${t}</span>`).join('');

  const el = document.createElement('div');
  el.id = 'themeModal';
  el.innerHTML = `
    <div class="theme-modal-content">
      <img src="${mod.image || 'assets/neko.gif'}" alt="" class="theme-modal-image" onerror="this.src='assets/neko.gif'" />
      <div class="theme-modal-body">
        <div class="theme-modal-header">
          <h2 class="theme-modal-name">${mod.name || id}</h2>
          <button class="theme-modal-close" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="theme-modal-meta">
          <span class="meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <a href="${authorLink}" target="_blank" rel="noopener">${author}</a>
          </span>
          <span class="meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span class="modal-stars">${mod.stars || 0}</span>
          </span>
          <span class="meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            <span class="modal-version">v${mod.version || '1.0.0'}</span>
          </span>
          ${mod.updatedAt ? `<span class="meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Updated ${relTime(mod.updatedAt)}</span>` : ''}
        </div>
        <p class="theme-modal-description">${mod.description || ''}</p>
        ${tags ? `<div class="theme-modal-tags">${tags}</div>` : ''}
        <div class="theme-modal-buttons">
          <a href="${repo}" target="_blank" rel="noopener" class="btn btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            View on GitHub
          </a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('.theme-modal-close').addEventListener('click', closeModal);
  el.addEventListener('click', e => { if (e.target === el) closeModal(); });
};

// ── Grid / Sort / Filter ───────────────────────────────
let sortBy = 'stars';
let filterBrowser = 'all';
let filteredIds = new Set(ENTRIES.map(e => e.id));

const container = $('#themeContainer');

const sortFns = {
  stars: (a, b) => (b.stars || 0) - (a.stars || 0),
  updated: (a, b) => ts(b.updatedAt) - ts(a.updatedAt),
  added: (a, b) => ts(b.createdAt) - ts(a.createdAt),
  alphabetical: (a, b) => (a.name || a.id).localeCompare(b.name || b.id),
};

const renderGrid = () => {
  let arr = ENTRIES.filter(e => filteredIds.has(e.id));
  if (filterBrowser !== 'all') {
    arr = arr.filter(e => (e.fork || []).map(f => f.toLowerCase()).includes(filterBrowser));
  }
  arr.sort(sortFns[sortBy] || sortFns.stars);

  container.innerHTML = '';

  if (!arr.length) {
    container.innerHTML = '<div class="no-results"><strong>No mods found</strong><br>Try adjusting your search or filters</div>';
    $('#resultsCount').textContent = '0 results';
    return;
  }

  arr.forEach((mod, i) => {
    const card = createCard(mod.id, mod);
    if (card) {
      card.style.animationDelay = `${i * 0.03}s`;
      container.appendChild(card);
    }
  });

  $('#resultsCount').textContent = `${arr.length} mod${arr.length > 1 ? 's' : ''}`;
  const q = $('.search').value.trim();
  if (q) $('#resultsCount').textContent = `${arr.length} result${arr.length > 1 ? 's' : ''} for "${q}"`;
};

// ── Event Listeners ────────────────────────────────────
const onCardClick = e => {
  const card = e.target.closest('.theme');
  if (!card) return;
  const mod = THEMES[card.dataset.id];
  if (mod) openModal(card.dataset.id, mod);
};

container.addEventListener('click', onCardClick);
document.addEventListener('click', e => {
  const track = e.target.closest('.carousel-track');
  if (track) onCardClick(e);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Dropdowns ──────────────────────────────────────────
const setupDropdown = (btn, menu, optClass, current, onSelect) => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    $$('.sort-menu').forEach(m => { if (m !== menu) m.closest('.sort-dropdown')?.classList.remove('active'); });
    btn.closest('.sort-dropdown')?.classList.toggle('active');
  });
  menu.addEventListener('click', e => {
    const opt = e.target.closest(`.${optClass}`);
    if (!opt) return;
    e.stopPropagation();
    $$(`.${optClass}`, menu).forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    current.textContent = opt.textContent.trim();
    btn.closest('.sort-dropdown')?.classList.remove('active');
    onSelect(opt);
  });
};

setupDropdown($('#sortButton'), $('#sortMenu'), 'sort-option', $('#currentSort'), opt => {
  sortBy = opt.dataset.sort;
  renderGrid();
});

setupDropdown($('#browserButton'), $('#browserMenu'), 'browser-option', $('#currentBrowser'), opt => {
  filterBrowser = opt.dataset.browser;
  renderGrid();
});

document.addEventListener('click', () => {
  $$('.sort-menu').forEach(m => {
    m.classList.remove('active');
    m.closest('.sort-dropdown')?.classList.remove('active');
  });
});

// ── Browser options ────────────────────────────────────
const browsers = new Set();
ENTRIES.forEach(t => { if (t.fork) t.fork.forEach(f => browsers.add(f.toLowerCase())); });
[...browsers].sort().forEach(b => {
  const opt = document.createElement('button');
  opt.className = 'browser-option';
  opt.dataset.browser = b;
  opt.textContent = b.charAt(0).toUpperCase() + b.slice(1);
  $('#browserMenu').appendChild(opt);
});

// ── Carousel buttons ────────────────────────────────────
$('#carouselPrev').addEventListener('click', () => scrollCarousel(-1));
$('#carouselNext').addEventListener('click', () => scrollCarousel(1));

// ── Init ───────────────────────────────────────────────
renderMOTD();
renderCarousel();
renderRecentlyPublished();
renderGrid();
