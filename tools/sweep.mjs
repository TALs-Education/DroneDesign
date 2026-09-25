// Sweeps every battery × motor/KV × prop × ESC combination across payloads using the
// app's own calculations, and reports the best error-free build per battery/payload
// and the payload capacity of each motor/prop pairing.
// Usage: node tools/sweep.mjs [--csv] [--frame 30] [--payloads 0,20,40,60,80,100]
import {loadApp} from './load-app.mjs';

const {DB, calcResults, payloadSweep, getPropStatus} = loadApp();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const csv = args.includes('--csv');
const frame = Number(opt('--frame', 30));
const payloads = opt('--payloads', '0,20,40,60,80,100').split(',').map(Number);
const f = (v, d = 1) => v == null ? '—' : v.toFixed(d);

const combos = [];
for (const b of DB.batteries) for (const m of DB.motors) for (const c of m.configs) {
  if (!c.bench[b.cell_key]) continue;
  for (const p of DB.props) for (const e of DB.escs) {
    const cfg = {battery:b.id, motorId:m.id, motorKv:c.kv, prop:p.id, esc:e.id, addonIds:[], frameWeight:frame, userPayload:0};
    combos.push({b, m, c, p, e, cfg, propStatus:getPropStatus(c, b.cell_key, p).status});
  }
}

const rows = [];
for (const k of combos) for (const payload of payloads) {
  const R = calcResults({...k.cfg, userPayload:payload});
  rows.push({k, payload, R, errs:R.warnings.filter(w => w.lvl === 'err'), warns:R.warnings.filter(w => w.lvl === 'warn')});
}

if (csv) {
  console.log('battery,motor,kv,prop,esc,payload_g,total_g,hover_throttle_pct,twr,hover_current_a,full_current_a,flight_min,prop_status,errors,warnings');
  for (const r of rows) {
    const q = s => `"${s.replace(/"/g, '""')}"`;
    console.log([r.k.b.label, r.k.m.model, r.k.c.kv, r.k.p.id, r.k.e.model, r.payload, f(r.R.total), r.R.overloaded ? '' : f(r.R.hoverThrottle),
      f(r.R.twr, 2), f(r.R.totalHoverCurrent, 2), f(r.R.fullCurrent, 2), r.R.overloaded ? '' : f(r.R.flightTime), r.k.propStatus,
      q(r.errs.map(w => w.text).join(' | ')), q(r.warns.map(w => w.text).join(' | '))].join(','));
  }
  process.exit(0);
}

const clean = r => r.errs.length === 0;
console.log(`Frame ${frame} g, no add-ons. ${combos.length} combinations × ${payloads.length} payloads = ${rows.length} evaluations, ${rows.filter(clean).length} error-free.\n`);

console.log('Best error-free build per battery and payload (longest hover time):');
for (const b of DB.batteries) {
  for (const payload of payloads) {
    const best = rows.filter(r => clean(r) && r.k.b === b && r.payload === payload).sort((a, z) => z.R.flightTime - a.R.flightTime)[0];
    console.log(`  ${b.label.padEnd(9)} +${String(payload).padStart(3)} g: ` + (best
      ? `${best.k.m.model} ${best.k.c.kv}KV + ${best.k.p.model.replace('Gemfan ', '')} + ${best.k.e.model} → ${f(best.R.total)} g, hover ${f(best.R.hoverThrottle, 0)}%, T/W ${f(best.R.twr, 2)}, ${f(best.R.totalHoverCurrent, 2)} A, ${f(best.R.flightTime)} min${best.warns.length ? ` (${best.warns.length} warn)` : ''}`
      : 'no error-free build'));
  }
}

console.log('\nPayload capacity (max payload with no errors) per battery, motor/KV, best prop + ESC:');
for (const b of DB.batteries) {
  const byMotor = new Map();
  for (const k of combos.filter(k => k.b === b)) {
    const s = payloadSweep(k.cfg, 10, 1);
    const key = `${k.m.model} ${k.c.kv}KV`;
    const prev = byMotor.get(key);
    if (!prev || (s.maxPayload ?? -1) > (prev.s.maxPayload ?? -1)) byMotor.set(key, {k, s});
  }
  console.log(`  ${b.label}:`);
  [...byMotor.entries()].sort((a, z) => (z[1].s.maxPayload ?? -1) - (a[1].s.maxPayload ?? -1)).forEach(([key, {k, s}]) =>
    console.log(`    ${key.padEnd(34)} ${s.maxPayload == null ? '  none' : (f(s.maxPayload, 1) + ' g').padStart(7)}  ${k.p.model.replace('Gemfan ', '').padEnd(20)} ${k.e.model.padEnd(7)} limit: ${s.limiter ?? '—'}`));
}
