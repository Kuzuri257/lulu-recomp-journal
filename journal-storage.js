'use strict';

const JOURNAL_KEYS = {
  activities: 'lulu-activities',
  weights: 'lulu-weights',
  macroDays: 'lulu-macrodays',
  suppStack: 'lulu-suppstack',
  suppLogs: 'lulu-supplogs',
  settings: 'lulu-settings'
};

const DEFAULT_JOURNAL_SETTINGS = {
  calorieTarget: 1600,
  proteinTarget: 140,
  fatTarget: 44,
  carbTarget: 160,
  stepsGoal: 8000
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDose(dosage){
  const value = String(dosage || '').trim();
  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+|IU|mcg|mg|ml|g|capsule|tablet|scoop)?/);
  return {
    dose: match ? Number(match[1]) : 0,
    unit: match && match[2] ? match[2] : 'mg'
  };
}

function formatDose(dose, unit){
  const amount = Number(dose) || 0;
  return amount > 0 ? `${amount}${unit || 'mg'}` : '';
}

function parseLogNote(note, fallback){
  try{
    return { ...fallback, ...JSON.parse(note || '{}') };
  }catch(_error){
    return fallback;
  }
}

function cleanUuid(id){
  return UUID_RE.test(String(id || '')) ? id : crypto.randomUUID();
}

async function requireSession(client){
  const { data } = await client.auth.getSession();
  if(!data.session){
    window.location.replace('./');
    throw new Error('Not signed in');
  }
  return data.session;
}

async function ensureProfile(client, user){
  await client.from('lulu_profiles').upsert({
    user_id: user.id,
    email: user.email
  }, { onConflict: 'user_id' });
}

function createJournalStorage(client, session){
  const user = session.user;

  async function getSettings(){
    const { data } = await client.from('lulu_settings').select('*').eq('user_id', user.id).maybeSingle();
    const settings = data ? {
      calorieTarget: Number(data.calorie_target),
      proteinTarget: Number(data.protein_target),
      fatTarget: Number(data.fat_target),
      carbTarget: Number(data.carb_target),
      stepsGoal: Number(data.steps_goal)
    } : DEFAULT_JOURNAL_SETTINGS;
    return { value: JSON.stringify(settings) };
  }

  async function setSettings(value){
    const settings = { ...DEFAULT_JOURNAL_SETTINGS, ...JSON.parse(value || '{}') };
    await client.from('lulu_settings').upsert({
      user_id: user.id,
      calorie_target: Number(settings.calorieTarget) || DEFAULT_JOURNAL_SETTINGS.calorieTarget,
      protein_target: Number(settings.proteinTarget) || DEFAULT_JOURNAL_SETTINGS.proteinTarget,
      fat_target: Number(settings.fatTarget) || DEFAULT_JOURNAL_SETTINGS.fatTarget,
      carb_target: Number(settings.carbTarget) || DEFAULT_JOURNAL_SETTINGS.carbTarget,
      steps_goal: Number(settings.stepsGoal) || DEFAULT_JOURNAL_SETTINGS.stepsGoal
    }, { onConflict: 'user_id' });
  }

  async function getActivities(){
    const { data } = await client.from('lulu_activities').select('*').eq('user_id', user.id).order('entry_date');
    return { value: JSON.stringify((data || []).map(row => ({
      id: row.id,
      date: row.entry_date,
      type: row.activity_type,
      note: row.note || ''
    }))) };
  }

  async function setActivities(value){
    const rows = JSON.parse(value || '[]').map(item => ({
      id: cleanUuid(item.id),
      user_id: user.id,
      entry_date: item.date,
      activity_type: item.type,
      note: item.note || ''
    }));
    await client.from('lulu_activities').delete().eq('user_id', user.id);
    if(rows.length) await client.from('lulu_activities').insert(rows);
  }

  async function getWeights(){
    const { data } = await client.from('lulu_weights').select('*').eq('user_id', user.id).order('entry_date');
    return { value: JSON.stringify((data || []).map(row => ({
      id: row.id,
      date: row.entry_date,
      value: Number(row.value_kg)
    }))) };
  }

  async function setWeights(value){
    const rows = JSON.parse(value || '[]').map(item => ({
      id: cleanUuid(item.id),
      user_id: user.id,
      entry_date: item.date,
      value_kg: Number(item.value) || 0
    })).filter(row => row.value_kg > 0);
    await client.from('lulu_weights').delete().eq('user_id', user.id);
    if(rows.length) await client.from('lulu_weights').insert(rows);
  }

  async function getMacroDays(){
    const { data } = await client.from('lulu_macro_days').select('*').eq('user_id', user.id).order('entry_date');
    const days = {};
    (data || []).forEach(row => {
      days[row.entry_date] = {
        steps: Number(row.steps) || 0,
        calories: Number(row.calories) || 0,
        protein: Number(row.protein) || 0,
        fat: Number(row.fat) || 0,
        carbs: Number(row.carbs) || 0,
        meals: Array.isArray(row.meals) ? row.meals : []
      };
    });
    return { value: JSON.stringify(days) };
  }

  async function setMacroDays(value){
    const days = JSON.parse(value || '{}');
    const rows = Object.entries(days).map(([date, item]) => ({
      user_id: user.id,
      entry_date: date,
      steps: Number(item.steps) || 0,
      calories: Number(item.calories) || 0,
      protein: Number(item.protein) || 0,
      fat: Number(item.fat) || 0,
      carbs: Number(item.carbs) || 0,
      meals: Array.isArray(item.meals) ? item.meals : []
    }));
    await client.from('lulu_macro_days').delete().eq('user_id', user.id);
    if(rows.length) await client.from('lulu_macro_days').insert(rows);
  }

  async function getSuppStack(){
    const { data } = await client
      .from('lulu_supplements')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('sort_order');
    return { value: JSON.stringify((data || []).map(row => ({
      id: row.id,
      name: row.name,
      ...parseDose(row.dosage)
    }))) };
  }

  async function setSuppStack(value){
    const stack = JSON.parse(value || '[]').map((item, index) => ({
      id: cleanUuid(item.id),
      user_id: user.id,
      name: item.name,
      dosage: formatDose(item.dose, item.unit),
      timing: item.unit || 'mg',
      cadence: 'daily',
      sort_order: (index + 1) * 10,
      active: true
    })).filter(row => row.name);

    if(stack.length){
      await client.from('lulu_supplements').upsert(stack, { onConflict: 'id' });
    }

    const activeIds = stack.map(item => item.id);
    let query = client.from('lulu_supplements').update({ active: false }).eq('user_id', user.id);
    if(activeIds.length) query = query.not('id', 'in', `(${activeIds.join(',')})`);
    await query;
  }

  async function ensureSupplement(item){
    const name = String(item.name || '').trim();
    if(!name) return null;

    if(UUID_RE.test(String(item.stackId || ''))) return item.stackId;

    const { data: existing } = await client
      .from('lulu_supplements')
      .select('id')
      .eq('user_id', user.id)
      .eq('active', true)
      .ilike('name', name)
      .limit(1)
      .maybeSingle();

    if(existing?.id) return existing.id;

    const { data } = await client.from('lulu_supplements').insert({
      user_id: user.id,
      name,
      dosage: formatDose(item.dose, item.unit),
      timing: item.unit || 'mg',
      cadence: 'daily',
      sort_order: 999,
      active: true
    }).select('id').single();

    return data?.id || null;
  }

  async function getSuppLogs(){
    const { data: stack } = await client.from('lulu_supplements').select('*').eq('user_id', user.id);
    const byId = new Map((stack || []).map(item => [item.id, item]));
    const { data } = await client.from('lulu_supplement_logs').select('*').eq('user_id', user.id).order('entry_date');
    return { value: JSON.stringify((data || []).filter(row => row.taken).map(row => {
      const supp = byId.get(row.supplement_id);
      const fallback = supp ? { name: supp.name, ...parseDose(supp.dosage) } : { name: 'Supplement', dose: 0, unit: 'mg' };
      return {
        id: row.id,
        date: row.entry_date,
        ...parseLogNote(row.note, fallback)
      };
    })) };
  }

  async function setSuppLogs(value){
    const logs = JSON.parse(value || '[]');
    await client.from('lulu_supplement_logs').delete().eq('user_id', user.id);
    const rows = [];
    for(const log of logs){
      const supplementId = await ensureSupplement(log);
      if(!supplementId) continue;
      rows.push({
        id: cleanUuid(log.id),
        user_id: user.id,
        supplement_id: supplementId,
        entry_date: log.date,
        taken: true,
        taken_at: new Date().toISOString(),
        note: JSON.stringify({ name: log.name, dose: Number(log.dose) || 0, unit: log.unit || 'mg' })
      });
    }
    if(rows.length) await client.from('lulu_supplement_logs').insert(rows);
  }

  return {
    async get(key){
      if(key === JOURNAL_KEYS.activities) return getActivities();
      if(key === JOURNAL_KEYS.weights) return getWeights();
      if(key === JOURNAL_KEYS.macroDays) return getMacroDays();
      if(key === JOURNAL_KEYS.suppStack) return getSuppStack();
      if(key === JOURNAL_KEYS.suppLogs) return getSuppLogs();
      if(key === JOURNAL_KEYS.settings) return getSettings();
      return { value: null };
    },
    async set(key, value){
      if(key === JOURNAL_KEYS.activities) return setActivities(value);
      if(key === JOURNAL_KEYS.weights) return setWeights(value);
      if(key === JOURNAL_KEYS.macroDays) return setMacroDays(value);
      if(key === JOURNAL_KEYS.suppStack) return setSuppStack(value);
      if(key === JOURNAL_KEYS.suppLogs) return setSuppLogs(value);
      if(key === JOURNAL_KEYS.settings) return setSettings(value);
    }
  };
}

window.LuluJournalStorage = {
  async install(){
    const config = window.LULU_SUPABASE_CONFIG || {};
    if(!window.supabase || !config.url || !config.anonKey){
      window.location.replace('./');
      return;
    }
    const client = window.supabase.createClient(config.url, config.anonKey);
    const session = await requireSession(client);
    await ensureProfile(client, session.user);
    window.luluSupabase = client;
    window.storage = createJournalStorage(client, session);
  }
};
