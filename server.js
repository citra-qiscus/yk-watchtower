const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SITE_URL = process.env.SITE_URL || '';

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

async function fetchAllTasks() {
  const tasksRes = await pool.query('SELECT * FROM tasks ORDER BY created_at ASC');
  const historyRes = await pool.query('SELECT * FROM history ORDER BY date ASC, id ASC');
  const byTask = {};
  historyRes.rows.forEach(h => {
    if (!byTask[h.task_id]) byTask[h.task_id] = [];
    byTask[h.task_id].push({ date: h.date, cost: Number(h.cost), notes: h.notes });
  });
  return tasksRes.rows.map(r => rowToTask(r, byTask[r.id]));
}

app.get('/api/tasks', async (req, res) => {
  try {
    res.json(await fetchAllTasks());
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

// ---------- Monthly Report Generation (ported from the dashboard's own report
// builder, so the same report can be generated server-side — e.g. for the
// "download last month's report" link in the biweekly Slack digest — without
// needing a browser. Kept output-identical to what the dashboard produces. ----------
function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtRp = fmtRpServer;
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function computeStatus(it) {
  const today = new Date().toISOString().slice(0, 10);
  if (!it.frequencyDays) {
    if (it.completedOnce) return { key: 'done', label: 'Done', prio: 3 };
    if (!it.nextDue) return { key: 'upcoming', label: 'Not scheduled', prio: 2 };
    if (it.nextDue < today) return { key: 'overdue', label: 'Overdue', prio: 0 };
    const diff = Math.round((new Date(it.nextDue + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    if (diff <= 7) return { key: 'soon', label: `Due soon (${diff} days)`, prio: 1 };
    return { key: 'upcoming', label: 'Scheduled', prio: 2 };
  }
  if (!it.nextDue) return { key: 'upcoming', label: 'Not scheduled', prio: 2 };
  if (it.nextDue < today) return { key: 'overdue', label: 'Overdue', prio: 0 };
  const diff = Math.round((new Date(it.nextDue + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  if (diff <= 7) return { key: 'soon', label: diff === 0 ? 'Today' : `Due soon (${diff} days)`, prio: 1 };
  return { key: 'upcoming', label: 'Scheduled', prio: 2 };
}

const categoryDefs = [
  { key:'Maintenance', label:'Maintenance', color:'#2F80ED', bg:'#EAF3FE', chartColor:'#2F80ED' },
  { key:'Purchase',    label:'Purchase',    color:'#5CA24C', bg:'#EAFBF0', chartColor:'#5CA24C' },
  { key:'Insidental',  label:'Incident',    color:'#01416C', bg:'#FFF1DE', chartColor:'#E8973C' },
  { key:'Tagihan',     label:'Bill',        color:'#01416C', bg:'#FFF8E6', chartColor:'#C9971B' }
];
function catLabel(key) { const c = categoryDefs.find(x => x.key === key); return c ? c.label : key; }
function catPill(stat) { return `<span class="cat-pill" style="background:${stat.bg};color:${stat.color};">${stat.label}</span>`; }
function buildBudgetBar(actual, budget) {
  if (!budget) return `<div class="bar-label">No budget set for comparison</div>`;
  const pct = Math.round((actual / budget) * 100);
  const widthPct = Math.min(pct, 100);
  const color = pct > 100 ? '#01416C' : (pct > 85 ? '#FBB439' : '#5CA24C');
  return `<div class="bar-track"><div class="bar-fill" style="width:${widthPct}%;background:${color};"></div></div><div class="bar-label">${pct}% of budget used</div>`;
}
function buildDayLabels(daysInMonth) {
  const labels = [];
  for (let d = 1; d <= daysInMonth; d++) labels.push((d === 1 || d % 5 === 0 || d === daysInMonth) ? String(d) : '');
  return labels;
}
function buildMultiTimeseries(labels, series, opts) {
  opts = opts || {};
  const width = opts.width || 736;
  const height = opts.height || 140;
  const padTop = 14, padBottom = 18, padSide = 4;
  const chartW = width - padSide * 2;
  const chartH = height - padTop - padBottom;
  const allVals = series.reduce((acc, s) => acc.concat(s.values), []);
  const maxVal = Math.max.apply(null, allVals.concat([0]));
  if (maxVal <= 0) return null;
  const n = labels.length;
  const step = n > 1 ? chartW / (n - 1) : 0;
  let labelEls = '';
  for (let i = 0; i < n; i++) {
    if (labels[i]) labelEls += `<text x="${(padSide + i * step).toFixed(1)}" y="${height - 5}" font-size="8" fill="#828282" text-anchor="middle" font-family="Inter,sans-serif">${labels[i]}</text>`;
  }
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => {
    const y = padTop + chartH * (1 - f);
    return `<line x1="${padSide}" y1="${y.toFixed(1)}" x2="${width - padSide}" y2="${y.toFixed(1)}" stroke="#EDEFF2" stroke-width="1"/>`;
  }).join('');
  const maxLabel = `<text x="${padSide}" y="${padTop - 4}" font-size="8" fill="#BDBDBD" font-family="Inter,sans-serif">max ${fmtRp(maxVal)}</text>`;
  let seriesEls = '';
  series.forEach(s => {
    const pts = s.values.map((v, i) => {
      const hRaw = v > 0 ? (v / maxVal) * chartH : 0;
      return [padSide + i * step, padTop + (chartH - hRaw)];
    });
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const dots = pts.map((p, i) => s.values[i] > 0 ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="${s.color}"/>` : '').join('');
    seriesEls += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  });
  const legend = `<div class="mini-chart-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('')}</div>`;
  const svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">${gridLines}${seriesEls}${labelEls}${maxLabel}</svg>`;
  return legend + svg;
}

const REPORT_STYLE = `
  @page{ size:A4; margin:0; }
  :root{ --navy:#01416C; --navy-soft:#EAF3FE; --green:#74C162; --green-dark:#5CA24C; --orange:#FBB439; --grey:#828282; --grey-light:#BDBDBD; --border:#E5E9ED; --text:#2B2B2B; }
  *{box-sizing:border-box;}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:var(--text);margin:0;padding:24px 0;background:#7c8388;}
  .page{width:210mm;min-height:297mm;margin:0 auto;padding:16mm 15mm 18mm;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.25);}
  .report-header{border-bottom:2px solid var(--navy);padding-bottom:14px;margin-bottom:24px;}
  .report-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--green-dark);display:flex;align-items:center;gap:7px;margin-bottom:6px;}
  .report-eyebrow::before{content:'';width:14px;height:2px;background:var(--green);display:inline-block;flex:none;}
  h1{color:var(--navy);font-size:20px;margin:0 0 6px;font-weight:700;letter-spacing:-0.01em;}
  .meta{color:var(--grey);font-size:11.5px;}
  h2{color:var(--navy);font-size:13px;font-weight:700;margin:26px 0 12px;padding-bottom:7px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:7px;text-transform:uppercase;letter-spacing:.03em;}
  h2::before{content:'';width:14px;height:2px;border-radius:0;background:var(--green);display:inline-block;flex:none;}
  h2:first-of-type{margin-top:20px;}
  .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:4px;}
  .card{position:relative;border:1px solid var(--border);border-radius:8px;padding:10px 11px;background:#fff;min-width:0;}
  .card::before{content:'';position:absolute;top:9px;right:9px;width:6px;height:6px;border-radius:50%;background:var(--navy-soft);}
  .card .label{font-size:9.5px;color:var(--grey);margin-bottom:5px;font-weight:600;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .card .value{font-size:14.5px;font-weight:700;color:var(--navy);line-height:1.25;font-variant-numeric:tabular-nums;word-break:break-word;}
  .card .sub{font-size:9.5px;color:var(--grey);margin-top:4px;}
  .card.warn::before{background:var(--orange);} .card.warn .value{color:var(--navy);}
  .card.good::before{background:var(--green-dark);} .card.good .value{color:var(--green-dark);}
  table{width:100%;border-collapse:collapse;margin-bottom:4px;table-layout:fixed;}
  th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.02em;color:var(--grey);padding:7px 9px;background:#FAFBFD;border-bottom:1px solid var(--border);font-weight:600;}
  td{padding:7px 9px;font-size:11px;border-bottom:1px solid var(--border);color:var(--text);word-wrap:break-word;overflow-wrap:break-word;line-height:1.4;}
  tr:last-child td{border-bottom:none;}
  .footer{margin-top:32px;padding-top:14px;border-top:1px solid var(--border);font-size:9.5px;color:var(--grey-light);text-align:center;}
  .summary-box{background:var(--navy-soft);border-radius:8px;padding:14px 16px;margin:0 0 6px;}
  .summary-box p{margin:0 0 9px;font-size:11.5px;line-height:1.6;color:var(--text);}
  .summary-box ul{margin:0;padding-left:16px;}
  .summary-box li{font-size:11px;line-height:1.7;color:var(--text);}
  .summary-box strong{color:var(--navy);}
  .stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;}
  .stat-box{border:1px solid var(--border);border-radius:8px;padding:10px 11px;min-width:0;}
  .stat-box .label{font-size:9.5px;color:var(--grey);text-transform:uppercase;letter-spacing:.02em;margin-bottom:5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .stat-box .value{font-size:14px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;word-break:break-word;line-height:1.25;}
  .stat-box.variance-over .value{color:var(--navy);}
  .stat-box.variance-under .value{color:var(--green);}
  .bar-track{background:#E5E9ED;border-radius:999px;height:9px;overflow:hidden;margin:6px 0 4px;}
  .bar-fill{height:100%;border-radius:999px;}
  .bar-label{font-size:10px;color:var(--grey);}
  .cat-pill{display:inline-block;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:700;white-space:nowrap;}
  .empty-note{text-align:center;color:var(--grey-light);padding:18px;font-size:11px;border:1px dashed var(--border);border-radius:8px;}
  .mini-chart-label{font-size:9.5px;font-weight:700;color:var(--grey);text-transform:uppercase;letter-spacing:.03em;margin:14px 0 4px;}
  .mini-chart-box{border:1px solid var(--border);border-radius:8px;padding:8px 10px 4px;}
  .mini-chart-legend{display:flex;flex-wrap:wrap;gap:12px;padding:2px 2px 8px;}
  .mini-chart-legend span{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;color:var(--text);font-weight:600;}
  .mini-chart-legend i{width:8px;height:8px;border-radius:50%;display:inline-block;}
  @media print{
    body{background:#fff;padding:0;}
    .page{width:auto;min-height:0;margin:0;padding:14mm 13mm;box-shadow:none;}
    h2{break-after:avoid;page-break-after:avoid;}
    table{break-inside:auto;}
    tr{break-inside:avoid;page-break-inside:avoid;}
    .summary-box,.card,.stat-box,.mini-chart-box{break-inside:avoid;page-break-inside:avoid;}
  }`;

function buildMonthlySummary(month, yearSel, completed, totalExpense, monthlyBudget, scheduled, categoryStatsMonth, incidentEntriesMonth) {
  let budgetStatusText;
  if (!monthlyBudget) {
    budgetStatusText = 'no average monthly budget has been set';
  } else if (totalExpense > monthlyBudget) {
    budgetStatusText = `exceeds the average monthly budget by ${fmtRp(totalExpense - monthlyBudget)}`;
  } else {
    budgetStatusText = `remains under the average monthly budget, saving ${fmtRp(monthlyBudget - totalExpense)}`;
  }

  const topCategory = categoryStatsMonth.filter(c => c.totalActual > 0).sort((a, b) => b.totalActual - a.totalActual)[0] || null;
  const topItem = completed.length ? completed.reduce((max, r) => r.cost > max.cost ? r : max, completed[0]) : null;
  const incidentCount = incidentEntriesMonth.length;
  const incidentTotal = incidentEntriesMonth.reduce((s, e) => s + e.cost, 0);

  const narrative = `In <strong>${MONTH_NAMES_FULL[month - 1]} ${yearSel}</strong>, <strong>${completed.length} task(s)</strong> were completed with a total expense of <strong>${fmtRp(totalExpense)}</strong>${monthlyBudget ? ` (average monthly budget: ${fmtRp(Math.round(monthlyBudget))})` : ''}. Spending this month ${budgetStatusText}, while <strong>${scheduled.length} task(s)</strong> remain scheduled or unfinished for this month.`;

  const bullets = [];
  if (topCategory) bullets.push(`Largest expense category this month: <strong>${topCategory.label}</strong> (${fmtRp(topCategory.totalActual)})`);
  if (topItem && topItem.cost > 0) bullets.push(`Highest single-cost task: <strong>${escapeHtml(topItem.name)}</strong> (${fmtRp(topItem.cost)})`);
  bullets.push(incidentCount > 0
    ? `<strong>${incidentCount} incident(s)</strong> recorded this month, totaling ${fmtRp(incidentTotal)}`
    : 'No incidents recorded this month');
  bullets.push(`Monthly budget status: ${budgetStatusText}`);
  bullets.push(`<strong>${scheduled.length} task(s)</strong> still scheduled or unfinished this month`);

  return `<div class="summary-box"><p>${narrative}</p><ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul></div>`;
}

function buildMonthlyReportHtml(yearSel, month, tasks) {
  const genDate = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ymKey = `${yearSel}-${String(month).padStart(2, '0')}`;

  const completed = [];
  tasks.forEach(it => {
    (it.history || []).forEach(h => {
      if (h.date && h.date.slice(0, 7) === ymKey) {
        completed.push({ name: it.name, area: it.area, type: it.type, date: h.date, cost: Number(h.cost || 0), notes: h.notes || '' });
      }
    });
  });
  completed.sort((a, b) => a.date < b.date ? -1 : 1);
  const totalExpense = completed.reduce((s, r) => s + r.cost, 0);

  const scheduled = tasks.filter(it => it.nextDue && it.nextDue.slice(0, 7) === ymKey && computeStatus(it).key !== 'done');
  scheduled.sort((a, b) => (a.nextDue || '') < (b.nextDue || '') ? -1 : 1);

  const totalAnnualBudget = tasks.reduce((s, it) => s + Number(it.annualBudget || 0), 0);
  const monthlyBudget = totalAnnualBudget / 12;

  const catTotals = {}, catTx = {};
  categoryDefs.forEach(c => { catTotals[c.key] = 0; catTx[c.key] = 0; });
  completed.forEach(r => { catTotals[r.type] = (catTotals[r.type] || 0) + r.cost; catTx[r.type] = (catTx[r.type] || 0) + 1; });
  const categoryStatsMonth = categoryDefs.map(c => ({
    ...c,
    transactions: catTx[c.key] || 0,
    totalActual: catTotals[c.key] || 0,
    pct: totalExpense ? Math.round(((catTotals[c.key] || 0) / totalExpense) * 100) : 0
  }));

  const incidentEntriesMonth = completed.filter(r => r.type === 'Insidental').map(r => ({ date: r.date, name: r.name, area: r.area, cost: r.cost, notes: r.notes }));
  incidentEntriesMonth.sort((a, b) => a.date < b.date ? 1 : -1);

  const completedRows = completed.length ? completed.map(r => `<tr><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.area || '-')}</td><td>${catLabel(r.type)}</td><td style="text-align:right">${fmtRp(r.cost)}</td><td>${escapeHtml(r.notes || '-')}</td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:#828282;">No tasks completed this month</td></tr>';
  const scheduledRows = scheduled.length ? scheduled.map(it => `<tr><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.area || '-')}</td><td>${escapeHtml(it.pic || '-')}</td><td>${fmtDate(it.nextDue)}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:#828282;">None</td></tr>';

  const summaryHtml = buildMonthlySummary(month, yearSel, completed, totalExpense, monthlyBudget, scheduled, categoryStatsMonth, incidentEntriesMonth);

  const variance = monthlyBudget ? totalExpense - monthlyBudget : null;
  const varianceClass = variance == null ? '' : (variance > 0 ? 'variance-over' : 'variance-under');
  const varianceLabel = variance == null ? 'N/A' : (variance > 0 ? `+${fmtRp(variance)}` : `-${fmtRp(Math.abs(variance))}`);
  const daysInMonth = new Date(yearSel, month, 0).getDate();
  const dailyByType = {};
  categoryDefs.forEach(c => { dailyByType[c.key] = new Array(daysInMonth).fill(0); });
  completed.forEach(r => { const day = Number(r.date.slice(8, 10)); if (day >= 1 && day <= daysInMonth && dailyByType[r.type]) dailyByType[r.type][day - 1] += r.cost; });
  const dayLabels = buildDayLabels(daysInMonth);
  const dailySeries = categoryDefs
    .map(c => ({ name: c.label, color: c.chartColor, values: dailyByType[c.key] }))
    .filter(s => s.values.some(v => v > 0));
  const dailyChartSvg = buildMultiTimeseries(dayLabels, dailySeries, { height: 110 });
  const dailyChartHtml = dailyChartSvg
    ? `<div class="mini-chart-label">Daily Expense Trend by Category</div><div class="mini-chart-box">${dailyChartSvg}</div>`
    : `<div class="mini-chart-label">Daily Expense Trend by Category</div><div class="empty-note">No expense recorded this month yet.</div>`;

  const expenseSummaryHtml = `
    <div class="stat-row">
      <div class="stat-box"><div class="label">Avg Monthly Budget</div><div class="value">${fmtRp(Math.round(monthlyBudget))}</div></div>
      <div class="stat-box"><div class="label">Actual Expense</div><div class="value">${fmtRp(totalExpense)}</div></div>
      <div class="stat-box ${varianceClass}"><div class="label">Variance</div><div class="value">${varianceLabel}</div></div>
      <div class="stat-box"><div class="label">Tasks Completed</div><div class="value">${completed.length}</div></div>
    </div>
    ${buildBudgetBar(totalExpense, monthlyBudget)}
    ${dailyChartHtml}`;

  const categoryRows = categoryStatsMonth.map(c => `<tr><td>${catPill(c)}</td><td>${c.transactions}</td><td style="text-align:right">${fmtRp(c.totalActual)}</td><td style="text-align:right">${c.pct}%</td></tr>`).join('');
  const categoryHtml = categoryStatsMonth.some(c => c.transactions > 0)
    ? `<table><thead><tr><th>Category</th><th>Entries</th><th style="text-align:right">Total Actual</th><th style="text-align:right">% of Expense</th></tr></thead><tbody>${categoryRows}</tbody></table>`
    : `<div class="empty-note">No completed tasks recorded this month.</div>`;

  const incidentRowsMonth = incidentEntriesMonth.map(e => `<tr><td>${fmtDate(e.date)}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.area || '-')}</td><td style="text-align:right">${fmtRp(e.cost)}</td><td>${escapeHtml(e.notes || '-')}</td></tr>`).join('');
  const incidentHtmlMonth = incidentEntriesMonth.length
    ? `<table><thead><tr><th>Date</th><th>Incident</th><th>Area</th><th style="text-align:right">Cost</th><th>Notes</th></tr></thead><tbody>${incidentRowsMonth}</tbody></table>`
    : `<div class="empty-note">No incidents recorded this month.</div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>YK Watchtower — Monthly Report ${MONTH_NAMES_FULL[month - 1]} ${yearSel}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>${REPORT_STYLE}</style></head>
<body><div class="page">
  <div class="report-header">
    <div class="report-eyebrow">YK Watchtower &middot; Yogyakarta Office</div>
    <h1>Monthly Report</h1>
    <div class="meta">${MONTH_NAMES_FULL[month - 1]} ${yearSel} &middot; Generated ${genDate}</div>
  </div>

  <div class="cards" style="grid-template-columns:repeat(3,1fr);">
    <div class="card"><div class="label">Tasks Completed</div><div class="value">${completed.length}</div></div>
    <div class="card"><div class="label">Actual Expense</div><div class="value">${fmtRp(totalExpense)}</div></div>
    <div class="card"><div class="label">Avg Monthly Budget</div><div class="value">${fmtRp(Math.round(monthlyBudget))}</div></div>
  </div>

  <h2>Executive Summary</h2>
  ${summaryHtml}

  <h2>Expense Summary</h2>
  ${expenseSummaryHtml}

  <h2>Category Recap</h2>
  ${categoryHtml}

  <h2>Incident Highlights</h2>
  ${incidentHtmlMonth}

  <h2>Completed This Month</h2>
  <table><thead><tr><th>Date</th><th>Task</th><th>Area</th><th>Type</th><th style="text-align:right">Cost</th><th>Notes</th></tr></thead><tbody>${completedRows}</tbody></table>

  <h2>Scheduled / Still Due This Month</h2>
  <table><thead><tr><th>Task</th><th>Area</th><th>Handled By</th><th>Due Date</th></tr></thead><tbody>${scheduledRows}</tbody></table>

  <div class="footer">YK Watchtower &middot; Internal Tool &middot; qiscus.com</div>
</div></body></html>`;
}

function getPreviousMonth() {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // already "previous month" in 1-indexed terms
  if (month === 0) { month = 12; year -= 1; }
  return { year, month };
}

// Generates and serves the Monthly Report as a downloadable HTML file.
// Defaults to last month if no year/month query params are given — this is
// what the biweekly Slack digest links to.
app.get('/api/reports/monthly', async (req, res) => {
  try {
    const prev = getPreviousMonth();
    const year = Number(req.query.year) || prev.year;
    const month = Number(req.query.month) || prev.month;
    const tasks = await fetchAllTasks();
    const html = buildMonthlyReportHtml(year, month, tasks);
    const filename = `office-maintenance-monthly-${year}-${String(month).padStart(2, '0')}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to generate report');
  }
});

// ---------- Slack Daily Reminder Digest ----------
function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00');
  const b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

async function buildReminderLists() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query('SELECT * FROM tasks');
  const overdue = [];
  const soon = [];
  rows.forEach(t => {
    if (!t.next_due) return; // not scheduled
    if (!t.frequency_days && t.completed_once) return; // one-off already done
    if (t.next_due < today) { overdue.push(t); return; }
    const diff = daysBetween(today, t.next_due);
    if (diff <= 7) soon.push(t);
  });
  overdue.sort((a, b) => a.next_due < b.next_due ? -1 : 1);
  soon.sort((a, b) => a.next_due < b.next_due ? -1 : 1);
  return { today, overdue, soon };
}

function fmtDateHuman(d) {
  if (!d) return '-';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function taskLine(t, isOverdue) {
  const area = t.area ? ` — ${t.area}` : '';
  const dateLabel = isOverdue ? `was due ${fmtDateHuman(t.next_due)}` : `due ${fmtDateHuman(t.next_due)}`;
  return `• *${t.name}*${area} — ${dateLabel}`;
}

async function sendSlackDigest({ force } = {}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('SLACK_WEBHOOK_URL not set — skipping reminder digest.');
    return { sent: false, reason: 'no_webhook' };
  }
  const { today, overdue, soon } = await buildReminderLists();
  if (!overdue.length && !soon.length && !force) {
    console.log('No overdue/due-soon tasks today — skipping Slack digest.');
    return { sent: false, reason: 'nothing_due' };
  }

  // Defaults to @here (notifies active members of the channel). Set SLACK_MENTION
  // to something else (e.g. a specific <@USER_ID>) or to '' (empty) to disable it,
  // without needing a new code deploy.
  const mention = process.env.SLACK_MENTION ?? '<!here>';

  const dateLabel = fmtDateHuman(today);
  let text = `:bell: *YK Watchtower — Daily Reminder* (${dateLabel})`;
  if (mention) text += ` ${mention}`;
  text += '\n';
  if (overdue.length) {
    text += `\n*\u{1F534} Overdue (${overdue.length})*\n` + overdue.map(t => taskLine(t, true)).join('\n') + '\n';
  }
  if (soon.length) {
    text += `\n*\u{1F7E1} Due Soon \u2264 7 days (${soon.length})*\n` + soon.map(t => taskLine(t, false)).join('\n') + '\n';
  }
  if (!overdue.length && !soon.length) {
    text += '\n:white_check_mark: Nothing overdue or due soon today — all clear!\n';
  }
  if (SITE_URL) text += `\n<${SITE_URL}|Open dashboard>`;

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('Slack webhook failed:', resp.status, body);
    return { sent: false, reason: 'webhook_error', status: resp.status };
  }
  console.log(`Slack digest sent: ${overdue.length} overdue, ${soon.length} due soon.`);
  return { sent: true, overdueCount: overdue.length, soonCount: soon.length };
}

// Manual trigger — lets you test the Slack webhook by simply visiting the URL
// in a browser (GET) or via curl/dashboard (POST). Always sends (even if
// nothing is due), so it also doubles as a quick "is Slack connected?" check.
app.all('/api/send-reminder-now', async (req, res) => {
  try {
    const result = await sendSlackDigest({ force: true });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to send Slack reminder' });
  }
});

// Scheduled digest — 10:00 Jakarta time (WIB), weekdays only (Mon-Fri).
// The "Due Soon <= 7 days" window already covers weekend due-dates on Friday's
// run, and Monday's run naturally catches anything that became overdue over
// the weekend — so no extra day-shifting logic is needed here.
cron.schedule('0 10 * * 1-5', () => {
  sendSlackDigest().catch(err => console.error('Scheduled Slack digest failed:', err));
}, { timezone: 'Asia/Jakarta' });

// ---------- Biweekly Status Digest (doubles as a "system is alive" heartbeat) ----------
// Sent every other Monday, regardless of whether anything is due — its mere
// arrival confirms the server + cron + Slack webhook are all still working.
// If it stops showing up, that's the signal something broke silently.
function isBiweeklyWeek(d) {
  const anchor = new Date(Date.UTC(2026, 0, 5)); // a known Monday, used only to fix the every-2-weeks phase
  const diffWeeks = Math.floor((d - anchor) / (7 * 86400000));
  return diffWeeks % 2 === 0;
}

async function buildBiweeklyStats() {
  const now = new Date();
  const year = now.getFullYear();
  const today = now.toISOString().slice(0, 10);

  const tasksRes = await pool.query('SELECT * FROM tasks');
  const tasks = tasksRes.rows;
  const totalTasks = tasks.length;
  const totalAnnualBudget = tasks.reduce((s, t) => s + Number(t.annual_budget || 0), 0);

  let overdueCount = 0, soonCount = 0;
  tasks.forEach(t => {
    if (!t.next_due) return;
    if (!t.frequency_days && t.completed_once) return;
    if (t.next_due < today) { overdueCount++; return; }
    if (daysBetween(today, t.next_due) <= 7) soonCount++;
  });

  const historyRes = await pool.query(
    `SELECT COALESCE(SUM(cost),0)::numeric AS total FROM history WHERE date >= $1 AND date <= $2`,
    [`${year}-01-01`, `${year}-12-31`]
  );
  const yearActual = Number(historyRes.rows[0].total);
  const budgetPct = totalAnnualBudget ? Math.round((yearActual / totalAnnualBudget) * 100) : null;

  return { totalTasks, overdueCount, soonCount, totalAnnualBudget, yearActual, budgetPct, year };
}

function fmtRpServer(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

async function sendBiweeklyDigest() {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('SLACK_WEBHOOK_URL not set — skipping biweekly digest.');
    return { sent: false, reason: 'no_webhook' };
  }
  const s = await buildBiweeklyStats();
  const dateLabel = fmtDateHuman(new Date().toISOString().slice(0, 10));
  const prev = getPreviousMonth();
  const prevMonthLabel = `${MONTH_NAMES_FULL[prev.month - 1]} ${prev.year}`;

  let text = `:bar_chart: *YK Watchtower — Biweekly Status* (${dateLabel})\n`;
  text += `:white_check_mark: System check: reminders are running normally.\n\n`;
  text += `*Snapshot:*\n`;
  text += `• Total Tasks: ${s.totalTasks}\n`;
  text += `• Overdue: ${s.overdueCount}\n`;
  text += `• Due Soon (\u22647 days): ${s.soonCount}\n`;
  text += `• Actual Expense ${s.year}: ${fmtRpServer(s.yearActual)}`;
  text += s.totalAnnualBudget ? ` (${s.budgetPct}% of annual budget ${fmtRpServer(s.totalAnnualBudget)})\n` : ' (annual budget not set)\n';
  if (SITE_URL) {
    text += `\n<${SITE_URL}|Open dashboard>`;
    text += `  ·  <${SITE_URL}/api/reports/monthly?year=${prev.year}&month=${prev.month}|\u{1F4C4} Download ${prevMonthLabel} Report>`;
  }

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('Slack webhook failed (biweekly):', resp.status, body);
    return { sent: false, reason: 'webhook_error', status: resp.status };
  }
  console.log('Biweekly status digest sent.');
  return { sent: true };
}

// Manual trigger for testing the biweekly digest without waiting for its actual turn.
app.all('/api/send-biweekly-now', async (req, res) => {
  try {
    const result = await sendBiweeklyDigest();
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to send biweekly digest' });
  }
});

cron.schedule('0 10 * * 1', () => {
  const now = new Date();
  if (isBiweeklyWeek(now)) {
    sendBiweeklyDigest().catch(err => console.error('Biweekly digest failed:', err));
  }
}, { timezone: 'Asia/Jakarta' });

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
