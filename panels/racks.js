kit.page('racks', function () {
  // ---- pure aggregations (also used by /tmp/r3check.js) ----
  function rackStats(uplinks) {
    let broken = 0, part = 0, full = 0, up = 0, tot = 0;
    for (const l of (uplinks || [])) { up += l.up; tot += l.count; if (l.up < l.count) broken++; if (l.up === 0) full++; else if (l.up < l.count) part++; }
    return { uplinks: (uplinks || []).length, broken, part, full, up, tot };
  }
  function buildAggregations(model, uplinksFn) {
    const racks = model.devices.filter(d => d.tier === 'top_of_rack');
    const info = new Map(); racks.forEach(d => info.set(d.id, rackStats(uplinksFn(d.id))));
    const siteCodes = model.sites.map(s => s.code);
    const bounds = new Map();
    for (const code of siteCodes) {
      const sr = racks.filter(d => d.site === code);
      if (!sr.length) { bounds.set(code, { minRow: 1, maxRow: 0, minCol: 1, maxCol: 0, rows: 0, cols: 0 }); continue; }
      const rs = sr.map(d => d.row || 1), cs = sr.map(d => d.col || 1);
      const b = { minRow: Math.min(...rs), maxRow: Math.max(...rs), minCol: Math.min(...cs), maxCol: Math.max(...cs) };
      b.rows = b.maxRow - b.minRow + 1; b.cols = b.maxCol - b.minCol + 1; bounds.set(code, b);
    }
    const occupied = new Map(); // site -> Set "row,col"
    for (const code of siteCodes) occupied.set(code, new Set(racks.filter(d => d.site === code).map(d => (d.row || 1) + ',' + (d.col || 1))));
    function agg(list) {
      return { racks: list.length, racksBroken: list.filter(d => info.get(d.id).broken > 0).length, racksFull: list.filter(d => info.get(d.id).full > 0).length, racksPart: list.filter(d => info.get(d.id).part > 0).length, brokenUplinks: list.reduce((n, d) => n + info.get(d.id).broken, 0), drained: list.filter(d => d.drained).length };
    }
    const pods = [], rows = [], sitesAgg = [];
    for (const code of siteCodes) {
      const sr = racks.filter(d => d.site === code), b = bounds.get(code), occ = occupied.get(code);
      const podNums = [...new Set(sr.map(d => d.pod))].sort((a, b) => a - b);
      for (const p of podNums) {
        const pr = sr.filter(d => d.pod === p), prows = [...new Set(pr.map(d => d.row || 1))];
        let empty = 0; for (const r of prows) for (let c = b.minCol; c <= b.maxCol; c++) if (!occ.has(r + ',' + c)) empty++;
        pods.push(Object.assign({ site: code, pod: p, empty }, agg(pr)));
      }
      const rowNums = [...new Set(sr.map(d => d.row || 1))].sort((a, b) => a - b);
      for (const r of rowNums) {
        const rr = sr.filter(d => (d.row || 1) === r);
        let empty = 0; for (let c = b.minCol; c <= b.maxCol; c++) if (!occ.has(r + ',' + c)) empty++;
        const a = agg(rr); rows.push({ site: code, row: r, pods: [...new Set(rr.map(d => d.pod))].sort((a2, b2) => a2 - b2).join(', '), racks: a.racks, racksBroken: a.racksBroken, brokenUplinks: a.brokenUplinks, drained: a.drained, empty });
      }
      const a = agg(sr);
      sitesAgg.push({ site: code, racks: a.racks, pods: podNums.length, rows: b.rows, cols: b.cols, racksBroken: a.racksBroken, brokenUplinks: a.brokenUplinks, racksPart: a.racksPart, racksFull: a.racksFull, drained: a.drained, empty: Math.max(0, b.rows * b.cols - occ.size) });
    }
    const rackRows = racks.map(d => { const i = info.get(d.id); return { id: d.id, site: d.site, pod: d.pod, row: d.row, col: d.col, uplinks: i.uplinks, broken: i.broken, part: i.part, full: i.full, drained: d.drained ? 'yes' : 'no' }; });
    pods.sort((a, b) => String(a.site).localeCompare(String(b.site)) || a.pod - b.pod);
    rows.sort((a, b) => String(a.site).localeCompare(String(b.site)) || a.row - b.row);
    sitesAgg.sort((a, b) => String(a.site).localeCompare(String(b.site)));
    rackRows.sort((a, b) => String(a.site).localeCompare(String(b.site)) || (a.pod - b.pod) || (a.row - b.row) || (a.col - b.col));
    return { racks, info, bounds, pods, rows, sites: sitesAgg, rackRows };
  }
  let cleanup = null;
  let legendOpen = true; // survives re-mounts (not reloads)
  function disposePrev() { if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; } }
  return {
    aggregations: { rackStats, buildAggregations },
    resize() { if (cleanup && cleanup.__resize) cleanup.__resize(); },
    mount(el, model, kit) {
      disposePrev(); el.innerHTML = '';
      const COL = { ok: '#4a4c52', part: '#fab219', down: '#d03b3b', off: '#a9a8a2', empty: '#2f3035', disc: '#17181b', bg: '#0b0c0e', accent: '#7c83ff', ss: '#3a3c42' };
      const WORD = { ok: 'OK', part: 'Partly down', down: 'Down', off: 'Turned off' };
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const fmt = n => Number(n).toLocaleString('en-US');
      const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const siteName = c => kit.siteName(c);

      // ---------- data ----------
      const A = buildAggregations(model, id => kit.uplinks(id));
      const byId = new Map(model.devices.map(d => [d.id, d]));
      const siteCodes = model.sites.map(s => s.code);
      const spines = model.devices.filter(d => d.tier === 'spine');
      const supers = model.devices.filter(d => d.tier === 'super_spine');
      const statsOf = new Map(A.info);
      spines.forEach(d => statsOf.set(d.id, rackStats(kit.uplinks(d.id))));
      function statusOf(d) { if (d.drained) return 'off'; const s = statsOf.get(d.id); if (!s) return 'ok'; if (s.full > 0) return 'down'; if (s.part > 0) return 'part'; return 'ok'; }
      const linkStatus = l => l.up === 0 ? 'down' : (l.up < l.count ? 'part' : 'ok');

      // ---------- layout ----------
      let maxRows = 1, maxCols = 1;
      A.bounds.forEach(b => { maxRows = Math.max(maxRows, b.rows); maxCols = Math.max(maxCols, b.cols); });
      const DISC_R = 0.5 * Math.hypot(maxCols + 1, maxRows + 1) + 1.6;
      const SP_Y = 7, SS_Y = 12.5;
      const n = siteCodes.length;
      const STEP = n > 1 ? 3 : 0;
      const BASE = n > 1 ? Math.max(DISC_R + 7, (DISC_R + 3) / Math.sin(Math.PI / n)) : 0;
      const siteCenter = new Map();
      siteCodes.forEach((c, i) => { const r = BASE + i * STEP, a = -Math.PI / 2 + i * 2 * Math.PI / n; siteCenter.set(c, { x: r * Math.cos(a), z: r * Math.sin(a), orbit: r }); });
      const SYS_R = (n > 1 ? BASE + (n - 1) * STEP : 0) + DISC_R;

      // devices drawn: racks, spines (+ super-spines as context)
      const drawn = [];  // {d, x,y,z,w,h,dp, kind}
      const idx = new Map();
      function localXZ(code, row, col) { const b = A.bounds.get(code), c = siteCenter.get(code); return { x: c.x + (col - b.minCol) - (b.cols - 1) / 2, z: c.z + (row - b.minRow) - (b.rows - 1) / 2 }; }
      const podInfo = new Map(); // key site|pod -> {site,pod,x0,x1,z0,z1,cx,cz,racks:[],spines:[]}
      const pkey = (s, p) => s + '|' + p;
      for (const d of A.racks) {
        const p = localXZ(d.site, d.row || 1, d.col || 1); const st = statusOf(d);
        idx.set(d.id, drawn.length); drawn.push({ d, kind: 'rack', x: p.x, z: p.z, y: 0, w: 0.72, dp: 0.72, h: st === 'down' ? 0.95 : 0.55 });
        const k = pkey(d.site, d.pod); if (!podInfo.has(k)) podInfo.set(k, { site: d.site, pod: d.pod, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, racks: [], spines: [] });
        const pi = podInfo.get(k); pi.racks.push(d.id); pi.x0 = Math.min(pi.x0, p.x); pi.x1 = Math.max(pi.x1, p.x); pi.z0 = Math.min(pi.z0, p.z); pi.z1 = Math.max(pi.z1, p.z);
      }
      podInfo.forEach(pi => { pi.cx = (pi.x0 + pi.x1) / 2; pi.cz = (pi.z0 + pi.z1) / 2; });
      const spinesByPod = new Map();
      for (const d of spines) { const k = pkey(d.site, d.pod); if (!podInfo.has(k)) continue; if (!spinesByPod.has(k)) spinesByPod.set(k, []); spinesByPod.get(k).push(d); }
      spinesByPod.forEach((list, k) => {
        const pi = podInfo.get(k); list.sort((a, b) => (a.plane || 0) - (b.plane || 0) || a.id.localeCompare(b.id));
        const sp = Math.min(1.6, (pi.x1 - pi.x0 + 1) / list.length);
        list.forEach((d, i) => { const st = statusOf(d); idx.set(d.id, drawn.length); pi.spines.push(d.id); drawn.push({ d, kind: 'spine', x: pi.cx + (i - (list.length - 1) / 2) * sp, z: pi.cz, y: SP_Y, w: Math.min(1.0, sp * 0.7), dp: 0.5, h: st === 'down' ? 0.5 : 0.32 }); });
      });
      for (const code of siteCodes) {
        const list = supers.filter(d => d.site === code).sort((a, b) => (a.plane || 0) - (b.plane || 0) || a.id.localeCompare(b.id)); if (!list.length) continue;
        const c = siteCenter.get(code), b = A.bounds.get(code), sp = Math.min(1.5, (Math.max(b.cols, 4) + 2) / list.length);
        list.forEach((d, i) => { idx.set(d.id, drawn.length); drawn.push({ d, kind: 'super', x: c.x + (i - (list.length - 1) / 2) * sp, z: c.z, y: SS_Y, w: Math.min(0.9, sp * 0.7), dp: 0.45, h: 0.28 }); });
      }
      const top = o => new THREE.Vector3(o.x, o.y + o.h, o.z), bottom = o => new THREE.Vector3(o.x, o.y, o.z);
      // links (rack->spine, spine->super)
      const links = [];
      for (const o of drawn) {
        if (o.kind === 'super') continue;
        for (const l of kit.uplinks(o.d.id)) {
          const peer = l.a === o.d.id ? l.b : l.a; if (!idx.has(peer)) continue; const po = drawn[idx.get(peer)];
          const a = top(o), b = bottom(po);
          links.push({ from: o.d.id, to: peer, site: o.d.site, pod: o.d.pod, kind: o.kind, st: linkStatus(l), a, b });
        }
      }

      // ---------- DOM ----------
      const root = document.createElement('div'); root.className = 'rkx';
      const style = document.createElement('style');
      style.textContent = `
.rkx{position:absolute;inset:0;background:#0b0c0e;color:#f0efec;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.rkx *{box-sizing:border-box}
.rkx canvas{display:block;position:absolute;inset:0;outline:none}
.rkx .rkx-lab{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.rkx .rkx-l{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font-size:12px;color:#a9a8a2;transition:opacity 150ms}
.rkx .rkx-l.site{font-size:14px;color:#f0efec;pointer-events:auto;cursor:pointer;padding:2px 6px;border-radius:6px}
.rkx .rkx-l.site:hover{background:rgba(255,255,255,.06)}
.rkx .rkx-l.sun,.rkx .rkx-l.rowl,.rkx .rkx-l.tier{color:#76756f}
.rkx .rkx-l.rowl{transform:translate(0,-50%)}
.rkx .rkx-l.pod{transform:translate(0,-100%)}
.rkx .rkx-panel{background:#141518;border:1px solid rgba(255,255,255,.06);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.rkx .rkx-top{position:absolute;left:12px;top:12px;max-width:calc(100% - 420px);display:flex;flex-direction:column;align-items:flex-start;gap:8px;pointer-events:none}
.rkx .rkx-top>*{pointer-events:auto}
.rkx .rkx-tc{padding:10px 12px}.rkx .rkx-crumbs{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.rkx button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;border-radius:6px;transition:background 150ms,color 150ms,border-color 150ms}
.rkx button:focus-visible,.rkx input:focus-visible{outline:2px solid #7c83ff;outline-offset:1px}
.rkx .rkx-crumbs button{padding:3px 6px;color:#a9a8a2}
.rkx .rkx-crumbs button:hover{background:rgba(255,255,255,.06);color:#f0efec}
.rkx .rkx-crumbs button.last{color:#7c83ff}
.rkx .rkx-crumbs .sep{color:#76756f}
.rkx .rkx-crumbs .back{color:#f0efec;margin-right:2px}
.rkx .rkx-hint{font-size:12px;color:#76756f;margin-top:6px}
.rkx .rkx-sum{font-size:12px;color:#a9a8a2;padding:7px 10px}.rkx .rkx-sum b{color:#f0efec;font-weight:600}
.rkx kbd{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#a9a8a2;border:1px solid rgba(255,255,255,.12);border-bottom-width:2px;border-radius:4px;padding:0 4px;margin:0 2px}
.rkx .rkx-bl{position:absolute;left:12px;bottom:12px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-height:calc(100% - 150px);pointer-events:none}
.rkx .rkx-bl>*{pointer-events:auto}
.rkx .rkx-card{width:300px;max-height:min(340px,calc(100vh - 380px));overflow:auto;padding:12px 14px}
.rkx .rkx-card h4{margin:0 0 6px;font-size:13px;font-weight:600}
.rkx .rkx-card p{margin:0 0 8px;color:#a9a8a2;font-size:12px}
.rkx .rkx-card .cnt{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:#a9a8a2;margin-bottom:8px}
.rkx .dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:0}
.rkx .dot.off{background:none;border:1px solid #a9a8a2}
.rkx .chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.rkx .chip{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 6px;border:1px solid rgba(255,255,255,.08);background:#1b1c1f;color:#f0efec}
.rkx .chip:hover{border-color:rgba(255,255,255,.25)}
.rkx .lrow{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 0;border-top:1px solid rgba(255,255,255,.05);align-items:center}
.rkx .lrow .rnum{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#a9a8a2;white-space:nowrap}
.rkx .link{color:#f0efec;padding:4px 0;font-size:12px}
.rkx .link:hover{color:#7c83ff}
.rkx .rkx-leg{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.rkx .rkx-leg .head{display:flex;align-items:center;gap:7px;padding:7px 11px;font-size:12px;color:#f0efec;background:#141518;border:1px solid rgba(255,255,255,.08);border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.rkx .rkx-leg .head:hover{border-color:#7c83ff}
.rkx .rkx-leg .head .chev{transition:transform 150ms;color:#a9a8a2;transform:rotate(180deg)}
.rkx .rkx-leg.closed .chev{transform:none}
.rkx .rkx-leg .body{width:240px;padding:8px 6px}
.rkx .rkx-leg.closed .body{display:none}
.rkx .leg{display:grid;grid-template-columns:22px auto 1fr;align-items:center;gap:6px;width:100%;padding:3px 4px;text-align:left;font-size:12px}
.rkx .leg:hover{background:rgba(255,255,255,.04)}
.rkx .leg.on{background:rgba(124,131,255,.12)}
.rkx .leg .d{color:#76756f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rkx .leg.static{cursor:default}.rkx .leg.static:hover{background:none}
.rkx .rkx-leg .sec{font-size:11px;color:#76756f;padding:6px 4px 2px}
.rkx .rkx-leg .tot{font-size:12px;color:#76756f;padding:6px 4px 0;border-top:1px solid rgba(255,255,255,.05);margin-top:4px}
.rkx .rkx-side{position:absolute;top:12px;right:12px;bottom:12px;width:380px;display:flex;flex-direction:column;overflow:hidden}
.rkx .rkx-sec{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.06)}
.rkx .rkx-sec h3{margin:0 0 8px;font-size:13px;font-weight:600}
.rkx .find{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.rkx .find button{text-align:left;font-size:12px;line-height:1.3;padding:7px 8px;border:1px solid rgba(255,255,255,.08);color:#a9a8a2;background:#1b1c1f}
.rkx .find button:hover{color:#f0efec;border-color:rgba(255,255,255,.2)}
.rkx .find button.on{background:#7c83ff;border-color:#7c83ff;color:#0b0c0e}
.rkx .rkx-tabs{display:flex;gap:2px;padding:8px 14px 0}
.rkx .rkx-tabs button{padding:6px 10px;color:#a9a8a2;border-bottom:2px solid transparent;border-radius:0}
.rkx .rkx-tabs button:hover{color:#f0efec}
.rkx .rkx-tabs button.on{color:#f0efec;border-bottom-color:#7c83ff}
.rkx .sub{font-size:12px;color:#76756f;padding:6px 14px 0}
.rkx .filt{position:relative;margin:8px 14px}
.rkx .filt input{width:100%;font:12px system-ui,-apple-system,"Segoe UI",sans-serif;color:#f0efec;background:#0b0c0e;border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:6px 52px 6px 8px}
.rkx .filt .x{position:absolute;right:28px;top:3px;padding:2px 6px;color:#76756f}
.rkx .filt .x:hover{color:#f0efec}
.rkx .filt kbd{position:absolute;right:6px;top:5px}
.rkx .tw{flex:1;overflow:auto;border-top:1px solid rgba(255,255,255,.06)}
.rkx table{border-collapse:collapse;width:100%;font-size:12px}
.rkx th{position:sticky;top:0;background:#141518;color:#a9a8a2;font-weight:500;text-align:left;padding:6px 5px;line-height:1.25;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.08);white-space:nowrap;vertical-align:bottom}
.rkx th:hover{color:#f0efec}
.rkx th.n,.rkx td.n{text-align:right}
.rkx th.s{color:#f0efec}
.rkx td{height:28px;padding:0 5px;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap}
.rkx td.n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;color:#a9a8a2}
.rkx td.s{background:rgba(124,131,255,.08);color:#f0efec}
.rkx tr{cursor:pointer;transition:background 150ms}
.rkx tbody tr:hover{background:rgba(255,255,255,.04)}
.rkx tr.first td{box-shadow:inset 0 1px 0 rgba(240,239,236,.5),inset 0 -1px 0 rgba(240,239,236,.5)}
.rkx .more{font-size:12px;color:#76756f;padding:8px 14px}
.rkx .rkx-tip{position:absolute;pointer-events:none;display:none;background:#1b1c1f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 10px;font-size:12px;color:#a9a8a2;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:300px}
.rkx .rkx-tip b{color:#f0efec;font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace}
.rkx .rkx-tip .m{color:#76756f;margin-top:4px}
`;
      root.appendChild(style);
      el.appendChild(root);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(COL.bg);
      root.appendChild(renderer.domElement);
      renderer.domElement.tabIndex = 0;
      const labLayer = document.createElement('div'); labLayer.className = 'rkx-lab'; root.appendChild(labLayer);
      const topBox = document.createElement('div'); topBox.className = 'rkx-top'; root.appendChild(topBox);
      const tc = document.createElement("div"); tc.className = "rkx-tc rkx-panel"; topBox.appendChild(tc); const crumbs = document.createElement("nav"); crumbs.className = "rkx-crumbs"; tc.appendChild(crumbs);
      const hint = document.createElement('div'); hint.className = 'rkx-hint';
      hint.innerHTML = 'Click a site, then a pod, then a device. <kbd>Esc</kbd> goes back. Drag to rotate.'; tc.appendChild(hint);
      const sum = document.createElement('div'); sum.className = "rkx-sum rkx-panel"; topBox.appendChild(sum);
      const bl = document.createElement('div'); bl.className = 'rkx-bl'; root.appendChild(bl);
      const card = document.createElement('div'); card.className = 'rkx-card rkx-panel'; card.style.display = 'none'; bl.appendChild(card);
      const leg = document.createElement('div'); leg.className = "rkx-leg"; bl.appendChild(leg);
      const side = document.createElement('div'); side.className = 'rkx-side rkx-panel'; root.appendChild(side);
      const tip = document.createElement('div'); tip.className = 'rkx-tip'; root.appendChild(tip);

      // ---------- scene ----------
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 6000);
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !reduced; controls.dampingFactor = 0.1; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 4; controls.maxDistance = SYS_R * 8;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1b1e, 1.5));
      const sunLight = new THREE.DirectionalLight(0xffffff, 1.3); sunLight.position.set(40, 90, 60); scene.add(sunLight);
      const disposables = [];
      const keep = x => { disposables.push(x); return x; };
      function radialTex(stops) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(s => gr.addColorStop(s[0], s[1])); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return keep(new THREE.CanvasTexture(c)); }
      // stars
      { const N = 350, pos = new Float32Array(N * 3); let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < N; i++) { const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = SYS_R * 12; const q = Math.sqrt(1 - u * u); pos[i * 3] = r * q * Math.cos(t); pos[i * 3 + 1] = Math.abs(r * u) * 0.8 + r * 0.05; pos[i * 3 + 2] = r * q * Math.sin(t); }
        const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        scene.add(new THREE.Points(g, keep(new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.3 })))); }
      // sun
      if (n > 1) {
        const sun = new THREE.Mesh(keep(new THREE.SphereGeometry(2.2, 48, 24)), keep(new THREE.MeshBasicMaterial({ color: 0xf4efe6 }))); sun.position.y = 1.5; scene.add(sun);
        const halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(244,239,230,0.5)'], [0.35, 'rgba(244,239,230,0.12)'], [1, 'rgba(244,239,230,0)']]), depthWrite: false, transparent: true })));
        halo.scale.set(13, 13, 1); halo.position.copy(sun.position); scene.add(halo);
      }
      function circle(r, y, color, opacity) { const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))); } return new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(pts)), keep(new THREE.LineBasicMaterial({ color, transparent: true, opacity }))); }
      const discMeshes = [];
      const shadowTex = radialTex([[0, 'rgba(0,0,0,0.55)'], [0.7, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]);
      const discGeo = keep(new THREE.CylinderGeometry(DISC_R, DISC_R, 0.6, 128)), discMat = keep(new THREE.MeshStandardMaterial({ color: COL.disc, roughness: 0.9, metalness: 0 }));
      const shadowGeo = keep(new THREE.PlaneGeometry(DISC_R * 2.5, DISC_R * 2.5)), shadowMat = keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
      for (const code of siteCodes) {
        const c = siteCenter.get(code);
        if (n > 1) scene.add(circle(c.orbit, -0.6, 0xffffff, 0.08));
        const disc = new THREE.Mesh(discGeo, discMat); disc.position.set(c.x, -0.3, c.z); disc.userData.site = code; scene.add(disc); discMeshes.push(disc);
        const rim = circle(DISC_R, 0.005, 0xffffff, 0.10); rim.position.set(c.x, 0, c.z); scene.add(rim);
        const sh = new THREE.Mesh(shadowGeo, shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.set(c.x, -1.6, c.z); scene.add(sh);
      }
      // empty spots + pod outlines (one LineSegments each)
      { const ep = [], po = [];
        const sq = (arr, x, z, h, y) => { arr.push(x - h, y, z - h, x + h, y, z - h, x + h, y, z - h, x + h, y, z + h, x + h, y, z + h, x - h, y, z + h, x - h, y, z + h, x - h, y, z - h); };
        for (const code of siteCodes) { const b = A.bounds.get(code); const occ = new Set(A.racks.filter(d => d.site === code).map(d => (d.row || 1) + ',' + (d.col || 1)));
          for (let r = b.minRow; r <= b.maxRow; r++) for (let c = b.minCol; c <= b.maxCol; c++) if (!occ.has(r + ',' + c)) { const p = localXZ(code, r, c); sq(ep, p.x, p.z, 0.34, 0.01); } }
        podInfo.forEach(pi => { const x0 = pi.x0 - 0.55, x1 = pi.x1 + 0.55, z0 = pi.z0 - 0.55, z1 = pi.z1 + 0.55, y = 0.01; po.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0); });
        const mk = (arr, color, op) => { const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); const m = new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color, transparent: true, opacity: op }))); scene.add(m); return m; };
        if (ep.length) mk(ep, 0x55565c, 0.7); mk(po, 0xffffff, 0.07); }
      // devices: one InstancedMesh
      const boxGeo = keep(new THREE.BoxGeometry(1, 1, 1)); boxGeo.translate(0, 0.5, 0);
      const devMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 }));
      const mesh = new THREE.InstancedMesh(boxGeo, devMat, drawn.length);
      { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
        drawn.forEach((o, i) => { p.set(o.x, o.y, o.z); s.set(o.w, o.h, o.dp); m4.compose(p, q, s); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, new THREE.Color(COL.ok)); }); }
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); scene.add(mesh);
      // drained: hollow wireframe boxes
      const edgeGeo = keep(new THREE.EdgesGeometry(boxGeo));
      const offMat = keep(new THREE.LineBasicMaterial({ color: COL.off, transparent: true, opacity: 1 }));
      const offObjs = [];
      drawn.forEach(o => { if (o.kind !== 'super' && o.d.drained) { const ln = new THREE.LineSegments(edgeGeo, offMat.clone()); keep(ln.material); ln.position.set(o.x, o.y, o.z); ln.scale.set(o.w, o.h, o.dp); ln.userData.o = o; scene.add(ln); offObjs.push(ln); } });
      // outlines for hover / selection
      const selBox = new THREE.LineSegments(edgeGeo, keep(new THREE.LineBasicMaterial({ color: 0xffffff }))); selBox.visible = false; scene.add(selBox);
      const hovBox = new THREE.LineSegments(edgeGeo, keep(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }))); hovBox.visible = false; scene.add(hovBox);
      function placeBox(b, o) { if (!o) { b.visible = false; return; } b.visible = true; b.position.set(o.x, o.y - 0.04, o.z); b.scale.set(o.w + 0.22, o.h + 0.12, o.dp + 0.22); }
      // link layers
      function lineLayer(color, opacity, cap) { const g = keep(new THREE.BufferGeometry()); const arr = new Float32Array(Math.max(6, cap * 6)); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); g.setDrawRange(0, 0); const m = new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))); m.frustumCulled = false; scene.add(m); return m; }
      const L = { faint: lineLayer(0xffffff, 0.06, links.length), focus: lineLayer(0x8a8c93, 0.75, links.length), part: lineLayer(COL.part, 1, links.length), down: lineLayer(COL.down, 1, links.length), dimBroken: lineLayer(0x8a5a40, 0.25, links.length) };
      function fill(layer, list) { const a = layer.geometry.attributes.position.array; let k = 0; for (const l of list) { a[k++] = l.a.x; a[k++] = l.a.y; a[k++] = l.a.z; a[k++] = l.b.x; a[k++] = l.b.y; a[k++] = l.b.z; } layer.geometry.attributes.position.needsUpdate = true; layer.geometry.setDrawRange(0, list.length * 2); }

      // ---------- labels ----------
      const labels = [];
      function addLabel(cls, text, pos, onClick) { const e = document.createElement('div'); e.className = 'rkx-l ' + cls; e.textContent = text; if (onClick) e.addEventListener('click', onClick); labLayer.appendChild(e); const L2 = { e, pos, show: true, cls }; labels.push(L2); return L2; }
      if (n > 1) addLabel('sun', model.name || 'Topology', new THREE.Vector3(0, -1.5, 3.2)).e.style.transform = 'translate(-50%,0)';
      const siteLabels = new Map(), podLabels = [], rowLabels = [], tierLabels = [];
      for (const code of siteCodes) { const c = siteCenter.get(code); siteLabels.set(code, addLabel('site', siteName(code), new THREE.Vector3(c.x, SS_Y + 2.2, c.z), () => go({ level: 'site', site: code }))); }
      podInfo.forEach(pi => { const L2 = addLabel('pod', 'Pod ' + pi.pod, new THREE.Vector3(pi.x0 - 0.5, 0.05, pi.z0 - 0.6)); L2.site = pi.site; L2.pod = pi.pod; podLabels.push(L2); });
      for (const code of siteCodes) { const b = A.bounds.get(code); const rset = new Set(A.racks.filter(d => d.site === code).map(d => d.row || 1));
        rset.forEach(r => { const p = localXZ(code, r, b.maxCol); const L2 = addLabel('rowl', 'Row ' + r, new THREE.Vector3(p.x + 0.9, 0.05, p.z)); L2.site = code; L2.row = r; rowLabels.push(L2); });
        const c = siteCenter.get(code); const sp = podInfo.size ? null : null;
        const t1 = addLabel('tier', 'Spines', new THREE.Vector3(c.x - (b.cols / 2) - 2.2, SP_Y + 0.4, c.z)); t1.site = code; tierLabels.push(t1);
        if (supers.some(d => d.site === code)) { const t2 = addLabel('tier', 'Super-spines', new THREE.Vector3(c.x - (b.cols / 2) - 2.2, SS_Y + 0.4, c.z)); t2.site = code; tierLabels.push(t2); } }
      let labelsDirty = true;
      const v3 = new THREE.Vector3();
      let W = 1, H = 1;
      const PRI = { site: 0, tier: 1, pod: 2, rowl: 3, sun: 4 };
      const placed = [];
      function updateLabels() {
        placed.length = 0;
        const order = labels.slice().sort((a, b) => PRI[a.cls] - PRI[b.cls]);
        for (const L2 of order) {
          if (!L2.show) { if (L2.e.style.display !== 'none') L2.e.style.display = 'none'; continue; }
          v3.copy(L2.pos).project(camera);
          const x = (v3.x + 1) / 2 * W, y = (1 - v3.y) / 2 * H;
          // label box estimate (matches each class's CSS transform)
          const w = L2.e.textContent.length * (L2.cls === 'site' ? 8 : 6.6) + 12, h = L2.cls === 'site' ? 20 : 16;
          const x0 = L2.cls === 'rowl' || L2.cls === 'pod' ? x : x - w / 2, y0 = L2.cls === 'rowl' ? y - h / 2 : (L2.cls === 'sun' ? y : y - h);
          let ok = !(v3.z > 1 || x0 < 0 || x0 + w > W - PW + 10 || y0 < 0 || y0 + h > H);
          if (ok) for (const r of placed) if (x0 < r[2] && x0 + w > r[0] && y0 < r[3] && y0 + h > r[1]) { ok = false; break; }
          if (!ok) { L2.e.style.display = 'none'; continue; }
          placed.push([x0, y0, x0 + w, y0 + h]);
          L2.e.style.display = ''; L2.e.style.left = x.toFixed(1) + 'px'; L2.e.style.top = y.toFixed(1) + 'px';
        }
      }

      // ---------- camera ----------
      const PW = 400;
      const POLAR = 35 * Math.PI / 180;
      function fitDist(r) { const fv = camera.fov * Math.PI / 180, asp = Math.max(0.4, (W - PW) / H); const half = Math.min(fv / 2, Math.atan(Math.tan(fv / 2) * asp)); return r / Math.sin(half); }
      let tween = null;
      function flyTo(target, dist, instant) {
        const off = new THREE.Vector3().subVectors(camera.position, controls.target); let az = Math.atan2(off.x, off.z); if (!isFinite(az)) az = 0;
        const dir = new THREE.Vector3(Math.sin(az) * Math.cos(POLAR), Math.sin(POLAR), Math.cos(az) * Math.cos(POLAR));
        const endPos = target.clone().add(dir.multiplyScalar(dist));
        if (instant || reduced) { camera.position.copy(endPos); controls.target.copy(target); controls.update(); labelsDirty = true; tween = null; return; }
        tween = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: endPos, q1: target.clone() };
      }
      function viewFor(nv) {
        if (nv.level === 'system') return { t: new THREE.Vector3(0, 3, 0), d: fitDist(SYS_R * 0.9) };
        const c = siteCenter.get(nv.site);
        if (nv.level === 'site') return { t: new THREE.Vector3(c.x, 4, c.z), d: fitDist(DISC_R * 1.05) };
        const pi = podInfo.get(pkey(nv.site, nv.pod));
        if (nv.level === 'pod' || !idx.has(nv.id)) return { t: new THREE.Vector3(pi.cx, SP_Y * 0.45, pi.cz), d: fitDist(Math.max(pi.x1 - pi.x0, SP_Y) / 2 + 1.5) };
        const o = drawn[idx.get(nv.id)];
        return { t: new THREE.Vector3((o.x + pi.cx) / 2, SP_Y * 0.45, (o.z + pi.cz) / 2), d: fitDist(Math.max(pi.x1 - pi.x0, SP_Y) / 2 + 1) };
      }
      function resize() {
        const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; W = w; H = h;
        renderer.setSize(w, h); camera.aspect = (w + PW) / h; camera.setViewOffset(w + PW, h, PW, 0, w, h); camera.updateProjectionMatrix(); labelsDirty = true; layoutBL();
      }

      // ---------- state ----------
      let nav = { level: 'system' };
      let statusFilter = null;
      let hoverId = null;
      const devStatus = drawn.map(o => o.kind === 'super' ? 'ok' : statusOf(o.d));
      const inScope = (d, nv) => nv.level === 'system' || (d.site === nv.site && (nv.level === 'site' || d.pod === nv.pod));
      const tmpC = new THREE.Color(), discS = new THREE.Color(COL.disc).convertLinearToSRGB(), colC = { ok: new THREE.Color(COL.ok), part: new THREE.Color(COL.part), down: new THREE.Color(COL.down), off: new THREE.Color('#1d1e22'), super: new THREE.Color(COL.ss) };
      function recolor() {
        drawn.forEach((o, i) => {
          const st = devStatus[i];
          let c = o.kind === 'super' ? colC.super : colC[st];
          let lit = o.kind === 'super' ? (nav.level === 'system' || o.d.site === nav.site) : inScope(o.d, nav);
          if (statusFilter && (o.kind === 'super' || st !== statusFilter)) lit = false;
          tmpC.copy(c); if (!lit) tmpC.convertLinearToSRGB().lerp(discS, 0.85).convertSRGBToLinear();
          mesh.setColorAt(i, tmpC);
        });
        mesh.instanceColor.needsUpdate = true;
        offObjs.forEach(ln => { const o = ln.userData.o; ln.material.opacity = (inScope(o.d, nav) && (!statusFilter || statusFilter === 'off')) ? 1 : 0.15; });
      }
      function rebuildLinks() {
        const f = [], fo = [], pa = [], dn = [], dim = [];
        for (const l of links) {
          const inF = nav.level === 'system' ? true : (l.site === nav.site && (nav.level === 'site' || (l.kind === 'rack' ? l.pod === nav.pod : l.pod === nav.pod)));
          const devFocus = nav.level === 'device' ? (l.from === nav.id || l.to === nav.id) : true;
          const filtOk = !statusFilter || (l.kind === 'rack' && devStatus[idx.get(l.from)] === statusFilter);
          if (l.st === 'ok') { if (inF && nav.level !== 'system' && nav.level !== 'site' && devFocus && filtOk) fo.push(l); else f.push(l); }
          else if (inF && filtOk) (l.st === 'down' ? dn : pa).push(l); else dim.push(l);
        }
        fill(L.faint, f); fill(L.focus, fo); fill(L.part, pa); fill(L.down, dn); fill(L.dimBroken, dim);
        L.faint.material.opacity = nav.level === 'system' ? 0.06 : 0.035;
      }
      function labelVis() {
        const deep = nav.level !== 'system';
        podLabels.forEach(L2 => { L2.show = deep && L2.site === nav.site; L2.e.style.opacity = (nav.level === 'site' || L2.pod === nav.pod) ? 1 : 0.35; });
        rowLabels.forEach(L2 => { L2.show = deep && L2.site === nav.site; });
        tierLabels.forEach(L2 => { L2.show = deep && L2.site === nav.site; });
        siteLabels.forEach((L2, code) => { L2.e.style.opacity = (!deep || code === nav.site) ? 1 : 0.35; });
        labelsDirty = true;
      }

      // ---------- breadcrumb + summary ----------
      function parentOf(nv) { if (nv.level === 'device') return { level: 'pod', site: nv.site, pod: nv.pod }; if (nv.level === 'pod') return { level: 'site', site: nv.site }; return { level: 'system' }; }
      function renderCrumbs() {
        const parts = [['All sites', { level: 'system' }]];
        if (nav.level !== 'system') parts.push([siteName(nav.site), { level: 'site', site: nav.site }]);
        if (nav.level === 'pod' || nav.level === 'device') parts.push(['Pod ' + nav.pod, { level: 'pod', site: nav.site, pod: nav.pod }]);
        if (nav.level === 'device') parts.push([nav.id, nav]);
        crumbs.innerHTML = '';
        const back = document.createElement('button'); back.className = 'back'; back.textContent = '← Back'; back.disabled = nav.level === 'system'; back.style.opacity = back.disabled ? 0.4 : 1; back.onclick = () => go(parentOf(nav)); crumbs.appendChild(back);
        parts.forEach((p, i) => { if (i) { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '›'; crumbs.appendChild(s); } const b = document.createElement('button'); b.textContent = p[0]; if (i === parts.length - 1) b.className = 'last'; b.onclick = () => go(p[1]); crumbs.appendChild(b); });
      }
      function scopeRacks(nv) { return A.racks.filter(d => inScope(d, nv)); }
      function renderSummary() {
        const rs = scopeRacks(nav); const c = { ok: 0, part: 0, down: 0, off: 0 }; rs.forEach(d => c[statusOf(d)]++);
        let empty, label, pods;
        if (nav.level === 'system') { empty = A.sites.reduce((s, x) => s + x.empty, 0); label = 'All sites'; pods = A.pods.length; }
        else if (nav.level === 'site') { const s = A.sites.find(x => x.site === nav.site); empty = s ? s.empty : 0; label = siteName(nav.site); pods = s ? s.pods : 0; }
        else { const p = A.pods.find(x => x.site === nav.site && x.pod === nav.pod); empty = p ? p.empty : 0; label = siteName(nav.site) + ' · Pod ' + nav.pod; pods = 1; }
        sum.innerHTML = "<b>" + esc(label) + "</b> · " + [fmt(pods) + (pods === 1 ? ' pod' : ' pods'), fmt(rs.length) + ' racks', fmt(c.down) + ' down', fmt(c.part) + ' partly down', fmt(c.off) + ' turned off', fmt(empty) + " empty spots"].join(" · ");
      }

      // ---------- legend ----------
      const SW = {
        ok: '<svg width="18" height="14"><rect x="4" y="4" width="10" height="8" rx="1.5" fill="#4a4c52"/></svg>',
        part: '<svg width="18" height="14"><rect x="4" y="4" width="10" height="8" rx="1.5" fill="#fab219"/></svg>',
        down: '<svg width="18" height="14"><rect x="4" y="1" width="10" height="12" rx="1.5" fill="#d03b3b"/></svg>',
        off: '<svg width="18" height="14"><rect x="4.5" y="4.5" width="9" height="7" rx="1" fill="none" stroke="#a9a8a2"/></svg>',
        empty: '<svg width="18" height="14"><rect x="4.5" y="3.5" width="9" height="9" fill="none" stroke="#55565c"/></svg>',
        spine: '<svg width="18" height="14"><rect x="1" y="5" width="16" height="4" rx="1" fill="#4a4c52"/></svg>',
        superS: '<svg width="18" height="14"><rect x="2" y="5" width="14" height="4" rx="1" fill="#3a3c42"/></svg>',
        lok: '<svg width="18" height="14"><line x1="1" y1="7" x2="17" y2="7" stroke="rgba(255,255,255,.3)"/></svg>',
        lpart: '<svg width="18" height="14"><line x1="1" y1="7" x2="17" y2="7" stroke="#fab219" stroke-width="2"/></svg>',
        ldown: '<svg width="18" height="14"><line x1="1" y1="7" x2="17" y2="7" stroke="#d03b3b" stroke-width="2"/></svg>',
      };
      let autoCollapsed = false;
      function renderLegend() {
        const open = legendOpen && !autoCollapsed;
        leg.className = "rkx-leg" + (open ? '' : ' closed');
        const c = { ok: 0, part: 0, down: 0, off: 0 }; drawn.forEach((o, i) => { if (o.kind !== 'super') c[devStatus[i]]++; });
        const row = (key, sw, word, def) => `<button class="leg${statusFilter === key ? ' on' : ''}" data-k="${key}" title="Click to show only ${word.toLowerCase()} devices; click again to clear">${SW[sw]}<span>${word}</span><span class="d">${def}</span></button>`;
        const srow = (sw, word, def) => `<div class="leg static">${SW[sw]}<span>${word}</span><span class="d">${def}</span></div>`;
        leg.innerHTML = `<div class="body rkx-panel">
${row('ok', 'ok', 'OK', 'All uplinks working')}${row('part', 'part', 'Partly down', 'Some links lost')}${row('down', 'down', 'Down', 'No working links')}${row('off', 'off', 'Turned off', 'Drained on purpose')}
${srow('empty', 'Empty spot', 'No rack in this slot')}
<div class="sec">Layers, bottom to top</div>
${srow('ok', 'Rack', 'Box on the floor grid')}${srow('spine', 'Spine', 'Bar floating over its pod')}${supers.length ? srow('superS', 'Super-spine', 'Top row, for context') : ''}
<div class="sec">Lines: rack to spine uplinks</div>
${srow('lok', 'Link up', 'Faint')}${srow('lpart', 'Partly down', 'Some links lost')}${srow('ldown', 'Link down', 'No links working')}
<div class="tot">${fmt(c.ok)} OK · ${fmt(c.part)} partly · ${fmt(c.down)} down · ${fmt(c.off)} off</div></div><button class="head" aria-expanded="${open}">Legend<span class="chev">▾</span><kbd>L</kbd></button>`;
        leg.querySelector('.head').onclick = toggleLegend;
        leg.querySelectorAll('button.leg').forEach(b => b.onclick = () => { const k = b.dataset.k; statusFilter = statusFilter === k ? null : k; recolor(); rebuildLinks(); renderLegend(); renderTable(); });
      }
      function toggleLegend() { if (autoCollapsed) { autoCollapsed = false; legendOpen = true; } else legendOpen = !legendOpen; renderLegend(); }
      function layoutBL() { const cardOpen = card.style.display !== 'none'; const tight = H < 820; const want = cardOpen && tight && legendOpen; if (want !== autoCollapsed) { autoCollapsed = want; renderLegend(); } }

      // ---------- detail card ----------
      function chip(id) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = id; return b; }
      function renderCard() {
        if (nav.level !== 'pod' && nav.level !== 'device') { card.style.display = 'none'; layoutBL(); return; }
        card.style.display = ''; card.innerHTML = '';
        const pi = podInfo.get(pkey(nav.site, nav.pod));
        if (nav.level === 'pod') {
          const ids = pi.racks.concat(pi.spines); const c = { ok: 0, part: 0, down: 0, off: 0 }; ids.forEach(id => c[devStatus[idx.get(id)]]++);
          const pa = A.pods.find(x => x.site === nav.site && x.pod === nav.pod);
          card.insertAdjacentHTML('beforeend', `<h4>${esc(siteName(nav.site))} · Pod ${esc(nav.pod)}</h4><p>${fmt(pi.racks.length)} racks and ${fmt(pi.spines.length)} spines${pa ? ' · ' + fmt(pa.empty) + ' empty spots' : ''}</p>
<div class="cnt"><span>Racks and spines:</span><span><i class="dot" style="background:#4a4c52"></i>${c.ok} OK</span><span><i class="dot" style="background:#fab219"></i>${c.part} partly down</span><span><i class="dot" style="background:#d03b3b"></i>${c.down} down</span><span><i class="dot off"></i>${c.off} turned off</span></div>`);
          const bad = ids.filter(id => devStatus[idx.get(id)] !== 'ok');
          if (bad.length) { const ch = document.createElement('div'); ch.className = 'chips'; bad.forEach(id => { const b = chip(id); b.title = WORD[devStatus[idx.get(id)]]; b.insertAdjacentHTML('afterbegin', dotHtml(devStatus[idx.get(id)])); b.onclick = () => go({ level: 'device', site: nav.site, pod: nav.pod, id }); ch.appendChild(b); }); card.appendChild(ch); }
          else card.insertAdjacentHTML('beforeend', '<p>Every device in this pod is OK.</p>');
          if (pi.spines.length) { const a = document.createElement('button'); a.className = 'link'; a.textContent = 'Open this pod in Pods →'; a.onclick = () => { selfSel = true; try { kit.select(pi.spines[0]); } finally { selfSel = false; } kit.showPage('pods'); }; card.appendChild(a); }
        } else {
          const o = drawn[idx.get(nav.id)], st = devStatus[idx.get(nav.id)], s = statsOf.get(nav.id) || { uplinks: 0, broken: 0, full: 0, part: 0 };
          const sent = st === 'off' ? 'Turned off on purpose (drained).' : st === 'down' ? `Down: ${s.full} of ${s.uplinks} uplinks have no working links.` : st === 'part' ? `Partly down: ${s.part} of ${s.uplinks} uplinks lost some links.` : `OK: all ${s.uplinks} uplinks working.`;
          card.insertAdjacentHTML('beforeend', `<h4>${dotHtml(st)}${esc(nav.id)}</h4><p>${esc(sent)}<br>${esc(siteName(o.d.site))} · Pod ${esc(o.d.pod)}${o.kind === 'rack' ? ' · row ' + o.d.row + ', col ' + o.d.col : ' · spine'}</p>`);
          const rows = [];
          for (const l of kit.linksOf(nav.id)) { const peer = l.a === nav.id ? l.b : l.a; const pd = byId.get(peer); if (!pd) continue; const up = kit.uplinks(nav.id).includes(l); rows.push({ l, peer, pd, up }); }
          rows.sort((a, b) => (b.up - a.up) || a.peer.localeCompare(b.peer));
          for (const r of rows) {
            const d = document.createElement('div'); d.className = 'lrow'; const b = chip(r.peer); b.textContent = (r.up ? '↑ ' : '↓ ') + r.peer;
            b.title = idx.has(r.peer) && r.pd.tier !== 'super_spine' ? 'Go to this device' : 'Open on the Pods page';
            b.onclick = () => { if (idx.has(r.peer) && r.pd.tier !== 'super_spine') go({ level: 'device', site: r.pd.site, pod: r.pd.pod, id: r.peer }); else { selfSel = true; try { kit.select(r.peer); } finally { selfSel = false; } kit.showPage('pods'); } };
            const num = document.createElement('span'); num.className = 'rnum'; num.innerHTML = dotHtml(linkStatus(r.l)) + r.l.up + '/' + r.l.count + ' working';
            d.appendChild(b); d.appendChild(num); card.appendChild(d);
          }
        }
        layoutBL();
      }
      function dotHtml(st) { return st === 'off' ? '<i class="dot off"></i>' : `<i class="dot" style="background:${COL[st] || COL.ok}"></i>`; }

      // ---------- side panel ----------
      const TABS = {
        pods: { name: 'Pods', sub: 'One row per pod. Click a row to open the pod.', id: ['site', 'pod'], cols: [['site', 'Site', 'Site name'], ['pod', 'Pod', 'Pod number'], ['racksBroken', 'Racks with<br>broken uplink', 'Racks in this pod with at least one uplink not fully working', 1], ['brokenUplinks', 'Broken<br>uplinks', 'Uplinks (rack to spine) with fewer working links than total', 1], ['racksFull', 'Racks<br>down', 'Racks with an uplink that has no working links', 1], ['drained', 'Turned<br>off', 'Racks drained on purpose', 1], ['empty', 'Empty<br>spots', 'Grid slots in this pod\'s rows with no rack', 1]] },
        rows: { name: 'Rows', sub: 'One row per floor row. Click to open its pod.', cols: [['site', 'Site', 'Site name'], ['row', 'Row', 'Row number on the floor'], ['racksBroken', 'Racks with<br>broken uplink', 'Racks in this row with at least one uplink not fully working', 1], ['empty', 'Empty<br>spots', 'Slots in this row with no rack', 1], ['brokenUplinks', 'Broken<br>uplinks', 'Uplinks with fewer working links than total', 1], ['drained', 'Turned<br>off', 'Racks drained on purpose', 1], ['racks', 'Racks', 'Racks in this row', 1]] },
        sites: { name: 'Sites', sub: 'One row per site. Click to open the site.', cols: [['site', 'Site', 'Site name'], ['racksBroken', 'Racks with<br>broken uplink', 'Racks with at least one uplink not fully working', 1], ['brokenUplinks', 'Broken<br>uplinks', 'Uplinks with fewer working links than total', 1], ['racksFull', 'Racks<br>down', 'Racks with an uplink that has no working links', 1], ['drained', 'Turned<br>off', 'Racks drained on purpose', 1], ['empty', 'Empty<br>spots', 'Grid slots with no rack', 1], ['racks', 'Racks', 'Racks at this site', 1]] },
        racks: { name: 'Racks', sub: 'One row per rack. Click to open the rack.', cols: [['id', 'Rack', 'Rack id'], ['broken', 'Broken<br>uplinks', 'Uplinks with fewer working links than total', 1], ['full', 'Uplinks<br>down', 'Uplinks with no working links', 1], ['part', 'Uplinks<br>partly', 'Uplinks that lost some links', 1], ['uplinks', 'Uplinks', 'Uplinks from this rack to spines', 1], ['drained', 'Turned<br>off', 'Drained on purpose']] },
      };
      const FIND = [
        ['Racks with a broken uplink, per pod', 'pods', 'racksBroken'], ['Broken uplinks, per pod', 'pods', 'brokenUplinks'],
        ['Racks with a broken uplink, per row', 'rows', 'racksBroken'], ['Empty spots, per row', 'rows', 'empty'],
        ['Empty spots, per site', 'sites', 'empty'], ['Turned-off racks, per site', 'sites', 'drained'],
        ['Racks fully down, per pod', 'pods', 'racksFull'], ['Broken uplinks, per rack', 'racks', 'broken'],
      ];
      let tab = 'pods', sortKey = null, sortDir = -1, activeFind = -1, filterText = '';
      side.innerHTML = `<div class="rkx-sec"><h3>Find an answer</h3><div class="find"></div></div><div class="rkx-tabs"></div><div class="sub"></div><div class="filt"><input type="text" placeholder="Filter rows" aria-label="Filter rows"><button class="x" title="Clear filter" aria-label="Clear filter">×</button><kbd>/</kbd></div><div class="tw"></div>`;
      const findBox = side.querySelector('.find'), tabsBox = side.querySelector('.rkx-tabs'), subBox = side.querySelector('.sub'), input = side.querySelector('input'), tw = side.querySelector('.tw');
      FIND.forEach((f, i) => { const b = document.createElement('button'); b.textContent = f[0]; b.onclick = () => { activeFind = i; tab = f[1]; sortKey = f[2]; sortDir = -1; renderTabs(); renderTable(); tw.scrollTop = 0; }; findBox.appendChild(b); });
      Object.keys(TABS).forEach(k => { const b = document.createElement('button'); b.textContent = TABS[k].name; b.dataset.k = k; b.onclick = () => { tab = k; sortKey = null; activeFind = -1; renderTabs(); renderTable(); tw.scrollTop = 0; }; tabsBox.appendChild(b); });
      input.addEventListener('input', () => { filterText = input.value.trim().toLowerCase(); renderTable(); });
      side.querySelector('.x').onclick = () => { input.value = ''; filterText = ''; renderTable(); input.focus(); };
      function renderTabs() { tabsBox.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === tab)); findBox.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === activeFind)); subBox.textContent = TABS[tab].sub; }
      function scopedRows() {
        let rows;
        if (tab === 'pods') rows = A.pods.filter(r => nav.level === 'system' || (r.site === nav.site && (nav.level === 'site' || r.pod === nav.pod)));
        else if (tab === 'rows') rows = A.rows.filter(r => nav.level === 'system' || (r.site === nav.site && (nav.level === 'site' || String(r.pods).split(', ').map(Number).includes(nav.pod))));
        else if (tab === 'sites') rows = A.sites.filter(r => nav.level === 'system' || r.site === nav.site);
        else rows = A.rackRows.filter(r => (nav.level === 'system' || (r.site === nav.site && (nav.level === 'site' || r.pod === nav.pod))) && (!statusFilter || devStatus[idx.get(r.id)] === statusFilter));
        if (filterText) rows = rows.filter(r => Object.keys(r).some(k => String(k === 'site' ? siteName(r.site) : r[k]).toLowerCase().includes(filterText)));
        return rows;
      }
      function renderTable() {
        const T = TABS[tab]; let rows = scopedRows().slice();
        if (sortKey) { const isNum = T.cols.find(c => c[0] === sortKey)?.[3]; rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; const r = isNum ? (x - y) : (sortKey === 'site' ? siteName(x).localeCompare(siteName(y)) : String(x).localeCompare(String(y), undefined, { numeric: true })); return r * sortDir; }); }
        const LIM = 600; const shown = rows.slice(0, LIM);
        let h = '<table><thead><tr>' + T.cols.map(c => `<th class="${c[3] ? 'n' : ''}${c[0] === sortKey ? ' s' : ''}" data-k="${c[0]}" title="${esc(c[2])}">${c[1]}${c[0] === sortKey ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('') + '</tr></thead><tbody>';
        shown.forEach((r, i) => { h += `<tr data-i="${i}"${i === 0 && sortKey && T.cols.find(c => c[0] === sortKey)?.[3] ? ' class="first"' : ''}>` + T.cols.map(c => `<td class="${c[3] ? 'n' : ''}${c[0] === sortKey ? ' s' : ''}">${esc(c[0] === 'site' ? siteName(r.site) : r[c[0]])}</td>`).join('') + '</tr>'; });
        h += '</tbody></table>'; if (rows.length > LIM) h += `<div class="more">Showing ${LIM} of ${fmt(rows.length)} rows. Use the filter to narrow.</div>`; if (!rows.length) h += '<div class="more">No rows match.</div>';
        tw.innerHTML = h;
        tw.querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.k, isNum = T.cols.find(c => c[0] === k)[3]; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = isNum ? -1 : 1; } activeFind = -1; renderTabs(); renderTable(); });
        tw.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => { const r = shown[+tr.dataset.i];
          if (tab === 'pods') go({ level: 'pod', site: r.site, pod: r.pod });
          else if (tab === 'sites') go({ level: 'site', site: r.site });
          else if (tab === 'rows') { const p = Number(String(r.pods).split(', ')[0]); go(podInfo.has(pkey(r.site, p)) ? { level: 'pod', site: r.site, pod: p } : { level: 'site', site: r.site }); }
          else { const d = byId.get(r.id); go({ level: 'device', site: d.site, pod: d.pod, id: d.id }); } });
      }

      // ---------- navigation ----------
      let selfSel = false;
      function go(nv, instant) {
        if (nv.level === 'pod' && !podInfo.has(pkey(nv.site, nv.pod))) nv = { level: 'site', site: nv.site };
        if (nv.level === 'device' && !idx.has(nv.id)) nv = { level: 'pod', site: nv.site, pod: nv.pod };
        nav = nv;
        const v = viewFor(nav); flyTo(v.t, v.d, instant);
        placeBox(selBox, nav.level === 'device' ? drawn[idx.get(nav.id)] : null);
        recolor(); rebuildLinks(); labelVis(); renderCrumbs(); renderSummary(); renderTable(); renderCard();
        if (W > 1) { controls.update(); updateLabels(); renderer.render(scene, camera); }
        if (nav.level === 'device') { selfSel = true; try { kit.select(nav.id); } finally { selfSel = false; } }
      }
      kit.onSelect(id => {
        if (selfSel || !id || (nav.level === 'device' && nav.id === id)) return;
        const d = byId.get(id); if (!d || !idx.has(id)) return;
        if (d.tier === 'top_of_rack') go({ level: 'device', site: d.site, pod: d.pod, id });
        else if (d.tier === 'spine') { if (!(nav.level === 'pod' && nav.site === d.site && nav.pod === d.pod)) go({ level: 'pod', site: d.site, pod: d.pod }); }
      });
      kit.onSearch && kit.onSearch(q => { q = String(q || '').trim(); const d = byId.get(q); if (d && idx.has(q) && d.tier !== 'super_spine') go({ level: 'device', site: d.site, pod: d.pod, id: q }); });

      // ---------- picking ----------
      const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
      function pick(e) {
        const rect = renderer.domElement.getBoundingClientRect(); mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; ray.setFromCamera(mouse, camera);
        const h = ray.intersectObject(mesh); if (h.length) return { o: drawn[h[0].instanceId] };
        const hd = ray.intersectObjects(discMeshes); if (hd.length) return { site: hd[0].object.userData.site, point: hd[0].point };
        return null;
      }
      function podAt(site, p) { let best = null, bd = 1e9; podInfo.forEach(pi => { if (pi.site !== site) return; const dx = Math.max(pi.x0 - 0.6 - p.x, 0, p.x - pi.x1 - 0.6), dz = Math.max(pi.z0 - 0.6 - p.z, 0, p.z - pi.z1 - 0.6), dd = dx + dz; if (dd < bd) { bd = dd; best = pi; } }); return bd < 0.01 ? best : null; }
      function actionFor(hit) {
        if (!hit) return null;
        const site = hit.o ? hit.o.d.site : hit.site;
        if (nav.level === 'system' || site !== nav.site) return { nv: { level: 'site', site }, text: 'Click to open ' + siteName(site) };
        if (hit.o && hit.o.kind === 'super') return null;
        if (hit.o) { const d = hit.o.d;
          if (nav.level === 'site' || d.pod !== nav.pod) return { nv: { level: 'pod', site, pod: d.pod }, text: 'Click to open pod ' + d.pod };
          return { nv: { level: 'device', site, pod: d.pod, id: d.id }, text: 'Click for details' }; }
        const pi = podAt(site, hit.point); if (pi && (nav.level === 'site' || pi.pod !== nav.pod)) return { nv: { level: 'pod', site, pod: pi.pod }, text: 'Click to open pod ' + pi.pod };
        return null;
      }
      let lastMove = null, downAt = null;
      function onMove(e) { lastMove = e; }
      function processHover() {
        if (!lastMove) return; const e = lastMove; lastMove = null;
        const hit = pick(e); const act = actionFor(hit);
        renderer.domElement.style.cursor = act ? 'pointer' : 'grab';
        if (hit && hit.o) {
          placeBox(hovBox, hit.o); const d = hit.o.d, i = idx.get(d.id);
          if (hoverId !== d.id) { hoverId = d.id;
            const st = hit.o.kind === 'super' ? null : devStatus[i]; const s = statsOf.get(d.id);
            const working = s ? `${s.uplinks - s.broken} of ${s.uplinks} uplinks fully working` : 'Context only: shown for the spine-to-super-spine lines';
            const loc = esc(siteName(d.site)) + (d.pod != null ? ' · Pod ' + d.pod : '') + (hit.o.kind === 'rack' ? ` · row ${d.row}, col ${d.col}` : hit.o.kind === 'spine' ? ' · spine' : ' · super-spine');
            tip.innerHTML = `<b>${esc(d.id)}</b><div>${st ? dotHtml(st) + WORD[st] : 'Super-spine'}</div><div>${working}</div><div>${loc}</div>${act ? `<div class="m">${act.text}</div>` : ''}`; }
        } else if (hit && act) { placeBox(hovBox, null); if (hoverId !== 'site:' + hit.site + act.text) { hoverId = 'site:' + hit.site + act.text; tip.innerHTML = `<b>${esc(siteName(hit.site))}</b><div class="m">${act.text}</div>`; } }
        else { placeBox(hovBox, null); hoverId = null; tip.style.display = 'none'; return; }
        const r = root.getBoundingClientRect(); let x = e.clientX - r.left + 14, y = e.clientY - r.top + 12; if (x > W - 420 - 200) x -= 230; tip.style.left = x + 'px'; tip.style.top = Math.min(y, H - 110) + 'px'; tip.style.display = 'block';
      }
      function onLeave() { lastMove = null; tip.style.display = 'none'; placeBox(hovBox, null); hoverId = null; }
      function onDown(e) { downAt = { x: e.clientX, y: e.clientY }; tween = null; }
      function onUp(e) { if (!downAt) return; const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null; if (moved > 5) return; const act = actionFor(pick(e)); if (act) go(act.nv); }
      const cv = renderer.domElement;
      cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerleave', onLeave); cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointerup', onUp);
      function onKey(e) {
        if (!el.offsetParent && !el.getClientRects().length) return;
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
        if (e.key === 'Escape') { if (typing) { e.target.blur(); return; } if (statusFilter) { statusFilter = null; recolor(); rebuildLinks(); renderLegend(); renderTable(); return; } if (nav.level !== 'system') go(parentOf(nav)); return; }
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === '/') { e.preventDefault(); input.focus(); input.select(); }
        else if (e.key === 'l' || e.key === 'L') toggleLegend();
      }
      window.addEventListener('keydown', onKey);
      controls.addEventListener('change', () => { labelsDirty = true; });

      // ---------- loop ----------
      let raf = 0;
      function frame(now) {
        raf = requestAnimationFrame(frame);
        if (!W || W < 2) { resize(); if (!W || W < 2) return; }
        if (tween) { const t = Math.min(1, (now - tween.t0) / 400), k = 1 - Math.pow(1 - t, 3); camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.q0, tween.q1, k); labelsDirty = true; if (t >= 1) tween = null; }
        controls.update(); processHover();
        if (labelsDirty) { labelsDirty = false; updateLabels(); }
        renderer.render(scene, camera);
      }
      const ro = window.ResizeObserver ? new ResizeObserver(() => resize()) : null; if (ro) ro.observe(el);
      W = 0; resize();
      camera.position.set(0, 50, 100); controls.target.set(0, 0, 0);
      renderTabs(); renderLegend();
      go({ level: 'system' }, true);
      raf = requestAnimationFrame(frame);

      cleanup = function () {
        cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); if (ro) ro.disconnect();
        cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave); cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointerup', onUp);
        controls.dispose(); mesh.dispose(); disposables.forEach(x => { try { x.dispose(); } catch (e) {} }); renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) {}
        el.innerHTML = '';
      };
      cleanup.__resize = resize;
    },
  };
});
