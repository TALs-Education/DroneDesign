// Cross-checks every value in the app DB against DataSheets/*.txt.
// Usage: node tools/check-datasheets.mjs   (exit code 1 on mismatch)
import fs from 'node:fs';
import path from 'node:path';
import {loadApp, ROOT} from './load-app.mjs';

const {DB} = loadApp();
const errors = [];
const notes = new Set();
const read = (dir) => fs.readdirSync(path.join(ROOT, 'DataSheets', dir))
  .map(f => ({file:`${dir}/${f}`, data:JSON.parse(fs.readFileSync(path.join(ROOT, 'DataSheets', dir, f), 'utf8'))}));
const eq = (file, what, sheet, app) => {
  if (sheet !== app) errors.push(`${file}: ${what} datasheet=${JSON.stringify(sheet)} app=${JSON.stringify(app)}`);
};

for (const {file, data} of read('Motors')) {
  const m = DB.motors.find(x => x.manufacturer === data.manufacturer && data.model.startsWith(x.model));
  if (!m) { errors.push(`${file}: motor not in app DB`); continue; }
  eq(file, 'weight_g', data.weight_g, m.weight_g);
  eq(file, 'stator', `${data.stator_dimensions.diameter_mm}×${data.stator_dimensions.height_mm} mm`, m.stator);
  eq(file, 'url', data.url, m.url);
  for (const c of data.configurations) {
    const cfg = m.configs.find(x => x.kv === c.kv_rating);
    if (!cfg) { errors.push(`${file}: ${c.kv_rating}KV missing`); continue; }
    if (c.max_current_a != null) eq(file, `${c.kv_rating}KV max_current_a`, c.max_current_a, cfg.max_current_a);
    if (c.internal_resistance_mohm != null) eq(file, `${c.kv_rating}KV ir_mohm`, c.internal_resistance_mohm, cfg.ir_mohm);
    for (const p of c.experimental_bench_data) {
      // Cell count: stated, else derived from power ÷ current (3.7 V/cell), else the target voltage.
      const measuredV = p.power_w ? p.power_w / p.current_a : p.voltage_v;
      const ck = (p.cell_count || (measuredV ? `${Math.round(measuredV / 3.7)}S` : (c.target_voltage.match(/(\d)S/) || [])[0]) || '').toLowerCase();
      const stated = (c.target_voltage.match(/^(\d)S\b/) || [])[1];
      if (!p.cell_count && stated && `${stated}s` !== ck)
        notes.add(`${file}: ${c.kv_rating}KV target "${c.target_voltage}" but power ÷ current gives ${ck.toUpperCase()} voltage → bench data treated as ${ck.toUpperCase()}`);
      if (measuredV && p.efficiency_g_w && Math.abs(p.thrust_g / (measuredV * p.current_a) - p.efficiency_g_w) / p.efficiency_g_w > 0.03)
        errors.push(`${file}: ${c.kv_rating}KV ${p.throttle_pct}% efficiency ${p.efficiency_g_w} g/W ≠ thrust/(V·I)`);
      const pt = (cfg.bench[ck] || []).find(b => b.t === p.throttle_pct);
      if (!pt) { errors.push(`${file}: ${c.kv_rating}KV ${ck} ${p.throttle_pct}% missing`); continue; }
      eq(file, `${c.kv_rating}KV ${ck} ${p.throttle_pct}% thrust`, p.thrust_g, pt.thrust);
      eq(file, `${c.kv_rating}KV ${ck} ${p.throttle_pct}% current`, p.current_a, pt.current);
    }
  }
}
for (const {file, data} of read('Propellers')) {
  const p = DB.props.find(x => x.model.endsWith(data.model));
  if (!p) { errors.push(`${file}: prop not in app DB`); continue; }
  eq(file, 'diameter', data.size_inch, p.diameter_in);
  eq(file, 'pitch', data.pitch_inch, p.pitch_in);
  eq(file, 'blades', data.num_blades, p.blades);
  eq(file, 'weight', data.weight_g_per_prop ?? data.weight_g_per_prop_hub_assembly, p.weight_g);
  eq(file, 'url', data.url, p.url);
}
for (const {file, data} of read('Battery')) {
  for (const b of DB.batteries.filter(x => x.model.startsWith(data.model))) {
    eq(file, `${b.id} capacity`, data.nominal_capacity_mah, b.capacity_mah);
    eq(file, `${b.id} voltage`, +(data.nominal_voltage_v * b.cells).toFixed(2), b.voltage_v);
    eq(file, `${b.id} weight`, data.weight_g * b.cells, b.weight_g);
    eq(file, `${b.id} cont A`, data.max_continuous_discharge_current_a, b.max_continuous_a);
    eq(file, `${b.id} peak A`, data.peak_discharge_current_a, b.peak_a);
  }
}
for (const {file, data} of read('Electronics')) {
  const e = DB.escs.find(x => data.model.startsWith(x.model));
  if (e) {
    eq(file, 'continuous', data.current_ratings.continuous_a, e.continuous_a);
    eq(file, 'peak', data.current_ratings.peak_burst_a, e.peak_a);
    eq(file, 'weight', data.weight_g, e.weight_g);
    eq(file, 'max S', +data.power_input_range.cell_count_lipo.match(/(\d)S\s*$/)[1], e.voltage_max_s);
  } else if (data.model === DB.fc.model) {
    eq(file, 'weight', data.weight_g.with_battery_cable, DB.fc.weight_g);
    eq(file, 'PDB A', data.esc_interface.max_onboard_current_per_motor_a, DB.fc.onboard_max_per_motor_a);
  } else {
    const a = DB.addons.find(x => x.model === data.model);
    if (!a) { errors.push(`${file}: not in app DB`); continue; }
    eq(file, 'weight', data.weight_g, a.weight_g);
    eq(file, 'current', data.power_requirements.typical_current_consumption_ma / 1000, a.current_draw_a);
  }
}
notes.forEach(n => console.log(`note: ${n}`));
console.log(errors.length ? errors.join('\n') : 'All app DB values match DataSheets/.');
process.exit(errors.length ? 1 : 0);
