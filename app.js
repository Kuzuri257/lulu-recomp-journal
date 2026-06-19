'use strict';

const DEFAULT_SUPPLEMENTS = [
  { name: 'Vitamin D3', dosage: '1 softgel', timing: 'AM', cadence: 'daily', sort_order: 10 },
  { name: 'Omega-3', dosage: '2 capsules', timing: 'AM', cadence: 'daily', sort_order: 20 },
  { name: 'Creatine', dosage: '5g', timing: 'Any', cadence: 'daily', sort_order: 30 },
  { name: 'Magnesium Glycinate', dosage: '1 serving', timing: 'PM', cadence: 'daily', sort_order: 40 }
];

const state = {
  client: null,
  session: null,
  user: null,
  email: '',
  otpSent: false,
  loading: true,
  busy: false,
  error: '',
  supplements: [],
  logs: {},
  activeTab: 'supps'
};

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

function todayKey(offset = 0){
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(value){
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function showToast(message){
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(window._luluToast);
  window._luluToast = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

function suppIconFor(name){
  const n = (name || '').toLowerCase();
  if(n.includes('creatine')) return '⚡';
  if(n.includes('protein')) return '🥤';
  if(n.includes('omega') || n.includes('fish')) return '🟡';
  if(n.includes('magnesium')) return '🌙';
  if(n.includes('vitamin') || n.includes('d3')) return '☀️';
  if(n.includes('iron')) return '🩸';
  if(n.includes('greens') || n.includes('herb')) return '🌿';
  return '💊';
}

function setBusy(busy){
  state.busy = busy;
  render();
}

function setError(error){
  state.error = error || '';
  render();
}

function getConfig(){
  return window.LULU_SUPABASE_CONFIG || {};
}

function initClient(){
  const config = getConfig();
  if(!window.supabase || !config.url || !config.anonKey || config.url.includes('YOUR_PROJECT_REF')){
    state.loading = false;
    state.error = 'Supabase is not configured yet. Add lulu-recomp-journal/supabase/config.js with the project URL and anon key.';
    render();
    return false;
  }
  state.client = window.supabase.createClient(config.url, config.anonKey);
  return true;
}

async function bootstrap(){
  if(!initClient()) return;
  const { data } = await state.client.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  if(state.user){
    window.location.replace('./journal.html');
    return;
  }
  state.loading = false;
  render();

  state.client.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    if(state.user){
      window.location.replace('./journal.html');
      return;
    }
    render();
  });
}

async function sendCode(){
  const email = document.getElementById('email')?.value.trim().toLowerCase();
  if(!email) return setError('Enter Lulu email first.');
  state.email = email;
  setBusy(true);
  const { error } = await state.client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}${window.location.pathname}`
    }
  });
  setBusy(false);
  if(error) return setError(error.message);
  state.otpSent = true;
  setError('');
  showToast('Code sent. Check email.');
  render();
  setTimeout(() => document.querySelector('.code-row input')?.focus(), 50);
}

function moveCodeFocus(input, index){
  input.value = input.value.replace(/\D/g, '').slice(0, 1);
  const next = document.querySelector(`[data-code-index="${index + 1}"]`);
  if(input.value && next) next.focus();
}

async function verifyCode(){
  const token = Array.from(document.querySelectorAll('.code-row input')).map(i => i.value).join('');
  if(token.length < 6) return setError('Enter the code from your email.');
  setBusy(true);
  const { data, error } = await state.client.auth.verifyOtp({
    email: state.email,
    token,
    type: 'email'
  });
  setBusy(false);
  if(error) return setError(error.message);
  state.session = data.session;
  state.user = data.user;
  setError('');
  showToast('Logged in and synced.');
  window.location.replace('./journal.html');
}

async function signOut(){
  await state.client.auth.signOut();
  state.session = null;
  state.user = null;
  state.supplements = [];
  state.logs = {};
  state.otpSent = false;
  render();
}

async function loadUserData(){
  if(!state.user) return;
  await state.client.from('lulu_profiles').upsert({
    user_id: state.user.id,
    email: state.user.email
  }, { onConflict: 'user_id' });

  await state.client.from('lulu_settings').upsert({
    user_id: state.user.id
  }, { onConflict: 'user_id' });

  const { data: supps, error: suppError } = await state.client
    .from('lulu_supplements')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if(suppError){
    state.error = suppError.message;
    return;
  }

  if(!supps.length){
    const rows = DEFAULT_SUPPLEMENTS.map(item => ({ ...item, user_id: state.user.id }));
    const { error } = await state.client.from('lulu_supplements').insert(rows);
    if(error){
      state.error = error.message;
      return;
    }
  }

  const { data: supplements } = await state.client
    .from('lulu_supplements')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  state.supplements = supplements || [];
  await loadLogs();
}

async function loadLogs(){
  const from = todayKey(-13);
  const to = todayKey();
  const { data, error } = await state.client
    .from('lulu_supplement_logs')
    .select('*')
    .gte('entry_date', from)
    .lte('entry_date', to);

  if(error){
    state.error = error.message;
    return;
  }

  state.logs = {};
  (data || []).forEach(log => {
    state.logs[`${log.entry_date}:${log.supplement_id}`] = log;
  });
}

function logFor(date, supplementId){
  return state.logs[`${date}:${supplementId}`];
}

function isTaken(date, supplementId){
  return !!logFor(date, supplementId)?.taken;
}

function dayStats(date){
  const total = state.supplements.length || 0;
  const taken = state.supplements.filter(s => isTaken(date, s.id)).length;
  const pct = total ? Math.round((taken / total) * 100) : 0;
  return { total, taken, pct };
}

function weeklyStats(){
  const total = state.supplements.length * 7;
  let taken = 0;
  for(let i = 0; i > -7; i--){
    taken += state.supplements.filter(s => isTaken(todayKey(i), s.id)).length;
  }
  return { taken, total, pct: total ? Math.round((taken / total) * 100) : 0 };
}

function supplementStreak(){
  let streak = 0;
  for(let i = 0; i > -365; i--){
    const stats = dayStats(todayKey(i));
    if(stats.total && stats.taken === stats.total) streak++;
    else if(i === 0 && stats.taken === 0) continue;
    else break;
  }
  return streak;
}

async function toggleSupplement(id){
  const date = todayKey();
  const current = logFor(date, id);
  const nextTaken = !current?.taken;
  const row = {
    user_id: state.user.id,
    supplement_id: id,
    entry_date: date,
    taken: nextTaken,
    taken_at: nextTaken ? new Date().toISOString() : null
  };
  const { data, error } = await state.client
    .from('lulu_supplement_logs')
    .upsert(row, { onConflict: 'user_id,supplement_id,entry_date' })
    .select()
    .single();

  if(error) return setError(error.message);
  state.logs[`${date}:${id}`] = data;
  showToast(nextTaken ? 'Supplement checked off.' : 'Supplement unchecked.');
  render();
}

async function addSupplement(){
  const name = document.getElementById('supp-name')?.value.trim();
  const dosage = document.getElementById('supp-dosage')?.value.trim();
  const timing = document.getElementById('supp-timing')?.value.trim() || 'Any';
  if(!name) return setError('Add a supplement name first.');
  const sort_order = (state.supplements.length + 1) * 10;
  const { error } = await state.client.from('lulu_supplements').insert({
    user_id: state.user.id,
    name,
    dosage: dosage || '',
    timing,
    cadence: 'daily',
    sort_order
  });
  if(error) return setError(error.message);
  setError('');
  await loadUserData();
  showToast('Supplement added.');
}

function renderHeader(){
  return `
    <header class="header">
      <div class="crown">👑</div>
      <h1>Lulu's <span>Recomp</span> Journal</h1>
      <p class="tagline">Train hard. Eat well. Reign supreme.</p>
    </header>
  `;
}

function renderLogin(){
  return `
    <section class="landing-shell">
      <div class="landing-hero">
        <div class="landing-content">
          <div class="landing-brand"><span class="landing-mark">👑</span> Lulu's private journal</div>
          <div class="landing-main">
            <h1>Reign over your <span>recomp era.</span></h1>
            <p class="landing-copy">A tiny, pretty command center for training, macros, weigh-ins, supplements, streaks, and the little wins that become the big ones.</p>
            <div class="landing-perks">
              <span class="landing-perk">💊 Supp stack</span>
              <span class="landing-perk">🔥 Streaks</span>
              <span class="landing-perk">🏅 Badges</span>
              <span class="landing-perk">☁️ Synced</span>
            </div>
            <div class="landing-login">
              <div class="landing-login-title">${state.otpSent ? 'Enter your royal code' : 'Step into the journal'}</div>
              <div class="landing-login-sub">${state.otpSent ? 'Enter the code from your email. No password, no drama.' : 'Add your email and we will send a one-time sign-in code.'}</div>
              ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
              <div class="auth-row">
                <input id="email" type="email" autocomplete="email" placeholder="lulu@example.com" value="${escapeHtml(state.email)}">
                <button class="btn" onclick="sendCode()" ${state.busy ? 'disabled' : ''}>${state.otpSent ? 'Resend' : 'Send Code'}</button>
              </div>
              ${state.otpSent ? `
                <div class="code-row" aria-label="Email sign-in code">
                  ${[0,1,2,3,4,5,6,7].map(i => `<input inputmode="numeric" data-code-index="${i}" maxlength="1" oninput="moveCodeFocus(this, ${i})">`).join('')}
                </div>
                <button class="btn" style="width:100%;margin-top:10px" onclick="verifyCode()" ${state.busy ? 'disabled' : ''}>Unlock Dashboard</button>
              ` : ''}
              <p class="note">Works from iPhone and iPad once Supabase is configured.</p>
            </div>
          </div>
          <div class="landing-footer">Private by design. Synced by magic. Powered by consistency.</div>
        </div>
      </div>
    </section>
  `;
}

function renderApp(){
  const today = dayStats(todayKey());
  const week = weeklyStats();
  const streak = supplementStreak();
  const badgeEarned = week.pct >= 80 || streak >= 7;
  const takenToday = new Set(state.supplements.filter(s => isTaken(todayKey(), s.id)).map(s => s.id));
  const stackChips = state.supplements.length ? state.supplements.map(s => {
    const taken = takenToday.has(s.id);
    return `
      <div class="supp-stack-chip ${taken ? 'taken-today' : ''}" onclick="${taken ? '' : `toggleSupplement('${s.id}')`}" title="${taken ? 'Already logged today' : 'Tap to log'}">
        <span class="ssc-icon">${suppIconFor(s.name)}</span>
        <span>
          <div class="ssc-text">${escapeHtml(s.name)}</div>
          <div class="ssc-dose">${escapeHtml(s.dosage || s.timing || 'no target')}</div>
        </span>
        ${taken ? '<span class="ssc-check">✓</span>' : ''}
      </div>
    `;
  }).join('') : '<div class="empty-state">No regulars saved yet — add your stack below 💊</div>';

  const todaysLogHtml = state.supplements.filter(s => isTaken(todayKey(), s.id)).map(s => `
    <div class="supp-log-item">
      <div class="sli-left">
        <span class="sli-icon">${suppIconFor(s.name)}</span>
        <div>
          <div class="sli-name">${escapeHtml(s.name)}</div>
          <div class="sli-dose">${escapeHtml(s.dosage || 'logged')} <span class="sli-vs-target met">done today</span></div>
        </div>
      </div>
      <button class="btn btn-text" onclick="toggleSupplement('${s.id}')">Undo</button>
    </div>
  `).join('') || '<div class="empty-state">Nothing logged yet today</div>';

  return `
    ${renderHeader()}
    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
    <div class="user-row">
      <span>Signed in as ${escapeHtml(state.user?.email || '')}</span>
      <button class="btn btn-text" onclick="signOut()">Sign out</button>
    </div>
    <section class="banner">
      <div class="stat"><div class="num">🔥${streak}</div><div class="lbl">Supp Streak</div></div>
      <div class="stat"><div class="num">${week.pct}%</div><div class="lbl">Week Score</div></div>
      <div class="stat"><div class="num">${badgeEarned ? '1/1' : '0/1'}</div><div class="lbl">Badges</div></div>
    </section>
    <nav class="tabs">
      <div class="tab">Today</div>
      <div class="tab active">Supps</div>
      <div class="tab">Weight</div>
      <div class="tab">Log</div>
      <div class="tab">Badges</div>
    </nav>
    <section class="card">
      <h2><span>💊</span> Your Stack</h2>
      <div class="sub">Tap a regular to log it for today. ${today.taken}/${today.total} taken today · ${week.pct}% this week.</div>
      <div class="supp-stack-row">${stackChips}</div>
    </section>
    <section class="card">
      <h2><span>🧪</span> Add to Stack</h2>
      <div class="sub">Add a regular supplement and it will show up as a quick tap tomorrow too.</div>
      <div class="supp-add-row">
        <div class="field"><label>Name</label><input id="supp-name" placeholder="e.g. Iron"></div>
        <div class="field"><label>Dosage</label><input id="supp-dosage" placeholder="e.g. 1 tablet"></div>
        <div class="field"><label>Time</label><input id="supp-timing" placeholder="AM"></div>
      </div>
      <button class="btn" style="width:100%" onclick="addSupplement()">Add Supplement</button>
    </section>
    <section class="card">
      <h2><span>📋</span> Today's Supplements</h2>
      <div class="supp-log-list">${todaysLogHtml}</div>
    </section>
    <section class="card">
      <h2><span>🏅</span> Badge</h2>
      <div class="badge-preview">
        <div class="badge-icon">💊</div>
        <div class="badge-copy">
          <b>${badgeEarned ? 'Supplement Sweetheart earned' : 'Supplement Sweetheart'}</b>
          <div>Earn it by reaching 80%+ supplement completion over the last 7 days, or a 7-day perfect supplement streak.</div>
        </div>
      </div>
    </section>
  `;
}

function render(){
  if(state.loading){
    app.className = 'shell';
    app.innerHTML = '<div class="loading">Loading Lulu&apos;s journal...</div>';
    return;
  }
  app.className = state.user ? 'shell' : '';
  app.innerHTML = state.user ? renderApp() : renderLogin();
}

window.sendCode = sendCode;
window.verifyCode = verifyCode;
window.moveCodeFocus = moveCodeFocus;
window.signOut = signOut;
window.toggleSupplement = toggleSupplement;
window.addSupplement = addSupplement;

bootstrap();
