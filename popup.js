// ─── STORAGE HELPERS ───────────────────────────────────────────────
const store = {
  get: (key) => new Promise(r => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([key], res => r(res[key]));
    } else {
      r(JSON.parse(localStorage.getItem(key)));
    }
  }),
  set: (key, val) => new Promise(r => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [key]: val }, r);
    } else {
      localStorage.setItem(key, JSON.stringify(val));
      r();
    }
  }),
};

// ─── STATE ───────────────────────────────────────────────────────────
let entries = [];
let editingId = null;
let currentType = 'password';
let currentCat = 'all';
let detailEntryId = null;

// ─── DOM ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = {
  lock: $('lock-screen'),
  setup: $('setup-screen'),
  vault: $('vault-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ─── INIT ────────────────────────────────────────────────────────────
async function init() {
  const hash = await store.get('masterHash');
  showScreen(hash ? 'lock' : 'setup');
}
init();

// ─── SETUP ───────────────────────────────────────────────────────────
$('setup-btn').addEventListener('click', () => showScreen('setup'));
$('back-to-lock-btn').addEventListener('click', () => showScreen('lock'));

$('save-master-btn').addEventListener('click', async () => {
  const p1 = $('new-pass').value.trim();
  const p2 = $('confirm-pass').value.trim();
  const hint = $('setup-hint');
  if (!p1) { hint.textContent = 'Please enter a password.'; return; }
  if (p1 !== p2) { hint.textContent = 'Passwords do not match.'; return; }
  await store.set('masterHash', simpleHash(p1));
  hint.textContent = '';
  $('new-pass').value = ''; $('confirm-pass').value = '';
  await unlockVault();
});

// ─── LOCK / UNLOCK ───────────────────────────────────────────────────
$('unlock-btn').addEventListener('click', async () => {
  const p = $('master-password').value;
  const stored = await store.get('masterHash');
  if (simpleHash(p) === stored) {
    $('master-password').value = '';
    $('lock-hint').textContent = '';
    await unlockVault();
  } else {
    $('lock-hint').textContent = 'Wrong password. Try again.';
  }
});

$('master-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('unlock-btn').click();
});

$('lock-btn').addEventListener('click', () => {
  showScreen('lock');
});

async function unlockVault() {
  entries = (await store.get('entries')) || [];
  showScreen('vault');
  renderEntries();
}

// ─── TABS ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    currentCat = t.dataset.cat;
    renderEntries();
  });
});

// ─── SEARCH ──────────────────────────────────────────────────────────
$('search-input').addEventListener('input', renderEntries);

// ─── RENDER ENTRIES ──────────────────────────────────────────────────
function renderEntries() {
  const list = $('entries-list');
  const q = $('search-input').value.toLowerCase();

  const filtered = entries.filter(e => {
    const catOk = currentCat === 'all' || e.type === currentCat;
    const q2 = q.trim();
    if (!q2) return catOk;
    const haystack = JSON.stringify(e).toLowerCase();
    return catOk && haystack.includes(q2);
  });

  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔐</div><p>No entries found.<br/>Tap <strong>+</strong> to add one.</p></div>`;
    return;
  }

  filtered.forEach(e => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    const emoji = e.type === 'password' ? '🔑' : e.type === 'card' ? '💳' : '📝';
    const name = e.type === 'password' ? e.site || 'Unnamed'
               : e.type === 'card' ? e.cardName || 'Card'
               : e.noteTitle || 'Note';
    const sub = e.type === 'password' ? (e.username || '—')
              : e.type === 'card' ? maskCard(e.cardNum)
              : (e.noteBody || '').slice(0, 40) || '—';

    card.innerHTML = `
      <div class="entry-emoji">${emoji}</div>
      <div class="entry-info">
        <div class="entry-name">${escHtml(name)}</div>
        <div class="entry-sub">${escHtml(sub)}</div>
      </div>
      <div class="entry-arrow">›</div>`;
    card.addEventListener('click', () => openDetail(e.id));
    list.appendChild(card);
  });
}

// ─── ADD / EDIT MODAL ────────────────────────────────────────────────
$('add-btn').addEventListener('click', () => openModal());
$('modal-close-btn').addEventListener('click', closeModal);
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });

function openModal(id = null) {
  editingId = id;
  const entry = id ? entries.find(e => e.id === id) : null;

  $('modal-title').textContent = id ? 'Edit Entry' : 'New Entry';
  $('delete-entry-btn').classList.toggle('hidden', !id);

  // type
  currentType = entry ? entry.type : 'password';
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === currentType);
  });
  switchFields(currentType);

  // populate
  if (entry) {
    if (entry.type === 'password') {
      $('p-site').value = entry.site || '';
      $('p-user').value = entry.username || '';
      $('p-pass').value = entry.password || '';
      $('p-url').value = entry.url || '';
      updateStrength(entry.password || '');
    } else if (entry.type === 'card') {
      $('c-name').value = entry.cardName || '';
      $('c-num').value = entry.cardNum || '';
      $('c-exp').value = entry.cardExp || '';
      $('c-cvv').value = entry.cardCvv || '';
      $('c-holder').value = entry.cardHolder || '';
    } else {
      $('n-title').value = entry.noteTitle || '';
      $('n-body').value = entry.noteBody || '';
    }
  } else {
    clearFields();
  }

  $('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
  clearFields();
  editingId = null;
}

function clearFields() {
  ['p-site','p-user','p-pass','p-url','c-name','c-num','c-exp','c-cvv','c-holder','n-title'].forEach(id => $(id) && ($(id).value = ''));
  $('n-body').value = '';
  $('strength-fill').style.width = '0%';
  $('strength-label').textContent = '';
}

document.querySelectorAll('.type-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentType = b.dataset.type;
    switchFields(currentType);
  });
});

function switchFields(type) {
  ['password','card','note'].forEach(t => {
    $(`fields-${t}`).classList.toggle('hidden', t !== type);
  });
}

// ─── SAVE ENTRY ───────────────────────────────────────────────────────
$('save-entry-btn').addEventListener('click', async () => {
  let entry = { id: editingId || uid(), type: currentType };

  if (currentType === 'password') {
    entry = { ...entry, site: $('p-site').value.trim(), username: $('p-user').value.trim(), password: $('p-pass').value, url: $('p-url').value.trim() };
    if (!entry.site && !entry.username) { alert('Enter at least a site name or username.'); return; }
  } else if (currentType === 'card') {
    entry = { ...entry, cardName: $('c-name').value.trim(), cardNum: $('c-num').value.trim(), cardExp: $('c-exp').value.trim(), cardCvv: $('c-cvv').value.trim(), cardHolder: $('c-holder').value.trim() };
    if (!entry.cardName) { alert('Enter a card name.'); return; }
  } else {
    entry = { ...entry, noteTitle: $('n-title').value.trim(), noteBody: $('n-body').value.trim() };
    if (!entry.noteTitle) { alert('Enter a note title.'); return; }
  }

  if (editingId) {
    const idx = entries.findIndex(e => e.id === editingId);
    if (idx !== -1) entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  await store.set('entries', entries);
  closeModal();
  renderEntries();
});

// ─── DELETE ───────────────────────────────────────────────────────────
$('delete-entry-btn').addEventListener('click', async () => {
  if (!confirm('Delete this entry?')) return;
  entries = entries.filter(e => e.id !== editingId);
  await store.set('entries', entries);
  closeModal();
  renderEntries();
});

// ─── DETAIL MODAL ─────────────────────────────────────────────────────
$('detail-close-btn').addEventListener('click', () => $('detail-overlay').classList.add('hidden'));
$('detail-overlay').addEventListener('click', e => { if (e.target === $('detail-overlay')) $('detail-overlay').classList.add('hidden'); });

$('edit-entry-btn').addEventListener('click', () => {
  $('detail-overlay').classList.add('hidden');
  openModal(detailEntryId);
});

function openDetail(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  detailEntryId = id;

  let name, rows = [];
  if (e.type === 'password') {
    name = e.site || 'Password';
    if (e.site) rows.push({ label: 'Site / App', val: e.site });
    if (e.username) rows.push({ label: 'Username', val: e.username, copy: true });
    if (e.password) rows.push({ label: 'Password', val: e.password, copy: true, mask: true });
    if (e.url) rows.push({ label: 'URL', val: e.url, copy: true });
  } else if (e.type === 'card') {
    name = e.cardName || 'Card';
    if (e.cardName) rows.push({ label: 'Card Name', val: e.cardName });
    if (e.cardNum) rows.push({ label: 'Card Number', val: formatCard(e.cardNum), copy: true });
    if (e.cardExp) rows.push({ label: 'Expiry', val: e.cardExp });
    if (e.cardCvv) rows.push({ label: 'CVV', val: e.cardCvv, copy: true, mask: true });
    if (e.cardHolder) rows.push({ label: 'Cardholder', val: e.cardHolder });
  } else {
    name = e.noteTitle || 'Note';
    if (e.noteTitle) rows.push({ label: 'Title', val: e.noteTitle });
    if (e.noteBody) rows.push({ label: 'Note', val: e.noteBody, copy: true });
  }

  $('detail-title').textContent = name;
  $('detail-body').innerHTML = rows.map(r => `
    <div class="detail-row">
      <label>${r.label}</label>
      <div class="detail-val">
        <span class="detail-text" data-mask="${r.mask ? '1' : '0'}" data-raw="${escAttr(r.val)}">
          ${r.mask ? '••••••••' : escHtml(r.val)}
        </span>
        <div style="display:flex;gap:5px;flex-shrink:0">
          ${r.mask ? `<button class="copy-btn reveal-btn" onclick="toggleReveal(this)">Show</button>` : ''}
          ${r.copy ? `<button class="copy-btn" onclick="copyVal(this, '${escAttr(r.val)}')">Copy</button>` : ''}
        </div>
      </div>
    </div>`).join('');

  $('detail-overlay').classList.remove('hidden');
}

window.toggleReveal = function(btn) {
  const row = btn.closest('.detail-val');
  const span = row.querySelector('.detail-text');
  const raw = span.dataset.raw;
  const masked = span.textContent.trim() === '••••••••';
  span.textContent = masked ? raw : '••••••••';
  btn.textContent = masked ? 'Hide' : 'Show';
};

window.copyVal = function(btn, val) {
  navigator.clipboard.writeText(val).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
  });
};

// ─── PASSWORD STRENGTH ───────────────────────────────────────────────
$('p-pass').addEventListener('input', e => updateStrength(e.target.value));

function updateStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const fill = $('strength-fill');
  const label = $('strength-label');
  const pct = Math.round((score / 5) * 100);
  fill.style.width = pct + '%';

  if (!pw) { fill.style.width = '0'; label.textContent = ''; return; }
  if (score <= 1) { fill.style.background = '#f87171'; label.textContent = 'Weak'; label.style.color = '#f87171'; }
  else if (score <= 3) { fill.style.background = '#fbbf24'; label.textContent = 'Fair'; label.style.color = '#fbbf24'; }
  else if (score === 4) { fill.style.background = '#34d399'; label.textContent = 'Strong'; label.style.color = '#34d399'; }
  else { fill.style.background = '#a78bfa'; label.textContent = 'Very Strong'; label.style.color = '#a78bfa'; }
}

// ─── PASSWORD GENERATOR ──────────────────────────────────────────────
$('gen-pass').addEventListener('click', () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}';
  const pw = Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  $('p-pass').value = pw;
  $('p-pass').type = 'text';
  updateStrength(pw);
  setTimeout(() => { $('p-pass').type = 'password'; }, 1500);
});

// ─── TOGGLE SHOW PASSWORD ────────────────────────────────────────────
$('toggle-pass').addEventListener('click', () => {
  const input = $('p-pass');
  input.type = input.type === 'password' ? 'text' : 'password';
});

// ─── CARD NUMBER FORMAT ──────────────────────────────────────────────
$('c-num').addEventListener('input', e => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 16);
  e.target.value = v.match(/.{1,4}/g)?.join(' ') || v;
});
$('c-exp').addEventListener('input', e => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 4);
  if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
  e.target.value = v;
});

// ─── UTILS ────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function simpleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function maskCard(num) {
  if (!num) return '—';
  const clean = num.replace(/\s/g, '');
  return '•••• •••• •••• ' + clean.slice(-4);
}
function formatCard(num) { return num; }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}
