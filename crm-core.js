/* ============================================================================
   crm-core.js — shared brain for Meridian / Lead Suite / Lead Pipeline
   ----------------------------------------------------------------------------
   Each HTML file sets these globals BEFORE loading this script:
     window.SUPABASE_URL
     window.SUPABASE_ANON_KEY
     window.ORG            e.g. 'meridian' | 'lead_suite' | 'lead_pipeline'
     window.STAGES         [{key,label}, ...]  board columns in order
     window.BRAND_FALLBACK {brandName, tagline}

   Required DOM ids — see SETUP.md for the full contract. This file only
   *behaves*; all visual theming lives in each HTML file's own CSS.
   ============================================================================ */

let sb, currentUser = null, leads = [], orgUsers = [], siteSettings = null;
let editingLeadId = null;

function initSupabase(){
  sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

/* ---------------------------------------------------------------- helpers */

const PERM = {
  creator: { manageUsers:true, assignRoles:true, adminPortal:true, editAnyLead:true, editOwnCredentials:true, siteSettings:true },
  admin:   { manageUsers:true, assignRoles:true, adminPortal:true, editAnyLead:true, editOwnCredentials:true, siteSettings:false },
  mid:     { manageUsers:false, assignRoles:false, adminPortal:false, editAnyLead:true, editOwnCredentials:true, siteSettings:false },
  agent:   { manageUsers:false, assignRoles:false, adminPortal:false, editAnyLead:false, editOwnCredentials:false, siteSettings:false }
};
function perms(){ return PERM[currentUser?.role] || PERM.agent; }

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function initials(name){
  return (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()).join('');
}
function avatarHtml(user){
  if(user && user.avatar_url) return `<img src="${user.avatar_url}" alt="">`;
  return escapeHtml(initials(user?.name));
}
function byId(id){ return document.getElementById(id); }
function show(id, on){ const el = byId(id); if(el) el.style.display = on ? '' : 'none'; }

/* ------------------------------------------------------------------ init */

document.addEventListener('DOMContentLoaded', async () => {
  initSupabase();
  wireStaticEvents();

  const { data: { session } } = await sb.auth.getSession();
  if(session){
    await afterLogin();
  } else {
    showAuthScreen('login');
  }
});

function wireStaticEvents(){
  wirePasswordToggles();
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  byId('login-submit')?.addEventListener('click', handleLogin);
  byId('signup-submit')?.addEventListener('click', handleSignup);
  byId('show-signup')?.addEventListener('click', (e)=>{ e.preventDefault(); showAuthScreen('signup'); });
  byId('show-login')?.addEventListener('click', (e)=>{ e.preventDefault(); showAuthScreen('login'); });
  byId('show-forgot')?.addEventListener('click', (e)=>{ e.preventDefault(); showAuthScreen('forgot'); });
  byId('show-login-from-forgot')?.addEventListener('click', (e)=>{ e.preventDefault(); showAuthScreen('login'); });
  byId('forgot-submit')?.addEventListener('click', handleForgotPassword);
  byId('logout-btn')?.addEventListener('click', handleLogout);
  byId('add-lead-btn')?.addEventListener('click', () => openLeadModal(null));
  byId('lead-save-btn')?.addEventListener('click', saveLead);
  byId('lead-cancel-btn')?.addEventListener('click', closeLeadModal);
  byId('lead-delete-btn')?.addEventListener('click', deleteEditingLead);
  byId('search-input')?.addEventListener('input', () => renderBoard());
  byId('profile-avatar-input')?.addEventListener('change', handleAvatarUpload);
  byId('profile-save-btn')?.addEventListener('click', saveProfile);
  byId('team-invite-btn')?.addEventListener('click', () => sendInvite('team'));
  byId('admin-invite-btn')?.addEventListener('click', () => sendInvite('admin'));
  byId('site-settings-save-btn')?.addEventListener('click', saveSiteSettings);
  byId('user-detail-close')?.addEventListener('click', () => show('user-detail-modal', false));
}

function wirePasswordToggles(){
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = byId(btn.dataset.target);
      if(!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}

function showAuthScreen(which){
  show('login-panel', which === 'login');
  show('signup-panel', which === 'signup');
  show('forgot-panel', which === 'forgot');
  const le = byId('login-error'); if(le) le.style.display = 'none';
  const se = byId('signup-error'); if(se) se.style.display = 'none';
  const fe = byId('forgot-error'); if(fe) fe.style.display = 'none';
}

async function handleForgotPassword(){
  const email = byId('forgot-email').value.trim();
  const errEl = byId('forgot-error');
  errEl.style.color = '';
  errEl.style.display = 'none';
  if(!email){
    errEl.textContent = 'Please enter your email.';
    errEl.style.display = 'block';
    return;
  }
  // Shared reset-password.html lives next to this file regardless of which
  // product/repo subpath it's served from.
  const redirectTo = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'reset-password.html';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if(error){ errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  errEl.style.color = 'inherit';
  errEl.textContent = "If that email has an account, a reset link is on its way — check your inbox.";
  errEl.style.display = 'block';
}

/* ------------------------------------------------------------------ auth */

async function handleLogin(){
  const email = byId('login-email').value.trim();
  const password = byId('login-password').value;
  const errEl = byId('login-error');
  errEl.style.display = 'none';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error){ errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  await afterLogin();
}

async function handleSignup(){
  const name = byId('signup-name').value.trim();
  const email = byId('signup-email').value.trim();
  const password = byId('signup-password').value;
  const businessName = byId('signup-business-name')?.value.trim() || '';
  const errEl = byId('signup-error');
  errEl.style.display = 'none';
  if(!name || !email){
    errEl.textContent = 'Please fill in your name and email.';
    errEl.style.display = 'block';
    return;
  }
  const strongEnough = password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
  if(!strongEnough){
    errEl.textContent = 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.';
    errEl.style.display = 'block';
    return;
  }
  const { error } = await sb.auth.signUp({
    email, password,
    options: { data: { org: window.ORG, name, business_name: businessName } }
  });
  if(error){ errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  const { data: { session } } = await sb.auth.getSession();
  if(session){ await afterLogin(); }
  else {
    errEl.style.color = 'inherit';
    errEl.textContent = 'Account created — check your email to confirm, then log in.';
    errEl.style.display = 'block';
    showAuthScreen('login');
  }
}

async function handleLogout(){
  await sb.auth.signOut();
  currentUser = null; leads = []; orgUsers = [];
  byId('app')?.classList.remove('visible');
  showAuthScreen('login');
}

async function afterLogin(){
  const { data: authUser } = await sb.auth.getUser();
  if(!authUser?.user){ showAuthScreen('login'); return; }

  const { data: profile, error } = await sb.from('profiles')
    .select('*, businesses(product)')
    .eq('id', authUser.user.id)
    .single();
  if(error || !profile){
    await sb.auth.signOut();
    showAuthScreen('login');
    const errEl = byId('login-error');
    if(errEl){ errEl.textContent = "We couldn't find an account for that login."; errEl.style.display = 'block'; }
    return;
  }

  if(profile.is_site_admin){
    // Site admins aren't tied to one product — look up whichever business
    // belongs to THIS page's product and operate as its creator.
    const { data: targetBiz, error: bizErr } = await sb.from('businesses')
      .select('id').eq('product', window.ORG).limit(1).single();
    if(bizErr || !targetBiz){
      await sb.auth.signOut();
      showAuthScreen('login');
      const errEl = byId('login-error');
      if(errEl){ errEl.textContent = `No business found yet for ${window.ORG}.`; errEl.style.display = 'block'; }
      return;
    }
    currentUser = { ...profile, role: 'creator', business_id: targetBiz.id, isSiteAdmin: true };
  } else if(profile.businesses?.product !== window.ORG){
    // This account's business is on a different product — wrong page for this login.
    await sb.auth.signOut();
    showAuthScreen('login');
    const errEl = byId('login-error');
    if(errEl){ errEl.textContent = "This login belongs to a different CRM — please use that product's page instead."; errEl.style.display = 'block'; }
    return;
  } else {
    currentUser = profile;
  }

  sb.rpc('touch_last_login');

  byId('app')?.classList.add('visible');
  document.body.classList.remove(); // no-op, keeps consistent hook point
  applyRoleVisibility();
  await fetchOrgUsers();
  await fetchSiteSettings();
  await fetchLeads();
  renderUserChip();
  switchView('board');
  subscribeRealtime();
}

function applyRoleVisibility(){
  const p = perms();
  document.querySelectorAll('.tab[data-view="team"]').forEach(el => el.style.display = (currentUser.role === 'mid') ? '' : 'none');
  document.querySelectorAll('.tab[data-view="admin"]').forEach(el => el.style.display = p.adminPortal ? '' : 'none');
  show('creator-settings-panel', p.siteSettings);
}

/* -------------------------------------------------------------- fetching */

async function fetchLeads(){
  // RLS scopes this to the caller's own business automatically.
  const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending:false });
  if(!error) leads = data || [];
  renderBoard();
  renderProfile();
}

async function fetchOrgUsers(){
  const { data, error } = await sb.from('profiles').select('*').order('name');
  if(!error) orgUsers = data || [];
  renderTeam();
  renderAdmin();
}

async function fetchSiteSettings(){
  const { data } = await sb.from('site_settings').select('*').eq('business_id', currentUser.business_id).single();
  siteSettings = data || { brand_name: window.BRAND_FALLBACK?.brandName || 'CRM', tagline: window.BRAND_FALLBACK?.tagline || '' };
  applySiteSettings();
}

function applySiteSettings(){
  const nameEl = byId('brand-name-slot');
  const tagEl = byId('brand-tagline-slot');
  if(nameEl) nameEl.textContent = siteSettings.brand_name;
  if(tagEl) tagEl.textContent = siteSettings.tagline || '';
  if(siteSettings.accent) document.documentElement.style.setProperty('--accent-override', siteSettings.accent);
}

let realtimeChannel = null;
function subscribeRealtime(){
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('business-' + currentUser.business_id)
    .on('postgres_changes', { event:'*', schema:'public', table:'leads', filter:`business_id=eq.${currentUser.business_id}` }, fetchLeads)
    .on('postgres_changes', { event:'*', schema:'public', table:'profiles', filter:`business_id=eq.${currentUser.business_id}` }, fetchOrgUsers)
    .subscribe();
}

/* -------------------------------------------------------------- switcher */

function switchView(name){
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if(name === 'board') renderBoard();
  if(name === 'profile') renderProfile();
  if(name === 'team') renderTeam();
  if(name === 'admin') renderAdmin();
}

/* ---------------------------------------------------------------- board */

function visibleLeads(){
  if(currentUser.role === 'agent') return leads.filter(l => l.assigned_to === currentUser.id);
  return leads;
}

function renderStats(){
  const el = byId('stats');
  if(!el) return;
  const vis = visibleLeads();
  const open = vis.filter(l => l.stage !== 'won' && l.stage !== 'lost');
  const hot = open.filter(l=>l.temp==='hot').length;
  const warm = open.filter(l=>l.temp==='warm').length;
  const cold = open.filter(l=>l.temp==='cold').length;
  const won = vis.filter(l=>l.stage==='won').length;
  const value = open.reduce((s,l)=>s+Number(l.value||0),0);
  el.innerHTML = `
    <div class="stat"><div class="num">${vis.length}</div><div class="lbl">Total leads</div></div>
    <div class="stat"><div class="num">${hot}</div><div class="lbl">Hot</div></div>
    <div class="stat"><div class="num">${warm}</div><div class="lbl">Warm</div></div>
    <div class="stat"><div class="num">${cold}</div><div class="lbl">Cold</div></div>
    <div class="stat"><div class="num">${won}</div><div class="lbl">Won</div></div>
    <div class="stat"><div class="num">R${value.toLocaleString()}</div><div class="lbl">Open pipeline value</div></div>
  `;
}

function renderBoard(){
  const board = byId('board');
  if(!board) return;
  renderStats();
  const q = (byId('search-input')?.value || '').trim().toLowerCase();
  let vis = visibleLeads();
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
      moveLead(id, stage.key);
    };
    const stageLeads = vis.filter(l => l.stage === stage.key);
    const cardsHtml = stageLeads.length === 0
      ? `<div class="empty-col">No leads here yet</div>`
      : stageLeads.map(l => {
          const owner = orgUsers.find(u => u.id === l.assigned_to);
          const canDrag = currentUser.role !== 'agent' || l.assigned_to === currentUser.id;
          return `
          <div class="lead-card" ${canDrag?'draggable="true"':''} ondragstart="event.dataTransfer.setData('text/plain','${l.id}')" onclick="openLeadModal('${l.id}')">
            <div class="card-top">
              <div class="avatar ${l.temp}">${owner ? avatarHtml(owner) : ''}</div>
              <div><div class="name">${escapeHtml(l.name)}</div><div class="contact">${escapeHtml(l.contact||'No contact info')}</div></div>
            </div>
            <div class="card-bottom">
              <span class="tag ${l.temp}">${l.temp}</span>
              <span class="value">R${Number(l.value||0).toLocaleString()}</span>
              <span class="assignee">${owner ? escapeHtml(owner.name) : 'Unassigned'}</span>
            </div>
          </div>`;
        }).join('');
    col.innerHTML = `<h3>${stage.label} <span class="count">${stageLeads.length}</span></h3>${cardsHtml}`;
    board.appendChild(col);
  });
}

async function moveLead(id, newStage){
  const { error } = await sb.from('leads').update({ stage: newStage }).eq('id', id);
  if(error){ alert(error.message); return; }
  fetchLeads();
}

function openLeadModal(id){
  editingLeadId = id;
  const lead = id ? leads.find(l => l.id === id) : null;
  byId('lead-name').value = lead?.name || '';
  byId('lead-contact').value = lead?.contact || '';
  byId('lead-value').value = lead?.value || '';
  byId('lead-temp').value = lead?.temp || 'warm';
  byId('lead-stage').value = lead?.stage || window.STAGES[0].key;

  const assignedSel = byId('lead-assigned');
  if(currentUser.role === 'agent'){
    assignedSel.innerHTML = `<option value="${currentUser.id}">${escapeHtml(currentUser.name)} (you)</option>`;
    assignedSel.disabled = true;
  } else {
    assignedSel.disabled = false;
    assignedSel.innerHTML = orgUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');
    assignedSel.value = lead?.assigned_to || currentUser.id;
  }
  show('lead-delete-btn', !!lead && perms().editAnyLead);
  byId('lead-modal').classList.add('open');
}
function closeLeadModal(){ byId('lead-modal').classList.remove('open'); editingLeadId = null; }

async function saveLead(){
  const name = byId('lead-name').value.trim();
  if(!name){ alert('Please add a name for this lead.'); return; }
  const payload = {
    name,
    contact: byId('lead-contact').value.trim(),
    value: Number(byId('lead-value').value) || 0,
    temp: byId('lead-temp').value,
    stage: byId('lead-stage').value,
    assigned_to: byId('lead-assigned').value
  };
  let error;
  if(editingLeadId){
    ({ error } = await sb.from('leads').update(payload).eq('id', editingLeadId));
  } else {
    payload.created_by = currentUser.id;
    ({ error } = await sb.from('leads').insert(payload));
  }
  if(error){ alert(error.message); return; }
  closeLeadModal();
  fetchLeads();
}

async function deleteEditingLead(){
  if(!editingLeadId) return;
  if(!confirm('Delete this lead? This cannot be undone.')) return;
  const { error } = await sb.from('leads').delete().eq('id', editingLeadId);
  if(error){ alert(error.message); return; }
  closeLeadModal();
  fetchLeads();
}

/* -------------------------------------------------------------- profile */

function renderUserChip(){
  byId('current-user-name') && (byId('current-user-name').textContent = currentUser.name + (currentUser.isSiteAdmin ? ' (Site Admin)' : ''));
  const badge = byId('current-user-role-badge');
  if(badge){ badge.textContent = currentUser.isSiteAdmin ? 'site admin' : currentUser.role; badge.className = 'role-badge ' + (currentUser.isSiteAdmin ? 'creator' : currentUser.role); }
  const av = byId('current-user-avatar'); if(av) av.innerHTML = avatarHtml(currentUser);
}

function renderProfile(){
  if(!currentUser || !byId('view-profile')) return;
  byId('profile-avatar-lg').innerHTML = avatarHtml(currentUser);
  byId('profile-name-input').value = currentUser.name;
  byId('profile-username-input').value = currentUser.username;
  byId('profile-username-input').disabled = !perms().editOwnCredentials;
  show('profile-username-note', !perms().editOwnCredentials);
  byId('profile-password-input').value = '';
  byId('profile-password-input').disabled = !perms().editOwnCredentials;
  show('profile-password-note', !perms().editOwnCredentials);
  const badge = byId('profile-role-badge');
  if(badge){ badge.textContent = currentUser.role; badge.className = 'role-badge ' + currentUser.role; }

  const mine = leads.filter(l => l.assigned_to === currentUser.id);
  const list = byId('profile-my-leads');
  if(list){
    list.innerHTML = mine.length === 0
      ? '<div class="empty-col">No leads assigned to you yet</div>'
      : mine.map(l => `<div class="my-leads-row"><span>${escapeHtml(l.name)}</span><span class="role-badge ${l.temp==='hot'?'admin':l.temp==='warm'?'mid':'agent'}">${escapeHtml(l.stage)}</span></div>`).join('');
  }
}

function handleAvatarUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size-w)/2, (size-h)/2, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      byId('profile-avatar-lg').innerHTML = `<img src="${dataUrl}">`;
      byId('profile-avatar-lg').dataset.pending = dataUrl;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveProfile(){
  const updates = { name: byId('profile-name-input').value.trim() || currentUser.name };
  const pendingAvatar = byId('profile-avatar-lg').dataset.pending;
  if(pendingAvatar) updates.avatar_url = pendingAvatar;

  if(perms().editOwnCredentials){
    const newUsername = byId('profile-username-input').value.trim();
    if(newUsername) updates.username = newUsername;
  }

  const { error } = await sb.from('profiles').update(updates).eq('id', currentUser.id);
  if(error){ alert(error.message); return; }

  if(perms().editOwnCredentials){
    const newPassword = byId('profile-password-input').value;
    if(newPassword){
      if(newPassword.length < 6){ alert('Password must be at least 6 characters.'); return; }
      const { error: pwErr } = await sb.auth.updateUser({ password: newPassword });
      if(pwErr){ alert(pwErr.message); return; }
    }
  }

  delete byId('profile-avatar-lg').dataset.pending;
  currentUser = { ...currentUser, ...updates };
  renderUserChip();
  await fetchOrgUsers();
  alert('Profile updated.');
}

/* ----------------------------------------------------------------- team */

function renderTeam(){
  const body = byId('team-table-body');
  if(!body || currentUser.role !== 'mid') return;
  const agents = orgUsers.filter(u => u.role === 'agent');
  body.innerHTML = agents.map(u => {
    const count = leads.filter(l => l.assigned_to === u.id).length;
    return `<tr>
      <td>${avatarHtml(u)} ${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${count}</td>
      <td>${u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
      <td>
        <button class="small-btn" onclick="openUserDetail('${u.id}')">View</button>
        <button class="small-btn" onclick="resetPassword('${u.id}')">Reset password</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">No agents yet — invite one below.</td></tr>';
}

async function sendInvite(scope){
  const prefix = scope === 'team' ? 'team' : 'admin';
  const name = byId(prefix + '-invite-name').value.trim();
  const email = byId(prefix + '-invite-email').value.trim();
  const role = scope === 'team' ? 'agent' : byId('admin-invite-role').value;
  if(!name || !email){ alert('Please fill in name and email.'); return; }
  const { error } = await sb.from('invites').insert({ name, email, role, invited_by: currentUser.id });
  if(error){ alert(error.message); return; }
  byId(prefix + '-invite-name').value = '';
  byId(prefix + '-invite-email').value = '';
  alert(`Invite sent. Ask ${name} to open the sign-up page and register with ${email} — they'll land in the ${role} role automatically.`);
}

async function resetPassword(userId){
  const newPw = Math.random().toString(36).slice(-8);
  const { error } = await sb.rpc('admin_set_password', { target_id: userId, new_password: newPw });
  if(error){ alert(error.message); return; }
  alert(`New temporary password: ${newPw}\n\n(Share this with them directly — it won't be shown again.)`);
}

/* ---------------------------------------------------------------- admin */

function renderAdmin(){
  const body = byId('admin-table-body');
  if(!body || !perms().adminPortal) return;
  body.innerHTML = orgUsers.map(u => {
    const count = leads.filter(l => l.assigned_to === u.id).length;
    const roleOptions = ['admin','mid','agent'].map(r => `<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`).join('');
    const roleCell = (u.role === 'creator')
      ? `<span class="role-badge creator">creator</span>`
      : `<select class="role-select" onchange="changeRole('${u.id}', this.value)">${roleOptions}</select>`;
    return `<tr>
      <td>${avatarHtml(u)} ${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleCell}</td>
      <td>${count}</td>
      <td>${u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
      <td>
        <button class="small-btn" onclick="openUserDetail('${u.id}')">View</button>
        <button class="small-btn" onclick="resetPassword('${u.id}')">Reset password</button>
        ${u.role !== 'creator' ? `<button class="small-btn danger" onclick="removeUser('${u.id}')">Remove</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  if(byId('site-brand-name')){
    byId('site-brand-name').value = siteSettings.brand_name || '';
    byId('site-tagline').value = siteSettings.tagline || '';
    byId('site-accent').value = siteSettings.accent || '#2F6F62';
    byId('site-toggle-team').checked = siteSettings.show_team_tab !== false;
    byId('site-toggle-admin').checked = siteSettings.show_admin_tab !== false;
  }
}

async function changeRole(userId, newRole){
  const { error } = await sb.from('profiles').update({ role: newRole }).eq('id', userId);
  if(error){ alert(error.message); fetchOrgUsers(); return; }
  fetchOrgUsers();
}

async function removeUser(userId){
  if(userId === currentUser.id){ alert("You can't remove your own account while logged in."); return; }
  if(!confirm('Remove this team member? This cannot be undone.')) return;
  const { error } = await sb.from('profiles').delete().eq('id', userId);
  if(error){ alert(error.message); return; }
  fetchOrgUsers();
}

function openUserDetail(userId){
  const user = orgUsers.find(u => u.id === userId);
  if(!user) return;
  const assigned = leads.filter(l => l.assigned_to === userId);
  const p = PERM[user.role] || PERM.agent;
  const permLabels = {
    manageUsers:'Add/remove users', assignRoles:'Assign roles', adminPortal:'Access admin portal',
    editAnyLead:'Edit or delete any lead', editOwnCredentials:'Change own username/password', siteSettings:'Edit site settings'
  };
  byId('user-detail-body').innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; margin-bottom:16px;">
      <div class="profile-avatar-lg" style="width:56px;height:56px;font-size:18px;">${avatarHtml(user)}</div>
      <div><div style="font-weight:700;">${escapeHtml(user.name)}</div><span class="role-badge ${user.role}">${user.role}</span></div>
    </div>
    <div class="user-detail-grid">
      <div class="kv"><div class="k">Username</div><div class="v">${escapeHtml(user.username)}</div></div>
      <div class="kv"><div class="k">Email</div><div class="v">${escapeHtml(user.email)}</div></div>
      <div class="kv"><div class="k">Last login</div><div class="v">${user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}</div></div>
      <div class="kv"><div class="k">Leads assigned</div><div class="v">${assigned.length}</div></div>
    </div>
    <p class="section-label">Permission limits</p>
    <div class="perm-list">${Object.entries(permLabels).map(([k,label]) => `<div><span class="${p[k]?'yes':'no'}">${p[k]?'✓':'✕'}</span> ${label}</div>`).join('')}</div>
    ${assigned.length ? `<p class="section-label">Work assigned</p>${assigned.map(l => `<div class="my-leads-row"><span>${escapeHtml(l.name)}</span><span>${escapeHtml(l.stage)}</span></div>`).join('')}` : ''}
  `;
  show('user-detail-modal', true);
}

async function saveSiteSettings(){
  const updates = {
    brand_name: byId('site-brand-name').value.trim() || siteSettings.brand_name,
    tagline: byId('site-tagline').value.trim(),
    accent: byId('site-accent').value,
    show_team_tab: byId('site-toggle-team').checked,
    show_admin_tab: byId('site-toggle-admin').checked
  };
  const { error } = await sb.from('site_settings').update(updates).eq('business_id', currentUser.business_id);
  if(error){ alert(error.message); return; }
  siteSettings = { ...siteSettings, ...updates };
  applySiteSettings();
  document.querySelectorAll('.tab[data-view="team"]').forEach(el => { if(currentUser.role==='mid') el.style.display = updates.show_team_tab ? '' : 'none'; });
  document.querySelectorAll('.tab[data-view="admin"]').forEach(el => { if(perms().adminPortal) el.style.display = updates.show_admin_tab ? '' : 'none'; });
  alert('Site settings updated for everyone.');
}

/* expose the handlers referenced from inline HTML (onclick=, ondragstart=) */
window.openLeadModal = openLeadModal;
window.openUserDetail = openUserDetail;
window.resetPassword = resetPassword;
window.removeUser = removeUser;
window.changeRole = changeRole;
