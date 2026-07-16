const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function addDays(base, days) {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function annualBudgetFrom(estCost, freqDays) {
  return freqDays ? Math.round(estCost * (365 / freqDays)) : 0;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      area TEXT DEFAULT '',
      type TEXT DEFAULT 'Maintenance',
      frequency_days INTEGER,
      pic TEXT DEFAULT '',
      est_cost NUMERIC DEFAULT 0,
      annual_budget NUMERIC DEFAULT 0,
      next_due TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      completed_once BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      date TEXT,
      cost NUMERIC DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM tasks');
  if (rows[0].c === 0) {
    await seedData();
  }
}

async function insertTask(t) {
  await pool.query(
    `INSERT INTO tasks (id, name, area, type, frequency_days, pic, est_cost, annual_budget, next_due, notes, completed_once)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [t.id, t.name, t.area || '', t.type || 'Maintenance', t.frequencyDays || null, t.pic || '',
     t.estCost || 0, t.annualBudget || 0, t.nextDue || '', t.notes || '', t.completedOnce || false]
  );
  for (const h of (t.history || [])) {
    await pool.query('INSERT INTO history (task_id, date, cost, notes) VALUES ($1,$2,$3,$4)',
      [t.id, h.date, h.cost || 0, h.notes || '']);
  }
}

async function seedData() {
  const t = new Date().toISOString().slice(0, 10);
  const seed = [
    { id: uid(), name: 'Cleaning & Checking', area: 'AC (All Room)', type: 'Maintenance', frequencyDays: 30, pic: 'Vendor', estCost: 1200000, nextDue: addDays(t, -3), history: [{ date: addDays(t, -33), cost: 1150000, notes: '' }] },
    { id: uid(), name: 'Monitoring & Troubleshooting', area: 'Internet & Network', type: 'Maintenance', frequencyDays: 90, pic: 'Vendor', estCost: 200000, nextDue: addDays(t, 2), history: [{ date: addDays(t, -88), cost: 180000, notes: '' }] },
    { id: uid(), name: 'System Check', area: 'CCTV', type: 'Maintenance', frequencyDays: 30, pic: 'Vendor', estCost: 200000, nextDue: addDays(t, 12), history: [] },
    { id: uid(), name: 'System Check', area: 'Access Door System', type: 'Maintenance', frequencyDays: 180, pic: 'Ops', estCost: 0, nextDue: addDays(t, 55), history: [] },
    { id: uid(), name: 'Inspection', area: 'Fire Extinguisher (APAR)', type: 'Maintenance', frequencyDays: 30, pic: 'Ops', estCost: 0, nextDue: addDays(t, 7), history: [] },
    { id: uid(), name: 'Daily Cleaning', area: 'All Room', type: 'Maintenance', frequencyDays: 1, pic: 'Office Boy', estCost: 0, nextDue: t, history: [] },
    { id: uid(), name: 'General Cleaning', area: 'All Room', type: 'Maintenance', frequencyDays: 180, pic: 'Vendor', estCost: 6000000, nextDue: addDays(t, 140), history: [] },
    { id: uid(), name: 'Restocking', area: 'Pantry Supplies', type: 'Purchase', frequencyDays: 15, pic: 'Ops/Office Boy', estCost: 750000, nextDue: t, history: [{ date: addDays(t, -7), cost: 720000, notes: '' }, { date: addDays(t, -22), cost: 300000, notes: '' }] },
    { id: uid(), name: 'Restocking', area: 'Stationery Supplies', type: 'Purchase', frequencyDays: 30, pic: 'Ops', estCost: 500000, nextDue: addDays(t, 17), history: [] },
    { id: uid(), name: 'Restocking (as needed)', area: 'First Aid Kit', type: 'Purchase', frequencyDays: 30, pic: 'Ops', estCost: 500000, nextDue: addDays(t, 24), history: [] },
    { id: uid(), name: 'Emergency lift repair (breakdown)', area: 'Lift', type: 'Insidental', frequencyDays: null, pic: 'CV Lift Jaya', estCost: 2500000, nextDue: '', completedOnce: true, history: [{ date: addDays(t, -7), cost: 2500000, notes: 'Sudden breakdown' }] },
    { id: uid(), name: 'Pay Internet Bill', area: 'Internet & Network', type: 'Tagihan', frequencyDays: 30, pic: 'Finance/Ops', estCost: 1500000, nextDue: addDays(t, 5), history: [{ date: addDays(t, -25), cost: 1500000, notes: '' }] },
    { id: uid(), name: 'Pay Electricity Bill', area: 'Electricity (PLN)', type: 'Tagihan', frequencyDays: 30, pic: 'Finance/Ops', estCost: 3500000, nextDue: addDays(t, 9), history: [{ date: addDays(t, -21), cost: 3350000, notes: '' }] }
  ];
  for (const s of seed) {
    s.annualBudget = annualBudgetFrom(s.estCost, s.frequencyDays);
    await insertTask(s);
  }
}

function rowToTask(row, history) {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    type: row.type,
    frequencyDays: row.frequency_days,
    pic: row.pic,
    estCost: Number(row.est_cost),
    annualBudget: Number(row.annual_budget),
    nextDue: row.next_due,
    notes: row.notes,
    completedOnce: row.completed_once,
    history: history || []
  };
}

app.get('/api/tasks', async (req, res) => {
  try {
    const tasksRes = await pool.query('SELECT * FROM tasks ORDER BY created_at ASC');
    const historyRes = await pool.query('SELECT * FROM history ORDER BY date ASC, id ASC');
    const byTask = {};
    historyRes.rows.forEach(h => {
      if (!byTask[h.task_id]) byTask[h.task_id] = [];
      byTask[h.task_id].push({ date: h.date, cost: Number(h.cost), notes: h.notes });
    });
    res.json(tasksRes.rows.map(r => rowToTask(r, byTask[r.id])));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load tasks' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const t = req.body;
    const id = uid();
    await pool.query(
      `INSERT INTO tasks (id, name, area, type, frequency_days, pic, est_cost, annual_budget, next_due, notes, completed_once)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
      [id, t.name, t.area || '', t.type || 'Maintenance', t.frequencyDays || null, t.pic || '',
       t.estCost || 0, t.annualBudget || 0, t.nextDue || '', t.notes || '']
    );
    res.json({ id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const t = req.body;
    await pool.query(
      `UPDATE tasks SET name=$1, area=$2, type=$3, frequency_days=$4, pic=$5, est_cost=$6, annual_budget=$7, next_due=$8, notes=$9 WHERE id=$10`,
      [t.name, t.area || '', t.type || 'Maintenance', t.frequencyDays || null, t.pic || '',
       t.estCost || 0, t.annualBudget || 0, t.nextDue || '', t.notes || '', req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.post('/api/tasks/:id/complete', async (req, res) => {
  try {
    const { date, cost, notes } = req.body;
    const id = req.params.id;
    const d = date || new Date().toISOString().slice(0, 10);
    await pool.query('INSERT INTO history (task_id, date, cost, notes) VALUES ($1,$2,$3,$4)', [id, d, cost || 0, notes || '']);
    const taskRes = await pool.query('SELECT * FROM tasks WHERE id=$1', [id]);
    const task = taskRes.rows[0];
    if (task && task.frequency_days) {
      await pool.query('UPDATE tasks SET next_due=$1 WHERE id=$2', [addDays(d, task.frequency_days), id]);
    } else if (task) {
      await pool.query('UPDATE tasks SET completed_once=TRUE, next_due=$1 WHERE id=$2', ['', id]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

app.get('/health', (req, res) => res.send('ok'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log('YK Watchtower server running on port ' + PORT)))
  .catch(err => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
