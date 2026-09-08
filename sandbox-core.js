/* ============================================================================
   sandbox-core.js — client-only demo mode for the trial sandboxes.
   No Supabase, no auth, no network calls. Everything lives in localStorage
   scoped to window.SANDBOX_ORG, so Lead Pipeline / Lead Suite / Meridian
   sandboxes never collide with each other in the same browser.

   Each sandbox HTML file sets, before loading this script:
     window.SANDBOX_ORG     e.g. 'lead_pipeline' | 'lead_suite' | 'meridian'
     window.TRIAL_DAYS      how many days the sandbox stays usable
     window.STAGES          [{key,label}, ...] board columns
     window.SEED_LEADS      starter fake leads shown on first visit
     window.SIGNUP_URL      where "Subscribe" sends them (the real product page)
   ============================================================================ */

const byId = id => document.getElementById(id);
const startKey  = () => `srs_sandbox_start_${window.SANDBOX_ORG}`;
const leadsKey  = () => `srs_sandbox_leads_${window.SANDBOX_ORG}`;

function daysLeft(){
  let start = localStorage.getItem(startKey());
  if(!start){
    start = Date.now();
    localStorage.setItem(startKey(), String(start));
  }
  const elapsedMs = Date.now() - Number(start);
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(window.TRIAL_DAYS - elapsedDays));
}

function loadLeads(){
  const raw = localStorage.getItem(leadsKey());
  if(raw){ try { return JSON.parse(raw); } catch(e) { /* fall through to reseed */ } }
  const seeded = window.SEED_LEADS.map((l, i) => ({ id: 'demo-' + i, ...l }));
  localStorage.setItem(leadsKey(), JSON.stringify(seeded));
  return seeded;
}
function saveLeads(leads){ localStorage.setItem(leadsKey(), JSON.stringify(leads)); }

let leads = [];

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderStats(){
  const el = byId('stats');
  if(!el) return;
  const open = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost');
  const value = open.reduce((s,l)=>s+Number(l.value||0),0);
  el.innerHTML = `
    <div class="stat"><div class="num">${leads.length}</div><div class="lbl">Total leads</div></div>
    <div class="stat"><div class="num">${open.filter(l=>l.temp==='hot').length}</div><div class="lbl">Hot</div></div>
    <div class="stat"><div class="num">${open.filter(l=>l.temp==='warm').length}</div><div class="lbl">Warm</div></div>
    <div class="stat"><div class="num">${open.filter(l=>l.temp==='cold').length}</div><div class="lbl">Cold</div></div>
    <div class="stat"><div class="num">${leads.filter(l=>l.stage==='won').length}</div><div class="lbl">Won</div></div>
    <div class="stat"><div class="num">R${value.toLocaleString()}</div><div class="lbl">Open pipeline value</div></div>
  `;
}

function renderBoard(){
  const board = byId('board');
  if(!board) return;
  renderStats();
  const q = (byId('search-input')?.value || '').trim().toLowerCase();
  let vis = leads;
  if(q) vis = vis.filter(l => l.name.toLowerCase().includes(q) || (l.contact||'').toLowerCase().includes(q));

  board.innerHTML = '';
  window.STAGES.forEach(stage => {
    const col = document.createElement('div');
    col.className = 'column';
    col.dataset.stage = stage.key;
    col.ondragover = (e)=>{ e.preventDefault(); col.classList.add('dragover'); };
    col.ondragleave = ()=> col.classList.remove('dragover');
    col.ondrop = (e)=>{
      e.preventDefault(); col.classList.remove('dragover');
      const id = e.dataTransfer.getData('text/plain');
      const lead = leads.find(l => l.id === id);
      if(lead){ lead.stage = stage.key; saveLeads(leads); renderBoard(); }
    };
    const stageLeads = vis.filter(l => l.stage === stage.key);
    const cardsHtml = stageLeads.length === 0
      ? `<div class="empty-col">No leads here yet</div>`
      : stageLeads.map(l => `
          <div class="lead-card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${l.id}')">
            <div class="card-top">
              <div class="avatar ${l.temp}"></div>
              <div><div class="name">${escapeHtml(l.name)}</div><div class="contact">${escapeHtml(l.contact||'No contact info')}</div></div>
            </div>
            <div class="card-bottom">
              <span class="tag ${l.temp}">${l.temp}</span>
              <span class="value">R${Number(l.value||0).toLocaleString()}</span>
            </div>
          </div>`).join('');
    col.innerHTML = `<h3>${stage.label} <span class="count">${stageLeads.length}</span></h3>${cardsHtml}`;
    board.appendChild(col);
  });
}

function addDemoLead(){
  const name = byId('lead-name').value.trim();
  if(!name){ alert('Please add a name for this lead.'); return; }
  leads.unshift({
    id: 'demo-' + Date.now(),
    name,
    contact: byId('lead-contact').value.trim(),
    value: Number(byId('lead-value').value) || 0,
    temp: byId('lead-temp').value,
    stage: window.STAGES[0].key
  });
  saveLeads(leads);
  byId('lead-modal').classList.remove('open');
  byId('lead-name').value = '';
  byId('lead-contact').value = '';
  byId('lead-value').value = '';
  renderBoard();
}

function renderTrialBanner(){
  const left = daysLeft();
  const banner = byId('trial-banner');
  if(banner) banner.textContent = left > 0
    ? `Sandbox mode — ${left} day${left === 1 ? '' : 's'} left in your free trial.`
    : `Your trial has ended.`;

  if(left <= 0){
    byId('app')?.classList.remove('visible');
    byId('expired-screen')?.classList.add('visible');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  byId('signup-cta-1') && (byId('signup-cta-1').href = window.SIGNUP_URL);
  byId('signup-cta-2') && (byId('signup-cta-2').href = window.SIGNUP_URL);

  renderTrialBanner();
  if(daysLeft() <= 0) return;

  leads = loadLeads();
  byId('app')?.classList.add('visible');
  renderBoard();

  byId('add-lead-btn')?.addEventListener('click', () => byId('lead-modal').classList.add('open'));
  byId('lead-cancel-btn')?.addEventListener('click', () => byId('lead-modal').classList.remove('open'));
  byId('lead-save-btn')?.addEventListener('click', addDemoLead);
  byId('search-input')?.addEventListener('input', renderBoard);
});
