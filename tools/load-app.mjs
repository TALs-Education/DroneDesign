// Loads the <script> block of DroneDesigner.html into a sandbox so the
// app's own DB and calculation functions can be exercised from Node.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadApp() {
  const html = fs.readFileSync(path.join(ROOT, 'DroneDesigner.html'), 'utf8');
  const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const stubEl = {innerHTML:'', addEventListener(){}, querySelectorAll:() => [], classList:{toggle(){}}};
  const ctx = {
    window:{addEventListener(){}, scrollTo(){}, scrollY:0},
    document:{getElementById:() => stubEl, querySelector:() => null, querySelectorAll:() => [], createElement:() => stubEl, body:stubEl},
    console, Math, Number, String, Object, Array, JSON, Blob:class{}, URL:{}
  };
  vm.createContext(ctx);
  // const/let at top level are not exposed on the context; re-export them.
  vm.runInContext(src + '\n;globalThis.__app = {DB, state, calcResults, getPropStatus, interpolateHover, performanceCurve, payloadSweep, renderAll};', ctx);
  return ctx.__app;
}
