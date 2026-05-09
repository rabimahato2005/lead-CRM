// public/js/app.js
'use strict';

/*STATE */
let currentFilter  = 'all';
let allLeads       = [];
let currentLeadId  = null;

/* BOOT */
document.addEventListener('DOMContentLoaded', async () => {
  const me = await api('/api/auth/me');
  if (me.loggedIn) {
    showApp(me.username);
  }

  // Allow Enter key on login
  document.getElementById('login-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});

/* AUTH */
async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  document.getElementById('login-err').textContent = '';

  try {
    const res = await api('/api/auth/login', 'POST', { username, password });
    if (res.success) {
      showApp(res.username);
    } else {
      document.getElementById('login-err').textContent = res.error || 'Login failed';
    }
  } catch (e) {
    document.getElementById('login-err').textContent = e.message || 'Login failed';
  }
}

async function doLogout() {
  await api('/api/auth/logout', 'POST');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-pass').value = '';
}

function showApp(username) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  const initial = (username || 'A')[0].toUpperCase();
  document.getElementById('admin-avatar').textContent = initial;
  document.getElementById('admin-name').textContent   = username || 'Admin';
  loadDashboard();
  loadLeads();
}

/* NAVIGATION */
function switchView(view, el, filter) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');

  const titles = { dashboard: 'Dashboard', leads: 'All Leads' };
  document.getElementById('topbar-title').textContent = titles[view] || 'LeadCRM';

  if (view === 'leads') {
    const status = filter || 'all';
    setFilter(status, document.querySelector(`.filter-btn[data-status="${status}"]`));
  }
  if (view === 'dashboard') loadDashboard();
}

/* DASHBOARD */
async function loadDashboard() {
  try {
    const data = await api('/api/stats');
    const t = data.totals;
    setText('s-new',       t.new_leads  || 0);
    setText('s-contacted', t.contacted  || 0);
    setText('s-converted', t.converted  || 0);
    setText('s-lost',      t.lost       || 0);
    setText('lead-count',  t.total      || 0);

    // Recent leads
    const rl = document.getElementById('recent-leads');
    rl.innerHTML = data.recent.length
      ? data.recent.map(l => `
          <div class="recent-row" onclick="openLeadDetail(${l.id})">
            <div>
              <div class="recent-name">${esc(l.name)}</div>
              <div class="recent-email">${esc(l.email)}</div>
            </div>
            ${statusBadge(l.status)}
          </div>`).join('')
      : '<p style="color:var(--subtle);font-size:13px;">No leads yet.</p>';

    // Sources bar chart
    const ls = document.getElementById('lead-sources');
    const maxCount = data.bySrc.reduce((m, s) => Math.max(m, s.count), 1);
    ls.innerHTML = data.bySrc.length
      ? data.bySrc.map(s => `
          <div class="source-bar">
            <div class="source-label"><span>${esc(s.source)}</span><span>${s.count}</span></div>
            <div class="source-track"><div class="source-fill" style="width:${(s.count/maxCount*100).toFixed(1)}%"></div></div>
          </div>`).join('')
      : '<p style="color:var(--subtle);font-size:13px;">No data.</p>';

    // Follow-ups
    const fu = document.getElementById('follow-ups');
    fu.innerHTML = data.followUps.length
      ? data.followUps.map(f => `
          <div class="recent-row" onclick="openLeadDetail(${f.id})">
            <div>
              <div class="recent-name">${esc(f.name)}</div>
              <div class="recent-email">${esc(f.content.substring(0,60))}…</div>
            </div>
            <span class="badge badge-contacted">📅 ${fmtDate(f.follow_up)}</span>
          </div>`).join('')
      : '<p style="color:var(--subtle);font-size:13px;">No upcoming follow-ups.</p>';
  } catch (e) { console.error(e); }
}

/* LEADS TABLE */
async function loadLeads() {
  try {
    allLeads = await api('/api/leads');
    renderLeads();
    setText('lead-count', allLeads.length);
  } catch (e) { console.error(e); }
}

function renderLeads() {
  const search = (document.getElementById('search-input').value || '').toLowerCase();
  const rows = allLeads.filter(l => {
    if (currentFilter !== 'all' && l.status !== currentFilter) return false;
    if (search && !`${l.name} ${l.email} ${l.company}`.toLowerCase().includes(search)) return false;
    return true;
  });

  const tbody = document.getElementById('leads-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">🔍</div><p>No leads found.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(l => `
    <tr onclick="openLeadDetail(${l.id})">
      <td>
        <div class="lead-name">${esc(l.name)}</div>
        <div class="lead-email">${esc(l.email)}</div>
      </td>
      <td class="lead-company">${esc(l.company || '—')}</td>
      <td style="font-size:12px;color:var(--muted);">${esc(l.source)}</td>
      <td>${statusBadge(l.status)}</td>
      <td>${priorityBadge(l.priority)}</td>
      <td style="font-size:12px;color:var(--muted);">${fmtDate(l.created_at)}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="openLeadDetail(${l.id})">View</button>
          <button class="btn btn-ghost btn-sm" onclick="quickStatus(${l.id}, event)">Status ▾</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterLeads() { renderLeads(); }

function setFilter(status, el) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderLeads();
}

/* Quick status dropdown */
function quickStatus(id, e) {
  // Remove any existing
  document.querySelectorAll('.qs-menu').forEach(m => m.remove());
  const statuses = ['new','contacted','converted','lost'];
  const menu = document.createElement('div');
  menu.className = 'qs-menu';
  Object.assign(menu.style, {
    position:'absolute', background:'var(--surface)', border:'1px solid var(--border2)',
    borderRadius:'8px', zIndex:500, padding:'6px', boxShadow:'var(--shadow)',
    minWidth:'140px'
  });
  statuses.forEach(s => {
    const btn = document.createElement('div');
    Object.assign(btn.style, {
      padding:'8px 12px', cursor:'pointer', borderRadius:'4px', fontSize:'13px',
      color:'var(--text)', display:'flex', alignItems:'center', gap:'8px'
    });
    btn.onmouseenter = () => btn.style.background = 'var(--card)';
    btn.onmouseleave = () => btn.style.background = '';
    btn.innerHTML = `${statusBadge(s)}`;
    btn.onclick = async () => {
      menu.remove();
      await api(`/api/leads/${id}/status`, 'PATCH', { status: s });
      toast('Status updated', 'success');
      await loadLeads();
      await loadDashboard();
    };
    menu.appendChild(btn);
  });

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = (rect.left  + window.scrollX)      + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
}

/* LEAD DETAIL MODAL */
async function openLeadDetail(id) {
  currentLeadId = id;
  openModal('modal-detail');
  document.getElementById('detail-body').innerHTML = '<p style="padding:20px;color:var(--muted);">Loading…</p>';

  try {
    const { lead, notes } = await api(`/api/leads/${id}`);
    document.getElementById('detail-lead-name').textContent = lead.name;
    document.getElementById('detail-edit-btn').onclick   = () => { closeModal('modal-detail'); openEditLead(lead); };
    document.getElementById('detail-delete-btn').onclick = () => deleteLead(id);

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-grid">
        <div class="detail-field"><label>Email</label><div class="value">${esc(lead.email)}</div></div>
        <div class="detail-field"><label>Phone</label><div class="value">${esc(lead.phone || '—')}</div></div>
        <div class="detail-field"><label>Company</label><div class="value">${esc(lead.company || '—')}</div></div>
        <div class="detail-field"><label>Source</label><div class="value">${esc(lead.source)}</div></div>
        <div class="detail-field"><label>Status</label><div class="value">${statusBadge(lead.status)}</div></div>
        <div class="detail-field"><label>Priority</label><div class="value">${priorityBadge(lead.priority)}</div></div>
        <div class="detail-field" style="grid-column:1/-1;"><label>Message</label><div class="value" style="line-height:1.7;">${esc(lead.message || '—')}</div></div>
        <div class="detail-field"><label>Created</label><div class="value">${fmtDate(lead.created_at)}</div></div>
        <div class="detail-field"><label>Last Updated</label><div class="value">${fmtDate(lead.updated_at)}</div></div>
      </div>

      <div class="notes-section">
        <h3>📝 Notes & Follow-ups (${notes.length})</h3>
        <div id="notes-list">
          ${notes.length ? notes.map(n => noteHTML(n)).join('') : '<p style="color:var(--subtle);font-size:13px;">No notes yet.</p>'}
        </div>

        <div style="margin-top:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;">
          <div class="form-group">
            <label>Add Note</label>
            <textarea id="new-note-content" rows="3" placeholder="Write a note…"></textarea>
          </div>
          <div class="form-group">
            <label>Follow-up Date (optional)</label>
            <input type="date" id="new-note-followup" />
          </div>
          <button class="btn btn-primary btn-sm" onclick="addNote(${id})">+ Add Note</button>
        </div>
      </div>`;
  } catch (e) {
    document.getElementById('detail-body').innerHTML = `<p style="color:var(--red);padding:20px;">Failed to load lead.</p>`;
  }
}

function noteHTML(n) {
  return `
    <div class="note-item" id="note-${n.id}">
      <button class="note-del" onclick="deleteNote(${n.id})">✕</button>
      <div class="note-meta">By ${esc(n.username || 'Admin')} · ${fmtDate(n.created_at)}</div>
      <div class="note-content">${esc(n.content)}</div>
      ${n.follow_up ? `<div class="note-followup">📅 Follow-up: ${fmtDate(n.follow_up)}</div>` : ''}
    </div>`;
}

async function addNote(leadId) {
  const content   = document.getElementById('new-note-content').value.trim();
  const follow_up = document.getElementById('new-note-followup').value || null;
  if (!content) return toast('Note content required', 'error');
  try {
    const res = await api(`/api/leads/${leadId}/notes`, 'POST', { content, follow_up });
    if (res.success) {
      toast('Note added', 'success');
      await openLeadDetail(leadId);
    }
  } catch (e) { toast('Failed to add note', 'error'); }
}

async function deleteNote(noteId) {
  if (!confirm('Delete this note?')) return;
  await api(`/api/notes/${noteId}`, 'DELETE');
  toast('Note deleted', 'success');
  document.getElementById(`note-${noteId}`)?.remove();
}

/* ADD / EDIT LEAD */
function openAddLead() {
  document.getElementById('modal-lead-title').textContent = 'Add New Lead';
  document.getElementById('lead-id').value = '';
  ['name','email','phone','company','message'].forEach(f => document.getElementById(`f-${f}`).value = '');
  document.getElementById('f-source').value   = 'Website';
  document.getElementById('f-status').value   = 'new';
  document.getElementById('f-priority').value = 'medium';
  openModal('modal-lead');
}

function openEditLead(lead) {
  document.getElementById('modal-lead-title').textContent = 'Edit Lead';
  document.getElementById('lead-id').value    = lead.id;
  document.getElementById('f-name').value     = lead.name;
  document.getElementById('f-email').value    = lead.email;
  document.getElementById('f-phone').value    = lead.phone || '';
  document.getElementById('f-company').value  = lead.company || '';
  document.getElementById('f-source').value   = lead.source;
  document.getElementById('f-status').value   = lead.status;
  document.getElementById('f-priority').value = lead.priority;
  document.getElementById('f-message').value  = lead.message || '';
  openModal('modal-lead');
}

async function saveLead() {
  const id      = document.getElementById('lead-id').value;
  const payload = {
    name    : document.getElementById('f-name').value.trim(),
    email   : document.getElementById('f-email').value.trim(),
    phone   : document.getElementById('f-phone').value.trim(),
    company : document.getElementById('f-company').value.trim(),
    source  : document.getElementById('f-source').value,
    status  : document.getElementById('f-status').value,
    priority: document.getElementById('f-priority').value,
    message : document.getElementById('f-message').value.trim(),
  };
  if (!payload.name || !payload.email) return toast('Name and email are required', 'error');

  try {
    if (id) {
      await api(`/api/leads/${id}`, 'PUT', payload);
      toast('Lead updated', 'success');
    } else {
      await api('/api/leads', 'POST', payload);
      toast('Lead added', 'success');
    }
    closeModal('modal-lead');
    await loadLeads();
    await loadDashboard();
  } catch (e) { toast('Failed to save lead', 'error'); }
}

async function deleteLead(id) {
  if (!confirm('Delete this lead and all its notes?')) return;
  await api(`/api/leads/${id}`, 'DELETE');
  toast('Lead deleted', 'success');
  closeModal('modal-detail');
  await loadLeads();
  await loadDashboard();
}

/* HELPERS */
async function api(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}

function statusBadge(s) {
  const map = { new:'🆕 New', contacted:'📞 Contacted', converted:'✅ Converted', lost:'❌ Lost' };
  return `<span class="badge badge-${s}">${map[s] || s}</span>`;
}

function priorityBadge(p) {
  const map = { high:'🔴 High', medium:'🟡 Medium', low:'⬜ Low' };
  return `<span class="badge badge-${p}">${map[p] || p}</span>`;
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> ${esc(msg)}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3100);
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});
