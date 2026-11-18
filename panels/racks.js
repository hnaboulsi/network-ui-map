kit.page('racks', function () {
  let cleanup = null;
  function disposePrev() { if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; } }
  return {
    resize() { if (cleanup && cleanup.__resize) cleanup.__resize(); },
    mount(el, model, kit) {
      disposePrev();
      el.innerHTML = '';
      const P = 'pg-racks-';
      const style = document.createElement('style');
      style.textContent = `
.pg-racks-root{position:absolute;inset:0;background:#0b0f17;color:#dbe7f3;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}
.pg-racks-canvas{position:absolute;inset:0}.pg-racks-canvas canvas{display:block}
.pg-racks-legend{position:absolute;left:10px;bottom:10px;background:rgba(10,15,26,.88);border:1px solid #26344d;border-radius:10px;padding:9px 11px;font-size:11px;line-height:1.55;z-index:5;backdrop-filter:blur(6px);max-width:230px}
.pg-racks-legend b{font-size:12px}.pg-racks-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.pg-racks-side{position:absolute;top:10px;right:10px;bottom:10px;width:440px;max-width:calc(100% - 20px);background:rgba(10,15,26,.92);border:1px solid #26344d;border-radius:12px;z-index:6;display:flex;flex-direction:column;overflow:hidden;backdrop-filter:blur(8px)}
.pg-racks-side h3{margin:10px 10px 4px;font-size:12px;color:#9fb6d8;letter-spacing:.04em;text-transform:uppercase}
.pg-racks-scroll{overflow-y:auto;overflow-x:hidden;flex:1;padding:0 6px 10px}
.pg-racks-btns{display:flex;flex-wrap:wrap;gap:5px;padding:10px 10px 2px}
.pg-racks-btn{background:#162238;color:#cfe0f5;border:1px solid #2c4066;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer}
.pg-racks-btn.on{background:#2563eb;border-color:#60a5fa;color:#fff}
.pg-racks-toggle{display:flex;gap:7px;align-items:center;font-size:12px;padding:8px 10px;cursor:pointer}
.pg-racks-table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap;table-layout:auto}
.pg-racks-table th{position:sticky;top:0;background:#131e33;color:#a9c2e2;cursor:pointer;text-align:left;padding:3px 4px;border-bottom:1px solid #2a3a58;user-select:none;text-decoration:underline;text-underline-offset:2px;text-decoration-color:#3b587f}
.pg-racks-table th:hover{background:#1d2f4d;color:#e6f0ff;text-decoration-color:#7dd3fc}
.pg-racks-table td{padding:3px 4px;border-bottom:1px solid #1b2942;color:#d5e3f2}
.pg-racks-table tr{cursor:pointer}.pg-racks-table tbody tr:hover{background:#1b2c49}.pg-racks-table tr.sel{background:#23406e!important}
.pg-racks-tip{position:absolute;pointer-events:none;background:rgba(5,10,20,.95);border:1px solid #3b587f;border-radius:8px;padding:7px 9px;font-size:11px;z-index:9;display:none;max-width:260px;line-height:1.5}
.pg-racks-title{position:absolute;left:10px;top:10px;z-index:5;background:rgba(10,15,26,.82);border:1px solid #26344d;border-radius:10px;padding:8px 11px;font-size:12px}
`;
      const root = document.createElement('div'); root.className = P + 'root';
      const canvasWrap = document.createElement('div'); canvasWrap.className = P + 'canvas';
      const title = document.createElement('div'); title.className = P + 'title'; title.innerHTML = '<b>Rack floors</b> &nbsp;<span style="color:#8aa0bd">racks by row/col · spines above pods · drag to orbit</span>';
      const legend = document.createElement('div'); legend.className = P + 'legend';
      const side = document.createElement('div'); side.className = P + 'side';
      const tip = document.createElement('div'); tip.className = P + 'tip';
      root.append(style, canvasWrap, title, legend, side, tip); el.appendChild(root);

      // ---- data (derived) ----
      const racks = model.devices.filter(d => d.tier === 'top_of_rack');
      const spines = model.devices.filter(d => d.tier === 'spine');
      const byId = new Map(model.devices.map(d => [d.id, d]));
      function brokenOf(id) { const u = kit.uplinks(id); let b = 0, part = 0, full = 0, up = 0, tot = 0; for (const l of u) { up += l.up; tot += l.count; if (l.up < l.count) b++; if (l.up === 0) full++; else if (l.up < l.count) part++; } return { uplinks: u, broken: b, part, full, up, tot }; }
      const rackInfo = new Map(); racks.forEach(d => rackInfo.set(d.id, brokenOf(d.id)));
      let totBroken = 0, totPart = 0, totFull = 0, totDrained = 0;
      racks.forEach(d => { const i = rackInfo.get(d.id); totBroken += i.broken; totPart += i.part; totFull += i.full; if (d.drained) totDrained++; });
      // legend totals (counts only)
      legend.innerHTML = '<b>Legend</b><br>' +
        '<span class="' + P + 'sw" style="background:#334155"></span>healthy rack (dark slate, faint pod tint)<br>' +
        '<span class="' + P + 'sw" style="background:#f59e0b"></span>partly broken uplink<br>' +
        '<span class="' + P + 'sw" style="background:#ef4444"></span>fully broken uplink<br>' +
        '<span class="' + P + 'sw" style="background:#a855f7"></span>drained rack<br>' +
        '<span class="' + P + 'sw" style="background:#334155;border:1px solid #64748b"></span>empty slot (no rack)<br>' +
        '<span class="' + P + 'sw" style="background:#7dd3fc"></span>spine<br>' +
        '<span style="color:#6b7f99">— healthy link (faint)</span> &nbsp;<span style="color:#f59e0b">— partly</span> &nbsp;<span style="color:#ef4444">— fully</span><br>' +
        '<b>Broken links: ' + totBroken + '</b> · Partly broken: ' + totPart + '<br>Fully broken: ' + totFull + ' · Drained: ' + totDrained;

      // pod palette
      const podNums = [...new Set(racks.map(d => d.pod))].sort((a, b) => a - b);
      const podColor = new Map(); podNums.forEach((p, i) => podColor.set(p, new THREE.Color().setHSL((i * 0.618) % 1, 0.32, 0.52)));

      // ---- layout per site ----
      const sites = model.sites.map(s => s.code);
      const siteInfo = new Map(); let cursorX = 0; const SITE_GAP = 7;
      for (const code of sites) {
        const sr = racks.filter(d => d.site === code);
        const maxRow = sr.length ? Math.max(...sr.map(d => d.row || 1)) : 1;
        const maxCol = sr.length ? Math.max(...sr.map(d => d.col || 1)) : 1;
        const w = maxCol, dep = maxRow;
        siteInfo.set(code, { code, maxRow, maxCol, w, dep, cx: cursorX + w / 2, x0: cursorX });
        cursorX += w + SITE_GAP;
      }
      const totalW = cursorX - SITE_GAP;
      for (const s of siteInfo.values()) s.cx -= totalW / 2;
      const pos = new Map(); // id -> Vector3
      function rackPos(d) { const s = siteInfo.get(d.site); return new THREE.Vector3(s.cx + ((d.col || 1) - (s.maxCol + 1) / 2), 0.55, ((d.row || 1) - (s.maxRow + 1) / 2)); }
      racks.forEach(d => pos.set(d.id, rackPos(d)));
      // spines above pod centroid
      const spineList = [];
      for (const sp of spines) {
        const pr = racks.filter(d => d.site === sp.site && d.pod === sp.pod);
        let v;
        if (pr.length) { v = pr.reduce((a, d) => a.add(pos.get(d.id)), new THREE.Vector3()); v.multiplyScalar(1 / pr.length); }
        else { const s = siteInfo.get(sp.site); v = new THREE.Vector3(s ? s.cx : 0, 0, 0); }
        v.y = 3.4; v.x += ((sp.plane || 1) - 1.5) * 0.45; v.z += ((sp.plane || 1) - 1.5) * 0.3;
        pos.set(sp.id, v); spineList.push(sp);
      }

      // ---- three setup ----
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      canvasWrap.appendChild(renderer.domElement);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0f17); scene.fog = new THREE.Fog(0x0b0f17, 90, 220);
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      scene.add(new THREE.AmbientLight(0x8899bb, 1.1));
      const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(20, 35, 15); scene.add(dl);
      const grid = new THREE.GridHelper(Math.max(totalW, 40), 40, 0x1e2d47, 0x141f33); grid.position.y = -0.02; scene.add(grid);

      // floors + empty slots
      const lineMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.38 });
      for (const s of siteInfo.values()) {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.dep), new THREE.MeshStandardMaterial({ color: 0x101a2c, roughness: 1 }));
        floor.rotation.x = -Math.PI / 2; floor.position.set(s.cx, 0, 0); scene.add(floor);
        const occupied = new Set(racks.filter(d => d.site === s.code).map(d => d.row + ',' + d.col));
        const pts = [];
        for (let r = 1; r <= s.maxRow; r++) for (let c = 1; c <= s.maxCol; c++) if (!occupied.has(r + ',' + c)) {
          const x = s.cx + (c - (s.maxCol + 1) / 2), z = r - (s.maxRow + 1) / 2, h = 0.36;
          [[-h,-h,h,-h],[h,-h,h,h],[h,h,-h,h],[-h,h,-h,-h]].forEach(q => { pts.push(x+q[0], 0.03, z+q[1], x+q[2], 0.03, z+q[3]); });
        }
        if (pts.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); scene.add(new THREE.LineSegments(g, lineMat)); }
      }
      function makeLabel(text, scale) {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const ctx = cv.getContext('2d');
        ctx.font = 'bold 34px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfe4ff'; ctx.fillText(text, 128, 42);
        const tx = new THREE.CanvasTexture(cv); const m = new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false });
        const sp = new THREE.Sprite(m); sp.scale.set(6 * (scale || 1), 1.5 * (scale || 1), 1); return sp;
      }
      for (const s of siteInfo.values()) { const lab = makeLabel(kit.siteName(s.code) + ' (' + s.code + ')', 1.3); lab.position.set(s.cx, 5.6, -(s.dep / 2 + 1.5)); scene.add(lab); }
      podNums.forEach(p => { /* pod labels at first site only to reduce clutter */ });
      // pod labels per site
      for (const s of siteInfo.values()) for (const p of podNums) {
        const pr = racks.filter(d => d.site === s.code && d.pod === p); if (!pr.length) continue;
        const c = pr.reduce((a, d) => a.add(pos.get(d.id)), new THREE.Vector3()).multiplyScalar(1 / pr.length);
        const lab = makeLabel('pod ' + p, 0.55); lab.position.set(c.x, 4.6, c.z); scene.add(lab);
      }

      // racks InstancedMesh
      const rackMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.78, 1.1, 0.78), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 }), racks.length);
      rackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const dummy = new THREE.Object3D(); const idByInstance = [];
      racks.forEach((d, i) => { const v = pos.get(d.id); dummy.position.copy(v); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); rackMesh.setMatrixAt(i, dummy.matrix); idByInstance.push(d.id); });
      scene.add(rackMesh);
      const spineMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.3, emissive: 0x123a52 }), spineList.length);
      const spineIds = [];
      spineList.forEach((sp, i) => { dummy.position.copy(pos.get(sp.id)); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); spineMesh.setMatrixAt(i, dummy.matrix); spineIds.push(sp.id); });
      scene.add(spineMesh);

      // links
      function lineGroup(pairs, color, opacity) {
        const pts = []; pairs.forEach(pr => { pts.push(pr[0].x, pr[0].y, pr[0].z, pr[1].x, pr[1].y, pr[1].z); });
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
        scene.add(m); return m;
      }
      const healthyPairs = [], partPairs = [], fullPairs = [], brokenCyl = [];
      racks.forEach(d => { const a = pos.get(d.id); for (const l of rackInfo.get(d.id).uplinks) { const other = l.a === d.id ? l.b : l.a; const b = pos.get(other); if (!b) continue; if (l.up === l.count) healthyPairs.push([a, b]); else if (l.up === 0) { fullPairs.push([a, b]); brokenCyl.push([a, b, 0xef4444]); } else { partPairs.push([a, b]); brokenCyl.push([a, b, 0xf59e0b]); } } });
      const healthyLines = lineGroup(healthyPairs, 0x3d5a78, 0.13);
      const partLines = lineGroup(partPairs, 0xf59e0b, 0.95);
      const fullLines = lineGroup(fullPairs, 0xef4444, 1);
      // thick broken links via instanced cylinders
      let cylMesh = null;
      if (brokenCyl.length) {
        cylMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92 }), brokenCyl.length);
        const up = new THREE.Vector3(0, 1, 0);
        brokenCyl.forEach((pr, i) => { const dir = new THREE.Vector3().subVectors(pr[1], pr[0]); const len = dir.length(); dummy.position.copy(pr[0]).addScaledVector(dir, 0.5); dummy.quaternion.setFromUnitVectors(up, dir.clone().normalize()); dummy.scale.set(1, len, 1); dummy.updateMatrix(); cylMesh.setMatrixAt(i, dummy.matrix); cylMesh.setColorAt(i, new THREE.Color(pr[2])); });
        dummy.quaternion.identity(); dummy.scale.set(1, 1, 1); scene.add(cylMesh);
      }
      // selection outline
      const selBox = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.45, 1.05), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.95 }));
      selBox.visible = false; scene.add(selBox);

      // ---- state / coloring ----
      let onlyBroken = false, highlightPod = null, selectedId = null, activeSite = null;
      function applyColors() {
        racks.forEach((d, i) => {
          const inf = rackInfo.get(d.id); let col;
          if (d.drained) col = new THREE.Color(0xa855f7);
          else if (inf.full > 0) col = new THREE.Color(0xef4444);
          else if (inf.part > 0) col = new THREE.Color(0xf59e0b);
          else { col = new THREE.Color(0x334155); const pc = podColor.get(d.pod); if (pc) col.lerp(pc, 0.12); }
          const dimmed = (onlyBroken && inf.broken === 0 && !d.drained) || (highlightPod && !(d.site === highlightPod.site && d.pod === highlightPod.pod)) || (activeSite && d.site !== activeSite);
          if (dimmed) col.multiplyScalar(0.18);
          if (d.id === selectedId) col = new THREE.Color(0xffffff);
          rackMesh.setColorAt(i, col);
        });
        if (rackMesh.instanceColor) rackMesh.instanceColor.needsUpdate = true;
        healthyLines.visible = !onlyBroken;
        spineList.forEach((sp, i) => { /* keep spines visible */ });
      }
      function fitCamera(center, span) {
        const dist = Math.max(span * 1.15, 18);
        camera.position.set(center.x + dist * 0.55, dist * 0.72, center.z + dist * 0.78);
        controls.target.copy(center); controls.update();
      }
      function fitAll() { const dep = Math.max(...[...siteInfo.values()].map(s => s.dep), 10); fitCamera(new THREE.Vector3(0, 0, 0), Math.max(totalW, dep)); }
      function focusSite(code) { if (!code) { fitAll(); return; } const s = siteInfo.get(code); if (s) fitCamera(new THREE.Vector3(s.cx, 0, 0), Math.max(s.w, s.dep) * 1.25); }
      function focusDevice(id) {
        const v = pos.get(id); if (v) { selBox.position.copy(v); selBox.visible = true; camera.position.set(v.x + 6, 7, v.z + 8); controls.target.copy(v); controls.update(); return; }
        const d = byId.get(id); if (d && siteInfo.get(d.site)) focusSite(d.site);
      }

      // ---- side panel ----
      side.innerHTML = '';
      const btnWrap = document.createElement('div'); btnWrap.className = P + 'btns';
      const scroll = document.createElement('div'); scroll.className = P + 'scroll';
      const toggleLabel = document.createElement('label'); toggleLabel.className = P + 'toggle';
      toggleLabel.innerHTML = '<input type="checkbox"> Show only broken';
      side.append(btnWrap, toggleLabel, scroll);
      toggleLabel.querySelector('input').addEventListener('change', e => { onlyBroken = e.target.checked; applyColors(); renderTables(); });
      function renderSiteBtns() {
        btnWrap.innerHTML = '';
        const mk = (label, code) => { const b = document.createElement('button'); b.className = P + 'btn' + (activeSite === code ? ' on' : ''); b.textContent = label; b.onclick = () => { activeSite = code; renderSiteBtns(); applyColors(); focusSite(code); }; btnWrap.appendChild(b); };
        mk('All sites', null); sites.forEach(c => mk(kit.siteName(c), c));
      }
      renderSiteBtns();

      // aggregated data
      const podRows = [];
      for (const code of sites) for (const p of podNums) {
        const pr = racks.filter(d => d.site === code && d.pod === p); if (!pr.length) continue;
        podRows.push({ site: code, pod: p, racks: pr.length, racksBroken: pr.filter(d => rackInfo.get(d.id).broken > 0).length, brokenUplinks: pr.reduce((n, d) => n + rackInfo.get(d.id).broken, 0), drained: pr.filter(d => d.drained).length });
      }
      const rackRows = racks.map(d => ({ id: d.id, site: d.site, pod: d.pod, row: d.row, col: d.col, broken: rackInfo.get(d.id).broken, drained: d.drained ? 'yes' : 'no', _d: d }));
      let podSort = { k: 'site', dir: 1 }, rackSort = { k: 'id', dir: 1 };
      function sortRows(rows, s) { return [...rows].sort((a, b) => { const x = a[s.k], y = b[s.k]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * s.dir || String(a.site || a.id).localeCompare(String(b.site || b.id)) || ((a.pod || 0) - (b.pod || 0)); }); }
      function buildTable(cols, rows, sortState, onSort, onClick, selTest) {
        const t = document.createElement('table'); t.className = P + 'table';
        const thead = document.createElement('thead'); const hr = document.createElement('tr');
        cols.forEach(c => { const th = document.createElement('th'); th.title = c.title || c.label; th.textContent = c.label + (sortState.k === c.k ? (sortState.dir > 0 ? ' ▲' : ' ▼') : ' ↕'); th.setAttribute('aria-sort', sortState.k === c.k ? (sortState.dir > 0 ? 'ascending' : 'descending') : 'none'); th.onclick = () => onSort(c.k); hr.appendChild(th); });
        thead.appendChild(hr); t.appendChild(thead);
        const tb = document.createElement('tbody');
        rows.forEach(r => { const tr = document.createElement('tr'); if (selTest && selTest(r)) tr.className = 'sel'; cols.forEach(c => { const td = document.createElement('td'); td.textContent = r[c.k]; tr.appendChild(td); }); tr.onclick = () => onClick(r); tb.appendChild(tr); });
        t.appendChild(tb); return t;
      }
      function renderTables() {
        scroll.innerHTML = '';
        const h1 = document.createElement('h3'); h1.textContent = 'Per pod (click header to sort · click row to highlight pod)'; scroll.appendChild(h1);
        scroll.appendChild(buildTable(
          [{ k: 'site', label: 'Site', title: 'Site' }, { k: 'pod', label: 'Pod', title: 'Pod' }, { k: 'racks', label: 'Rks', title: 'Racks' }, { k: 'racksBroken', label: 'BrkRk', title: 'Racks with broken uplink' }, { k: 'brokenUplinks', label: 'Brk', title: 'Broken uplinks' }, { k: 'drained', label: 'Drn', title: 'Drained racks' }],
          sortRows(podRows, podSort), podSort,
          k => { if (podSort.k === k) podSort.dir = -podSort.dir; else { podSort.k = k; podSort.dir = (podRows.length && typeof podRows[0][k] === 'number') ? -1 : 1; } renderTables(); },
          r => { highlightPod = (highlightPod && highlightPod.site === r.site && highlightPod.pod === r.pod) ? null : { site: r.site, pod: r.pod }; applyColors(); renderTables(); if (highlightPod) focusSite(r.site); },
          r => highlightPod && highlightPod.site === r.site && highlightPod.pod === r.pod));
        const h2 = document.createElement('h3'); h2.textContent = 'Per rack (click header to sort · click row to select)'; scroll.appendChild(h2);
        let rr = onlyBroken ? rackRows.filter(r => r.broken > 0) : rackRows;
        if (activeSite) rr = rr.filter(r => r.site === activeSite);
        scroll.appendChild(buildTable(
          [{ k: 'id', label: 'Rack', title: 'Rack' }, { k: 'site', label: 'Site', title: 'Site' }, { k: 'pod', label: 'Pod', title: 'Pod' }, { k: 'row', label: 'Row', title: 'Row' }, { k: 'col', label: 'Col', title: 'Col' }, { k: 'broken', label: 'Brk', title: 'Broken uplinks' }, { k: 'drained', label: 'Drn', title: 'Drained' }],
          sortRows(rr, rackSort), rackSort,
          k => { if (rackSort.k === k) rackSort.dir = -rackSort.dir; else { rackSort.k = k; const sample = (rr[0] || rackRows[0] || {})[k]; rackSort.dir = (typeof sample === 'number') ? -1 : 1; } renderTables(); },
          r => kit.select(r.id),
          r => r.id === selectedId));
      }
      renderTables();

      // ---- interaction ----
      const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(); let hoverId = null;
      function pick(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(mouse, camera);
        let hit = ray.intersectObject(rackMesh); if (hit.length) return idByInstance[hit[0].instanceId];
        hit = ray.intersectObject(spineMesh); if (hit.length) return spineIds[hit[0].instanceId];
        return null;
      }
      function onMove(e) {
        const id = pick(e); hoverId = id;
        if (!id) { tip.style.display = 'none'; renderer.domElement.style.cursor = ''; return; }
        const d = byId.get(id); const inf = d.tier === 'top_of_rack' ? rackInfo.get(id) : brokenOf(id);
        const u = kit.uplinks(id);
        tip.innerHTML = '<b>' + id + '</b><br>' + d.tier + ' · ' + kit.siteName(d.site) + (d.pod != null ? ' · pod ' + d.pod : '') + (d.row != null ? ' · row ' + d.row + ' col ' + d.col : '') +
          '<br>uplinks: ' + u.length + ' · broken uplinks: ' + inf.broken + ' (partly ' + inf.part + ', fully ' + inf.full + ')<br>links up: ' + inf.up + '/' + inf.tot + (d.drained ? '<br><span style="color:#c084fc">drained</span>' : '');
        const rect = root.getBoundingClientRect(); tip.style.left = (e.clientX - rect.left + 14) + 'px'; tip.style.top = (e.clientY - rect.top + 10) + 'px'; tip.style.display = 'block';
        renderer.domElement.style.cursor = 'pointer';
      }
      function onClick(e) { const id = pick(e); if (id) kit.select(id); }
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('click', onClick);
      kit.onSelect(id => { selectedId = id; if (id) { const d = byId.get(id); if (d && d.site && activeSite !== d.site && pos.has(id)) { /* keep site filter but focus */ } focusDevice(id); } else selBox.visible = false; applyColors(); renderTables(); });

      function resize() { const w = el.clientWidth || root.clientWidth || 800, h = el.clientHeight || root.clientHeight || 600; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      const onWin = () => resize(); window.addEventListener('resize', onWin);
      resize(); fitAll(); applyColors();
      if (kit.selected) { selectedId = kit.selected; focusDevice(kit.selected); applyColors(); }

      let raf = 0; const clock = new THREE.Clock();
      function animate() { raf = requestAnimationFrame(animate); const t = clock.getElapsedTime(); const pulse = 0.65 + 0.35 * Math.sin(t * 4); fullLines.material.opacity = pulse; if (cylMesh) cylMesh.material.opacity = 0.7 + 0.3 * pulse; selBox.material.opacity = 0.6 + 0.4 * Math.sin(t * 3); controls.update(); renderer.render(scene, camera); }
      animate();

      cleanup = function () { cancelAnimationFrame(raf); window.removeEventListener('resize', onWin); renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('click', onClick); controls.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); };
      cleanup.__resize = resize;
    }
  };
});
