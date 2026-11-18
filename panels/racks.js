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
  function disposePrev() { if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; } }
  return {
    aggregations: { rackStats, buildAggregations },
    resize() { if (cleanup && cleanup.__resize) cleanup.__resize(); },
    mount(el, model, kit) {
      disposePrev(); el.innerHTML = '';
      const P = 'rk-';
      const C = { healthy: '#2b3644', partly: '#ffb347', fully: '#ff4d6d', drained: '#b48cff', empty: '#5ee7ff', spine: '#7dd3fc', accent: '#5ee7ff' };
      const style = document.createElement('style');
      style.textContent = `
.rk-root{position:absolute;inset:0;background:#03040a;color:#dbe7f3;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
.rk-canvas{position:absolute;inset:0}.rk-canvas canvas{display:block}
.rk-legend,.rk-title{position:absolute;z-index:5;background:rgba(10,14,30,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(120,200,255,.25);border-radius:10px;box-shadow:0 0 18px rgba(94,231,255,.12);padding:9px 11px;font-size:11px;line-height:1.55}
.rk-legend{left:10px;bottom:10px;max-width:240px}.rk-title{left:10px;top:10px;font-size:12px}
.rk-legend b,.rk-title b{color:#5ee7ff;text-transform:uppercase;letter-spacing:.08em;font-size:11px}
.rk-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.rk-side{position:absolute;top:10px;right:10px;bottom:10px;width:540px;max-width:calc(100% - 20px);background:rgba(10,14,30,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(120,200,255,.25);border-radius:10px;box-shadow:0 0 18px rgba(94,231,255,.12);z-index:6;display:flex;flex-direction:column;overflow:hidden}
.rk-side h3{margin:6px 10px 2px;font-size:11px;color:#5ee7ff;letter-spacing:.08em;text-transform:uppercase}
.rk-btns{display:flex;flex-wrap:wrap;gap:5px;padding:10px 10px 2px}
.rk-btn{background:rgba(22,34,56,.8);color:#cfe0f5;border:1px solid rgba(120,200,255,.25);border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer;transition:all .18s}
.rk-btn:hover{border-color:#5ee7ff;color:#fff}.rk-btn.on{background:rgba(37,99,235,.85);border-color:#5ee7ff;color:#fff}
.rk-btn:focus-visible,.rk-tab:focus-visible,.rk-filter:focus-visible,.rk-table th:focus-visible{outline:2px solid #5ee7ff;outline-offset:1px}
.rk-toggle{display:flex;gap:7px;align-items:center;font-size:12px;padding:6px 10px;cursor:pointer}
.rk-filterrow{display:flex;gap:8px;align-items:center;padding:4px 10px}
.rk-filter{flex:1;min-width:0;background:rgba(5,10,20,.7);border:1px solid rgba(120,200,255,.3);border-radius:6px;color:#e6f4ff;padding:5px 8px;font-size:12px}
.rk-count{font-size:11px;color:#9fc6e8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.rk-tabs{display:flex;gap:4px;padding:6px 10px 0}
.rk-tab{background:rgba(22,34,56,.8);color:#a9c2e2;border:1px solid rgba(120,200,255,.25);border-bottom:none;border-radius:7px 7px 0 0;padding:5px 12px;font-size:12px;cursor:pointer;transition:all .18s}
.rk-tab:hover{color:#fff}.rk-tab.on{background:rgba(94,231,255,.16);color:#5ee7ff;border-color:rgba(120,200,255,.5)}
.rk-scroll{overflow-y:auto;overflow-x:hidden;flex:1;padding:0 6px 10px}
.rk-table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap;table-layout:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.rk-table th{position:sticky;top:0;background:rgba(19,30,51,.97);color:#a9c2e2;cursor:pointer;text-align:left;padding:3px 3px;border-bottom:1px solid rgba(120,200,255,.3);user-select:none;font-family:system-ui,sans-serif;font-size:11px}
.rk-table th:hover{background:rgba(29,47,77,.97);color:#e6f0ff}.rk-table th.sorted{color:#5ee7ff}
.rk-table td{padding:3px 3px;border-bottom:1px solid rgba(27,41,66,.8);color:#d5e3f2}
.rk-table tbody tr{cursor:pointer;transition:background .18s}.rk-table tbody tr:hover{background:rgba(94,231,255,.14);box-shadow:inset 0 0 8px rgba(94,231,255,.12)}
.rk-table tr.sel{background:rgba(35,64,110,.9)!important}
.rk-tip{position:absolute;pointer-events:none;background:rgba(5,10,20,.95);border:1px solid rgba(120,200,255,.4);border-radius:8px;padding:7px 9px;font-size:11px;z-index:9;display:none;max-width:260px;line-height:1.5}
`;
      const root = document.createElement('div'); root.className = P + 'root';
      const canvasWrap = document.createElement('div'); canvasWrap.className = P + 'canvas';
      const title = document.createElement('div'); title.className = P + 'title'; title.innerHTML = '<b>Rack floors</b> &nbsp;<span style="color:#8aa0bd">each planet = a site · racks at row/col · <b style="color:#5ee7ff">drag</b> rotate · <b style="color:#5ee7ff">scroll</b> zoom · <b style="color:#5ee7ff">click a table row</b> to fly there · <b style="color:#ffb347">click a column</b> to sort</span>';
      const legend = document.createElement('div'); legend.className = P + 'legend';
      const side = document.createElement('div'); side.className = P + 'side';
      const tip = document.createElement('div'); tip.className = P + 'tip';
      root.append(style, canvasWrap, title, legend, side, tip); el.appendChild(root);
      const AGG = buildAggregations(model, id => kit.uplinks(id));
      const racks = AGG.racks, rackInfo = AGG.info, byId = new Map(model.devices.map(d => [d.id, d]));
      const spines = model.devices.filter(d => d.tier === 'spine');
      let totBroken = 0, totPart = 0, totFull = 0, totDrained = 0;
      racks.forEach(d => { const i = rackInfo.get(d.id); totBroken += i.broken; totPart += i.part; totFull += i.full; if (d.drained) totDrained++; });
      legend.innerHTML = '<b>Legend</b><br>' +
        '<span class="' + P + 'sw" style="background:' + C.healthy + ';box-shadow:inset 0 0 0 1px rgba(94,231,255,.35)"></span>healthy rack<br>' +
        '<span class="' + P + 'sw" style="background:' + C.partly + '"></span>partly broken uplink<br>' +
        '<span class="' + P + 'sw" style="background:' + C.fully + '"></span>fully broken uplink<br>' +
        '<span class="' + P + 'sw" style="background:' + C.drained + '"></span>drained rack (violet + ring on top)<br>' +
        '<span class="' + P + 'sw" style="background:transparent;border:1px dashed ' + C.empty + '"></span>empty slot (no rack)<br>' +
        '<span class="' + P + 'sw" style="background:' + C.spine + '"></span>spine (satellite above pod)<br>' +
        '<span style="color:#6b7f99">— healthy link (faint)</span> &nbsp;<span style="color:' + C.partly + '">— partly</span> &nbsp;<span style="color:' + C.fully + '">— fully</span><br>' +
        '<b style="color:#dbe7f3;text-transform:none;letter-spacing:0">Broken links: ' + totBroken + '</b> · Partly: ' + totPart + '<br>Fully: ' + totFull + ' · Drained: ' + totDrained;

      // ---- solar layout ----
      const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const siteCodes = model.sites.map(s => s.code);
      const siteInfo = new Map();
      let maxPlanetR = 6;
      for (const code of siteCodes) {
        const b = AGG.bounds.get(code); const w = Math.max(b.cols, 1), dep = Math.max(b.rows, 1);
        const R = Math.sqrt(w * w + dep * dep) / 2 + 1.4; if (R > maxPlanetR) maxPlanetR = R;
        siteInfo.set(code, { code, b, w, dep, R, cx: 0, cz: 0 });
      }
      siteCodes.forEach((code, i) => {
        const s = siteInfo.get(code); const ringR = siteCodes.length === 1 ? 0 : (maxPlanetR + 7) + i * (maxPlanetR * 1.55 + 6);
        const ang = siteCodes.length === 1 ? 0 : -Math.PI / 2 + i * (Math.PI * 2 / siteCodes.length);
        s.ringR = ringR; s.cx = Math.cos(ang) * ringR; s.cz = Math.sin(ang) * ringR;
      });
      const pos = new Map();
      racks.forEach(d => { const s = siteInfo.get(d.site), b = s.b; pos.set(d.id, new THREE.Vector3(s.cx + ((d.col || 1) - b.minCol) - (b.cols - 1) / 2, 0.55, s.cz + ((d.row || 1) - b.minRow) - (b.rows - 1) / 2)); });
      const spineList = [];
      for (const sp of spines) {
        const pr = racks.filter(d => d.site === sp.site && d.pod === sp.pod); let v;
        if (pr.length) { v = pr.reduce((a, d) => a.add(pos.get(d.id)), new THREE.Vector3()); v.multiplyScalar(1 / pr.length); }
        else { const s = siteInfo.get(sp.site); v = new THREE.Vector3(s ? s.cx : 0, 0, s ? s.cz : 0); }
        v.y = 3.4; v.x += ((sp.plane || 1) - 1.5) * 0.45; v.z += ((sp.plane || 1) - 1.5) * 0.3; pos.set(sp.id, v); spineList.push(sp);
      }
      // ---- three setup ----
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); canvasWrap.appendChild(renderer.domElement);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x03040a);
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1200);
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      scene.add(new THREE.AmbientLight(0x8899bb, 1.05));
      const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(30, 50, 20); scene.add(dl);
      const sunLight = new THREE.PointLight(0xffc37d, 2.2, 0, 0); sunLight.position.set(0, 4, 0); scene.add(sunLight);
      // nebula backdrop
      (function () { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const x = cv.getContext('2d'); x.fillStyle = '#03040a'; x.fillRect(0, 0, 512, 256);
        [['rgba(88,60,180,0.20)', 130, 80, 190], ['rgba(30,90,180,0.18)', 360, 130, 210], ['rgba(20,160,170,0.13)', 250, 190, 170], ['rgba(150,60,160,0.10)', 450, 50, 140]].forEach(g => { const gr = x.createRadialGradient(g[1], g[2], 0, g[1], g[2], g[3]); gr.addColorStop(0, g[0]); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 512, 256); });
        const tx = new THREE.CanvasTexture(cv); const m = new THREE.Mesh(new THREE.SphereGeometry(520, 24, 16), new THREE.MeshBasicMaterial({ map: tx, side: THREE.BackSide, depthWrite: false })); scene.add(m); })();
      // starfield
      let stars = null;
      (function () { const N = 3200, arr = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const r = 340 + Math.random() * 140, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); arr[i * 3] = r * Math.sin(ph) * Math.cos(th); arr[i * 3 + 1] = r * Math.cos(ph) * 0.6; arr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe8ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.9 })); scene.add(stars); })();
      function glowTexture() { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,210,140,0.55)'); g.addColorStop(1, 'rgba(255,170,60,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv); }
      // sun
      const sun = new THREE.Mesh(new THREE.SphereGeometry(2.1, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffaa33, emissiveIntensity: 2.2, roughness: 0.4 }));
      sun.position.set(0, 1.2, 0); scene.add(sun);
      const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc37d, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sunGlow.scale.set(13, 13, 1); sunGlow.position.copy(sun.position); scene.add(sunGlow);
      function makeLabel(text, scale, color) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const ctx = cv.getContext('2d'); ctx.font = 'bold 30px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = color || '#cfe4ff'; ctx.fillText(text, 128, 42); const tx = new THREE.CanvasTexture(cv); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false })); sp.scale.set(6 * (scale || 1), 1.5 * (scale || 1), 1); return sp; }
      const sunLabel = makeLabel(model.name || 'network core', 0.85, '#ffd9a0'); sunLabel.position.set(0, 5.4, 0); scene.add(sunLabel);
      // orbit rings + backbone beams + planets
      const ringMats = [];
      function circlePts(cx, cz, r, y) { const pts = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); } return pts; }
      const bbrBySite = new Map(); model.devices.filter(d => d.tier === 'backbone_router').forEach(d => { if (!bbrBySite.has(d.site)) bbrBySite.set(d.site, []); bbrBySite.get(d.site).push(d.id); });
      const siteBackboneBroken = new Map();
      for (const code of siteCodes) { const ids = new Set(bbrBySite.get(code) || []); siteBackboneBroken.set(code, (model.links || []).some(l => (ids.has(l.a) || ids.has(l.b)) && l.up < l.count)); }
      var deckTex;
      (function () { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d'); x.fillStyle = '#0a1428'; x.fillRect(0, 0, 256, 256); x.strokeStyle = 'rgba(94,231,255,0.10)'; x.lineWidth = 1; for (let i = 0; i <= 256; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); } x.strokeStyle = 'rgba(94,231,255,0.06)'; for (let i = 0; i < 256; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 128, 256); x.stroke(); } deckTex = new THREE.CanvasTexture(cv); })();
      for (const s of siteInfo.values()) {
        if (s.ringR > 0) { const g = new THREE.BufferGeometry().setFromPoints(circlePts(0, 0, s.ringR, 0)); const m = new THREE.LineBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.28 }); ringMats.push(m); scene.add(new THREE.Line(g, m)); }
        const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(s.cx, 0.4, s.cz)]);
        const beam = new THREE.Line(beamGeo, new THREE.LineDashedMaterial({ color: siteBackboneBroken.get(s.code) ? 0xff4d6d : 0x5ee7ff, transparent: true, opacity: siteBackboneBroken.get(s.code) ? 0.95 : 0.35, dashSize: 1.2, gapSize: 0.8 })); beam.computeLineDistances(); scene.add(beam);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(s.R, 48), new THREE.MeshStandardMaterial({ color: 0x0d1830, roughness: 0.9, metalness: 0.2, map: deckTex })); disc.rotation.x = -Math.PI / 2; disc.position.set(s.cx, 0, s.cz); scene.add(disc);
        const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(s.cx, s.cz, s.R, 0.04)), new THREE.LineBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.85 })); scene.add(edge);
        const deck = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.dep), new THREE.MeshStandardMaterial({ color: 0x101c36, roughness: 1, transparent: true, opacity: 0.9 })); deck.rotation.x = -Math.PI / 2; deck.position.set(s.cx, 0.02, s.cz); scene.add(deck);
        const lab = makeLabel(kit.siteName(s.code) + ' (' + s.code + ')', 1.25, '#5ee7ff'); lab.position.set(s.cx, 6.2, s.cz - s.dep / 2 - 1); scene.add(lab);
        // empty slots (dotted cyan)
        const occ = new Set(racks.filter(d => d.site === s.code).map(d => (d.row || 1) + ',' + (d.col || 1))), b = s.b, pts = [];
        for (let r = b.minRow; r <= b.maxRow; r++) for (let c = b.minCol; c <= b.maxCol; c++) if (!occ.has(r + ',' + c)) { const x = s.cx + (c - b.minCol) - (b.cols - 1) / 2, z = s.cz + (r - b.minRow) - (b.rows - 1) / 2, h = 0.36; [[-h, -h, h, -h], [h, -h, h, h], [h, h, -h, h], [-h, h, -h, -h]].forEach(q => pts.push(x + q[0], 0.06, z + q[1], x + q[2], 0.06, z + q[3])); }
        if (pts.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const seg = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.55, dashSize: 0.1, gapSize: 0.07 })); seg.computeLineDistances(); scene.add(seg); }
        // row numbers along left edge
        for (let r = b.minRow; r <= b.maxRow; r++) { const rl = makeLabel('R' + r, 0.28, '#8fd8f2'); rl.position.set(s.cx - (b.cols - 1) / 2 - 1.1, 0.5, s.cz + (r - b.minRow) - (b.rows - 1) / 2); scene.add(rl); }
        // pod labels
        for (const p of [...new Set(racks.filter(d => d.site === s.code).map(d => d.pod))].sort((a, b2) => a - b2)) { const pr = racks.filter(d => d.site === s.code && d.pod === p); if (!pr.length) continue; const c2 = pr.reduce((a, d) => a.add(pos.get(d.id)), new THREE.Vector3()).multiplyScalar(1 / pr.length); const lab2 = makeLabel('pod ' + p, 0.5, '#bfe9ff'); lab2.position.set(c2.x, 4.5, c2.z); scene.add(lab2); }
      }

      // racks / spines / drained rings
      const rackMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.78, 1.1, 0.78), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.35 }), racks.length);
      rackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const dummy = new THREE.Object3D(); const idByInstance = [];
      racks.forEach((d, i) => { const v = pos.get(d.id); dummy.position.copy(v); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); rackMesh.setMatrixAt(i, dummy.matrix); idByInstance.push(d.id); });
      scene.add(rackMesh);
      const drainedRacks = racks.filter(d => d.drained);
      let drainMesh = null;
      if (drainedRacks.length) { drainMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.34, 0.05, 8, 20), new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.9 }), drainedRacks.length); drainedRacks.forEach((d, i) => { const v = pos.get(d.id); dummy.position.set(v.x, v.y + 0.68, v.z); dummy.rotation.set(Math.PI / 2, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); drainMesh.setMatrixAt(i, dummy.matrix); }); dummy.rotation.set(0, 0, 0); scene.add(drainMesh); }
      const spineMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.3, emissive: 0x1a4a66 }), spineList.length || 1);
      const spineIds = []; spineList.forEach((sp, i) => { dummy.position.copy(pos.get(sp.id)); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); spineMesh.setMatrixAt(i, dummy.matrix); spineIds.push(sp.id); }); scene.add(spineMesh);
      function lineGroup(pairs, color, opacity) { const pts = []; pairs.forEach(pr => pts.push(pr[0].x, pr[0].y, pr[0].z, pr[1].x, pr[1].y, pr[1].z)); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); scene.add(m); return m; }
      const healthyPairs = [], partPairs = [], fullPairs = [], brokenCyl = [];
      racks.forEach(d => { const a = pos.get(d.id); for (const l of rackInfo.get(d.id) ? kit.uplinks(d.id) : []) { const other = l.a === d.id ? l.b : l.a; const b = pos.get(other); if (!b) continue; if (l.up === l.count) healthyPairs.push([a, b]); else if (l.up === 0) { fullPairs.push([a, b]); brokenCyl.push([a, b, 0xff4d6d]); } else { partPairs.push([a, b]); brokenCyl.push([a, b, 0xffb347]); } } });
      const healthyLines = lineGroup(healthyPairs, 0x3d5a78, 0.10);
      const partLines = lineGroup(partPairs, 0xffb347, 0.95);
      const fullLines = lineGroup(fullPairs, 0xff4d6d, 1);
      let cylMesh = null;
      if (brokenCyl.length) { cylMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92 }), brokenCyl.length); const upv = new THREE.Vector3(0, 1, 0); brokenCyl.forEach((pr, i) => { const dir = new THREE.Vector3().subVectors(pr[1], pr[0]); const len = dir.length(); dummy.position.copy(pr[0]).addScaledVector(dir, 0.5); dummy.quaternion.setFromUnitVectors(upv, dir.clone().normalize()); dummy.scale.set(1, len, 1); dummy.updateMatrix(); cylMesh.setMatrixAt(i, dummy.matrix); cylMesh.setColorAt(i, new THREE.Color(pr[2])); }); dummy.quaternion.identity(); dummy.scale.set(1, 1, 1); scene.add(cylMesh); }
      const selBox = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.5, 1.05), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.95 })); selBox.visible = false; scene.add(selBox);
      // ---- state / coloring / camera ----
      let onlyBroken = false, highlight = null, selectedId = null, activeSite = null;
      const fly = { active: false, t: 0, dur: 0.9, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
      function highlightTest(d) { if (!highlight) return true; if (highlight.type === 'pod') return d.site === highlight.site && d.pod === highlight.pod; if (highlight.type === 'row') return d.site === highlight.site && (d.row || 1) === highlight.row; if (highlight.type === 'site') return d.site === highlight.site; return true; }
      function applyColors() {
        racks.forEach((d, i) => { const inf = rackInfo.get(d.id); let col;
          if (d.drained) col = new THREE.Color(0xb48cff); else if (inf.full > 0) col = new THREE.Color(0xff4d6d); else if (inf.part > 0) col = new THREE.Color(0xffb347); else col = new THREE.Color(0x2b3644);
          const dimmed = (onlyBroken && inf.broken === 0 && !d.drained) || !highlightTest(d) || (activeSite && d.site !== activeSite);
          if (dimmed) col.multiplyScalar(0.16); if (d.id === selectedId) col = new THREE.Color(0xffffff); rackMesh.setColorAt(i, col);
          const v = pos.get(d.id); dummy.position.copy(v); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, inf.full > 0 && !dimmed ? 1.3 : 1, 1); dummy.updateMatrix(); rackMesh.setMatrixAt(i, dummy.matrix); });
        if (rackMesh.instanceColor) rackMesh.instanceColor.needsUpdate = true; rackMesh.instanceMatrix.needsUpdate = true; healthyLines.visible = !onlyBroken;
      }
      function sysBounds() { let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const s of siteInfo.values()) { minX = Math.min(minX, s.cx - s.R); maxX = Math.max(maxX, s.cx + s.R); minZ = Math.min(minZ, s.cz - s.R); maxZ = Math.max(maxZ, s.cz + s.R); } if (!siteInfo.size) { minX = -10; maxX = 10; minZ = -10; maxZ = 10; } return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, span: Math.max(maxX - minX, maxZ - minZ, 10) }; }
      function flyTo(center, span) { const dist = Math.max(span * 0.98, 16); const tp = new THREE.Vector3(center.x + dist * 0.5, dist * 0.78, center.z + dist * 0.72); if (reduced) { camera.position.copy(tp); controls.target.set(center.x, 0, center.z); controls.update(); return; } fly.fromP.copy(camera.position); fly.fromT.copy(controls.target); fly.toP.copy(tp); fly.toT.set(center.x, 0, center.z); fly.t = 0; fly.active = true; }
      function fitAll() { const b = sysBounds(); flyTo(new THREE.Vector3(b.cx, 0, b.cz), b.span); }
      function focusSite(code) { if (!code) { fitAll(); return; } const s = siteInfo.get(code); if (s) flyTo(new THREE.Vector3(s.cx, 0, s.cz), Math.max(s.w, s.dep, s.R) * 1.35); }
      function focusRacks(list, fallbackSite) { if (!list || !list.length) { if (fallbackSite) focusSite(fallbackSite); return; } let x = 0, z = 0, mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9; list.forEach(d => { const v = pos.get(d.id); x += v.x; z += v.z; mnx = Math.min(mnx, v.x); mxx = Math.max(mxx, v.x); mnz = Math.min(mnz, v.z); mxz = Math.max(mxz, v.z); }); flyTo(new THREE.Vector3(x / list.length, 0, z / list.length), Math.max(mxx - mnx, mxz - mnz, 6) * 1.5 + 4); }
      function focusDevice(id) { const v = pos.get(id); if (v) { selBox.position.copy(v); selBox.visible = true; camera.position.set(v.x + 6, 7, v.z + 8); controls.target.copy(v); controls.update(); fly.active = false; return; } const d = byId.get(id); if (d && siteInfo.get(d.site)) focusSite(d.site); }
      // ---- side panel ----
      side.innerHTML = '';
      const btnWrap = document.createElement('div'); btnWrap.className = P + 'btns';
      const toggleLabel = document.createElement('label'); toggleLabel.className = P + 'toggle'; toggleLabel.innerHTML = '<input type="checkbox"> Show only broken';
      const filterRow = document.createElement('div'); filterRow.className = P + 'filterrow';
      const filterInput = document.createElement('input'); filterInput.className = P + 'filter'; filterInput.type = 'text'; filterInput.placeholder = 'Filter rows… e.g. dc2 or pod 3'; filterInput.setAttribute('aria-label', 'Filter table rows');
      const countEl = document.createElement('span'); countEl.className = P + 'count';
      filterRow.append(filterInput, countEl);
      const tabBar = document.createElement('div'); tabBar.className = P + 'tabs';
      const scroll = document.createElement('div'); scroll.className = P + 'scroll';
      side.append(btnWrap, toggleLabel, filterRow, tabBar, scroll);
      filterInput.addEventListener('input', () => renderTables());
      toggleLabel.querySelector('input').addEventListener('change', e => { onlyBroken = e.target.checked; applyColors(); renderTables(); });
      function renderSiteBtns() { btnWrap.innerHTML = ''; const mk = (label, code) => { const b = document.createElement('button'); b.className = P + 'btn' + (activeSite === code ? ' on' : ''); b.textContent = label; b.style.cursor = 'pointer'; b.onclick = () => { activeSite = code; renderSiteBtns(); applyColors(); focusSite(code); }; btnWrap.appendChild(b); }; mk('All sites', null); siteCodes.forEach(c => mk(kit.siteName(c), c)); }
      renderSiteBtns();
      let activeTab = 'pods';
      const sorts = { pods: { k: 'site', dir: 1, def: true }, rows: { k: 'site', dir: 1, def: true }, sites: { k: 'site', dir: 1, def: true }, racks: { k: 'site', dir: 1, def: true } };
      const COLS = {
        pods: [{ k: 'site', label: 'Site', title: 'Site' }, { k: 'pod', label: 'Pod', title: 'Pod' }, { k: 'racks', label: 'Rks', title: 'Racks' }, { k: 'racksBroken', label: 'RkBrk', title: 'Racks with broken uplink' }, { k: 'racksFull', label: 'RkFull', title: 'Racks with fully broken uplink' }, { k: 'racksPart', label: 'RkPart', title: 'Racks with partly broken uplink' }, { k: 'brokenUplinks', label: 'BrkLk', title: 'Broken uplinks (links)' }, { k: 'drained', label: 'Drn', title: 'Drained racks' }, { k: 'empty', label: 'Empty', title: 'Empty slots in pod' }],
        rows: [{ k: 'site', label: 'Site', title: 'Site' }, { k: 'row', label: 'Row', title: 'Row' }, { k: 'pods', label: 'Pods', title: 'Pod(s) in row' }, { k: 'racks', label: 'Rks', title: 'Racks' }, { k: 'racksBroken', label: 'RkBrk', title: 'Racks with broken uplink' }, { k: 'brokenUplinks', label: 'BrkLk', title: 'Broken uplinks' }, { k: 'drained', label: 'Drn', title: 'Drained racks' }, { k: 'empty', label: 'Empty', title: 'Empty slots' }],
        sites: [{ k: 'site', label: 'Site', title: 'Site' }, { k: 'racks', label: 'Rks', title: 'Racks' }, { k: 'pods', label: 'Pods', title: 'Pods' }, { k: 'rows', label: 'Rows', title: 'Rows' }, { k: 'cols', label: 'Cols', title: 'Columns' }, { k: 'racksBroken', label: 'RkBrk', title: 'Racks with broken uplink' }, { k: 'brokenUplinks', label: 'BrkLk', title: 'Broken uplinks' }, { k: 'racksPart', label: 'Part', title: 'Racks with partly broken uplink' }, { k: 'racksFull', label: 'Full', title: 'Racks with fully broken uplink' }, { k: 'drained', label: 'Drn', title: 'Drained racks' }, { k: 'empty', label: 'Empty', title: 'Empty slots' }],
        racks: [{ k: 'id', label: 'Rack', title: 'Rack id' }, { k: 'site', label: 'Site', title: 'Site' }, { k: 'pod', label: 'Pod', title: 'Pod' }, { k: 'row', label: 'Row', title: 'Row' }, { k: 'col', label: 'Col', title: 'Column' }, { k: 'uplinks', label: 'Up', title: 'Uplinks' }, { k: 'broken', label: 'Brk', title: 'Broken uplinks' }, { k: 'part', label: 'Part', title: 'Partly broken uplinks' }, { k: 'full', label: 'Full', title: 'Fully broken uplinks' }, { k: 'drained', label: 'Drn', title: 'Drained' }]
      };
      function tabRows(tab) { let rows = tab === 'pods' ? AGG.pods : tab === 'rows' ? AGG.rows : tab === 'sites' ? AGG.sites : AGG.rackRows; if (activeSite && tab !== 'sites') rows = rows.filter(r => r.site === activeSite); if (activeSite && tab === 'sites') rows = rows.filter(r => r.site === activeSite); if (onlyBroken) rows = tab === 'racks' ? rows.filter(r => r.broken > 0) : rows.filter(r => (r.racksBroken || 0) > 0); const q = filterInput.value.trim().toLowerCase(); if (q) rows = rows.filter(r => COLS[tab].map(c => String(r[c.k])).join(' ').toLowerCase().includes(q) || ('pod ' + (r.pod != null ? r.pod : (r.pods || ''))).includes(q)); return rows; }
      function sortRows(rows, tab) { const s = sorts[tab]; const out = [...rows]; if (s.def) out.sort((a, b) => String(a.site || '').localeCompare(String(b.site || '')) || ((a.pod || 0) - (b.pod || 0)) || ((a.row || 0) - (b.row || 0)) || ((a.col || 0) - (b.col || 0)) || String(a.id || '').localeCompare(String(b.id || ''))); else out.sort((a, b) => { const x = a[s.k], y = b[s.k]; const cmp = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return cmp * s.dir || String(a.site || a.id || '').localeCompare(String(b.site || b.id || '')); }); return out; }
      function onHeader(tab, k) { const s = sorts[tab]; if (!s.def && s.k === k) { s.dir = -s.dir; } else { const rows = tabRows(tab); const sample = rows.length ? rows[0][k] : null; s.k = k; s.def = false; s.dir = (typeof sample === 'number') ? -1 : 1; } renderTables(); }
      function buildTable(tab, rows) { const cols = COLS[tab], s = sorts[tab]; const t = document.createElement('table'); t.className = P + 'table'; const thead = document.createElement('thead'); const hr = document.createElement('tr');
        cols.forEach(c => { const th = document.createElement('th'); th.title = c.title || c.label; th.tabIndex = 0; if (!s.def && s.k === c.k) th.className = 'sorted'; th.textContent = c.label + ((!s.def && s.k === c.k) ? (s.dir < 0 ? ' ▼' : ' ▲') : ''); th.onclick = () => onHeader(tab, c.k); th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeader(tab, c.k); } }; hr.appendChild(th); }); thead.appendChild(hr); t.appendChild(thead);
        const tb = document.createElement('tbody'); rows.forEach(r => { const tr = document.createElement('tr'); if ((tab === 'pods' && highlight && highlight.type === 'pod' && highlight.site === r.site && highlight.pod === r.pod) || (tab === 'rows' && highlight && highlight.type === 'row' && highlight.site === r.site && highlight.row === r.row) || (tab === 'racks' && r.id === selectedId)) tr.className = 'sel'; cols.forEach(c => { const td = document.createElement('td'); td.textContent = r[c.k]; td.title = c.title || ''; tr.appendChild(td); }); tr.onclick = () => onRow(tab, r); tb.appendChild(tr); }); t.appendChild(tb); return t; }
      function onRow(tab, r) {
        if (tab === 'racks') { kit.select(r.id); return; }
        if (tab === 'sites') { highlight = (highlight && highlight.type === 'site' && highlight.site === r.site) ? null : { type: 'site', site: r.site }; applyColors(); renderTables(); if (highlight) focusSite(r.site); else fitAll(); return; }
        if (tab === 'pods') { const same = highlight && highlight.type === 'pod' && highlight.site === r.site && highlight.pod === r.pod; highlight = same ? null : { type: 'pod', site: r.site, pod: r.pod }; applyColors(); renderTables(); if (highlight) focusRacks(racks.filter(d => d.site === r.site && d.pod === r.pod), r.site); else fitAll(); return; }
        if (tab === 'rows') { const same = highlight && highlight.type === 'row' && highlight.site === r.site && highlight.row === r.row; highlight = same ? null : { type: 'row', site: r.site, row: r.row }; applyColors(); renderTables(); if (highlight) focusRacks(racks.filter(d => d.site === r.site && (d.row || 1) === r.row), r.site); else fitAll(); }
      }
      function renderTabs() { tabBar.innerHTML = ''; [['pods', 'Pods'], ['rows', 'Rows'], ['sites', 'Sites'], ['racks', 'Racks']].forEach(([k, label]) => { const b = document.createElement('button'); b.className = P + 'tab' + (activeTab === k ? ' on' : ''); b.textContent = label; b.style.cursor = 'pointer'; b.onclick = () => { activeTab = k; renderTables(); }; tabBar.appendChild(b); }); }
      function renderTables() { renderTabs(); scroll.innerHTML = ''; const rows = sortRows(tabRows(activeTab), activeTab); countEl.textContent = rows.length + ' rows shown'; const h = document.createElement('h3'); h.textContent = activeTab === 'racks' ? 'Per rack · click row to select' : 'Click header to sort · click row to highlight in 3D'; scroll.append(h, buildTable(activeTab, rows)); }
      renderTables();
      // ---- interaction ----
      const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
      function pick(e) { const rect = renderer.domElement.getBoundingClientRect(); mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; ray.setFromCamera(mouse, camera); let hit = ray.intersectObject(rackMesh); if (hit.length) return idByInstance[hit[0].instanceId]; hit = ray.intersectObject(spineMesh); if (hit.length) return spineIds[hit[0].instanceId]; return null; }
      function onMove(e) { const id = pick(e); if (!id) { tip.style.display = 'none'; renderer.domElement.style.cursor = ''; return; } const d = byId.get(id); if (!d) return; const inf = d.tier === 'top_of_rack' ? rackInfo.get(id) : rackStats(kit.uplinks(id)); const u = kit.uplinks(id); tip.innerHTML = '<b>' + id + '</b><br>' + d.tier + ' · ' + kit.siteName(d.site) + (d.pod != null ? ' · pod ' + d.pod : '') + (d.row != null ? ' · row ' + d.row + ' col ' + d.col : '') + '<br>uplinks: ' + u.length + ' · broken: ' + inf.broken + ' (partly ' + inf.part + ', fully ' + inf.full + ')<br>links up: ' + inf.up + '/' + inf.tot + (d.drained ? '<br><span style="color:#b48cff">drained</span>' : ''); const rect = root.getBoundingClientRect(); tip.style.left = (e.clientX - rect.left + 14) + 'px'; tip.style.top = (e.clientY - rect.top + 10) + 'px'; tip.style.display = 'block'; renderer.domElement.style.cursor = 'pointer'; }
      function onClick(e) { const id = pick(e); if (id) kit.select(id); }
      renderer.domElement.addEventListener('pointermove', onMove); renderer.domElement.addEventListener('click', onClick);
      kit.onSelect(id => { selectedId = id; if (id) focusDevice(id); else selBox.visible = false; applyColors(); renderTables(); });
      function resize() { const w = el.clientWidth || root.clientWidth || 800, h = el.clientHeight || root.clientHeight || 600; renderer.setSize(w, h); const pw = w > 900 ? 560 : 0; camera.aspect = (w + pw) / h; camera.setViewOffset(w + pw, h, pw, 0, w, h); camera.updateProjectionMatrix(); }
      const onWin = () => resize(); window.addEventListener('resize', onWin); resize();
      // initial camera instant (all planets visible)
      (function () { const b = sysBounds(); const dist = Math.max(b.span * 0.98, 16); camera.position.set(b.cx + dist * 0.5, dist * 0.78, b.cz + dist * 0.72); controls.target.set(b.cx, 0, b.cz); controls.update(); })();
      applyColors(); if (kit.selected) { selectedId = kit.selected; focusDevice(kit.selected); applyColors(); }
      let raf = 0; const clock = new THREE.Clock();
      function animate() { raf = requestAnimationFrame(animate); const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
        if (fly.active) { fly.t += dt / fly.dur; const k = fly.t >= 1 ? 1 : (1 - Math.pow(1 - fly.t, 3)); camera.position.lerpVectors(fly.fromP, fly.toP, k); controls.target.lerpVectors(fly.fromT, fly.toT, k); if (fly.t >= 1) fly.active = false; }
        if (!reduced) { if (stars) stars.rotation.y += dt * 0.004; const p = 0.72 + 0.28 * Math.sin(t * 2.2); sunGlow.scale.set(12 + 2.2 * p, 12 + 2.2 * p, 1); fullLines.material.opacity = 0.65 + 0.35 * Math.sin(t * 4); if (cylMesh) cylMesh.material.opacity = 0.75 + 0.25 * Math.sin(t * 4); ringMats.forEach((m, i) => { m.opacity = 0.22 + 0.1 * Math.sin(t * 1.3 + i); }); selBox.material.opacity = 0.6 + 0.4 * Math.sin(t * 3); }
        controls.update(); renderer.render(scene, camera); }
      animate();
      cleanup = function () { cancelAnimationFrame(raf); window.removeEventListener('resize', onWin); renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('click', onClick); controls.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); };
      cleanup.__resize = resize;
    }
  };
});
