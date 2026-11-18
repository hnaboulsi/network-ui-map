kit.page('backbone', function () {
  let renderer = null, raf = 0, onResize = null, sceneRef = null;
  function cleanup() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
    if (renderer) { try { renderer.dispose(); } catch (e) {} renderer = null; }
    sceneRef = null;
  }
  return {
    resize() { if (renderer && renderer.__pgResize) renderer.__pgResize(); },
    mount(el, model, kit) {
      cleanup();
      el.innerHTML = '';
      el.style.position = 'relative'; el.style.overflow = 'hidden'; el.style.background = '#0b0f17';

      // ---------- data (derived only) ----------
      const byId = new Map(model.devices.map(d => [d.id, d]));
      const bbrs = model.devices.filter(d => d.tier === 'backbone_router');
      const borders = model.devices.filter(d => d.tier === 'border');
      const isBB = id => byId.get(id) && byId.get(id).tier === 'backbone_router';
      const circuits = model.links.filter(l => isBB(l.a) && isBB(l.b) && byId.get(l.a).site !== byId.get(l.b).site)
        .map(l => ({ a: l.a, b: l.b, siteA: byId.get(l.a).site, siteB: byId.get(l.b).site, count: l.count, up: l.up, down: l.count - l.up, speed: l.speed_gbps, raw: l }));
      const intraBB = model.links.filter(l => isBB(l.a) && isBB(l.b) && byId.get(l.a).site === byId.get(l.b).site);
      const bbBorder = model.links.filter(l => {
        const ta = byId.get(l.a) && byId.get(l.a).tier, tb = byId.get(l.b) && byId.get(l.b).tier;
        return (ta === 'backbone_router' && tb === 'border') || (tb === 'backbone_router' && ta === 'border');
      });
      const brokenC = circuits.filter(l => l.up < l.count);
      const partlyC = circuits.filter(l => l.up > 0 && l.up < l.count);
      const fullyC = circuits.filter(l => l.up === 0);
      const drainedBB = bbrs.filter(d => d.drained);
      const statusOf = l => l.up === l.count ? 'healthy' : (l.up === 0 ? 'fully' : 'partly');
      const devStats = id => {
        const ls = kit.linksOf(id);
        return { total: ls.length, broken: ls.filter(l => l.up < l.count).length, upLinks: ls.reduce((s, l) => s + l.up, 0), countLinks: ls.reduce((s, l) => s + l.count, 0) };
      };
      // per-site stats
      const siteStats = model.sites.map(s => {
        const routers = bbrs.filter(d => d.site === s.code);
        const cs = circuits.filter(c => c.siteA === s.code || c.siteB === s.code);
        return { code: s.code, name: s.name, routers: routers.length, circuits: cs.length, broken: cs.filter(c => c.up < c.count).length, drained: routers.filter(d => d.drained).length };
      });

      // ---------- DOM ----------
      const style = document.createElement('style');
      style.textContent = `
.pg-bb-wrap{position:absolute;inset:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#e6edf3}
.pg-bb-canvas{position:absolute;inset:0}.pg-bb-canvas canvas{display:block}
.pg-bb-legend{position:absolute;left:12px;top:12px;background:rgba(13,20,36,.92);border:1px solid #26314d;border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.9;max-width:230px;backdrop-filter:blur(6px);z-index:5}
.pg-bb-legend b{font-size:13px}.pg-bb-sw{display:inline-block;width:22px;height:6px;border-radius:3px;vertical-align:middle;margin-right:7px}
.pg-bb-sw2{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:middle;margin-right:7px}
.pg-bb-panel{position:absolute;right:0;top:0;bottom:0;width:348px;background:rgba(10,15,26,.96);border-left:1px solid #26314d;overflow-y:auto;overflow-x:hidden;padding:12px;box-sizing:border-box;z-index:6;font-size:12px}
.pg-bb-panel h3{margin:10px 0 6px;font-size:12px;color:#9fb4d8;text-transform:uppercase;letter-spacing:.06em}
.pg-bb-panel table{width:100%;border-collapse:collapse;font-size:11px}
.pg-bb-panel th{cursor:pointer;text-align:left;padding:5px 4px;border-bottom:1px solid #2a3757;color:#a9c1e8;white-space:nowrap;user-select:none}
.pg-bb-panel th:hover{color:#fff}.pg-bb-panel td{padding:4px;border-bottom:1px solid #1a2338;white-space:nowrap;color:#dbe6f5}
.pg-bb-panel tr[data-id]{cursor:pointer}.pg-bb-panel tr[data-id]:hover td{background:#1b2947}
.pg-bb-panel tr.pg-bb-sel td{background:#263a66!important}
.pg-bb-badge{display:inline-block;padding:0 5px;border-radius:8px;font-size:10px;font-weight:700}
.pg-bb-tip{position:absolute;pointer-events:none;background:#0d1526;border:1px solid #3a4f7d;border-radius:8px;padding:7px 9px;font-size:12px;display:none;z-index:20;max-width:260px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.pg-bb-label{position:absolute;transform:translate(-50%,-100%);pointer-events:none;font-size:12px;font-weight:700;color:#eaf2ff;text-shadow:0 1px 6px #000;text-align:center;white-space:nowrap;z-index:4}
.pg-bb-label small{display:block;font-weight:400;font-size:10px;color:#9fb4d8}
.pg-bb-check{display:flex;gap:7px;align-items:center;background:#131e36;border:1px solid #2a3757;border-radius:8px;padding:7px 9px;cursor:pointer}
.pg-bb-counts{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:7px}
.pg-bb-counts div{background:#121c31;border-radius:7px;padding:5px 7px}.pg-bb-counts b{font-size:15px;display:block}
`;
      el.appendChild(style);
      const wrap = document.createElement('div'); wrap.className = 'pg-bb-wrap'; el.appendChild(wrap);
      const canvasHost = document.createElement('div'); canvasHost.className = 'pg-bb-canvas'; wrap.appendChild(canvasHost);
      const legend = document.createElement('div'); legend.className = 'pg-bb-legend';
      legend.innerHTML = `<b>Backbone circuits</b><br>
<span class="pg-bb-sw" style="background:#5b6b82"></span>Healthy link<br>
<span class="pg-bb-sw" style="background:#f5a623;height:8px"></span>Partly broken link<br>
<span class="pg-bb-sw" style="background:#ff3b30;height:10px"></span>Fully broken link<br>
<span class="pg-bb-sw2" style="background:#a855f7"></span>Drained device<br>
<span class="pg-bb-sw2" style="background:#38bdf8"></span>Backbone router (by tier)<br>
<span class="pg-bb-sw2" style="background:#64748b"></span>Border (faint context)<br>
<span class="pg-bb-sw2" style="border:1px dashed #5b6b82;background:transparent"></span>Empty slot
<div class="pg-bb-counts">
<div>Circuits<b>${circuits.length}</b></div><div>Broken circuits<b>${brokenC.length}</b></div>
<div>Partly broken<b>${partlyC.length}</b></div><div>Fully broken<b>${fullyC.length}</b></div>
<div>Drained routers<b>${drainedBB.length}</b></div><div>Routers<b>${bbrs.length}</b></div></div>`;
      wrap.appendChild(legend);
      const tip = document.createElement('div'); tip.className = 'pg-bb-tip'; wrap.appendChild(tip);
      const panel = document.createElement('div'); panel.className = 'pg-bb-panel'; wrap.appendChild(panel);
      const labelHost = document.createElement('div'); wrap.appendChild(labelHost);

      // ---------- state ----------
      let onlyBroken = false, selectedId = kit.selected || null, selectedCircuit = null;
      const tierColor = { backbone_router: 0x38bdf8, border: 0x64748b };

      // ---------- three ----------
      const W = () => Math.max(200, el.clientWidth - 348), H = () => Math.max(200, el.clientHeight);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0f17); scene.fog = new THREE.Fog(0x0b0f17, 220, 420); sceneRef = scene;
      const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 1000);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(W(), H()); canvasHost.appendChild(renderer.domElement);
      const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
      scene.add(new THREE.AmbientLight(0x8899bb, 1.1));
      const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(40, 80, 30); scene.add(dl);
      const grid = new THREE.GridHelper(260, 52, 0x24314f, 0x16203a); grid.position.y = -0.15; scene.add(grid);

      // layout
      const sites = model.sites;
      const maxRouters = Math.max(1, ...sites.map(s => bbrs.filter(d => d.site === s.code).length));
      const platformR = 9 + Math.max(0, maxRouters - 1) * 2.2;
      const R = Math.max(34, sites.length * platformR * 0.95);
      const sitePos = new Map();
      sites.forEach((s, i) => { const a = sites.length === 1 ? 0 : (i / sites.length) * Math.PI * 2 - Math.PI / 2; sitePos.set(s.code, new THREE.Vector3(Math.cos(a) * (sites.length === 1 ? 0 : R), 0, Math.sin(a) * (sites.length === 1 ? 0 : R))); });
      const devPos = new Map();
      const pickables = []; // {mesh, type:'device'|'circuit', id, circuit}
      // platforms + empty slots + labels
      const siteLabels = [];
      sites.forEach(s => {
        const c = sitePos.get(s.code);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(platformR, platformR + 0.6, 1.1, 48), new THREE.MeshStandardMaterial({ color: 0x14213d, emissive: 0x1d3a6b, emissiveIntensity: 0.55, roughness: 0.6 }));
        disc.position.copy(c); disc.position.y = -0.55; scene.add(disc);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(platformR, 0.14, 8, 64), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55 }));
        ring.rotation.x = Math.PI / 2; ring.position.copy(c); ring.position.y = 0.05; scene.add(ring);
        const routers = bbrs.filter(d => d.site === s.code);
        // slot positions on circle
        for (let i = 0; i < maxRouters; i++) {
          const a = maxRouters === 1 ? 0 : (i / maxRouters) * Math.PI * 2;
          const p = new THREE.Vector3(c.x + Math.cos(a) * platformR * 0.52, 0, c.z + Math.sin(a) * platformR * 0.52);
          if (i >= routers.length) {
            const slot = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 2.6), new THREE.MeshBasicMaterial({ color: 0x5b6b82, wireframe: true, transparent: true, opacity: 0.28 }));
            slot.position.set(p.x, 1.7, p.z); scene.add(slot);
          } else devPos.set(routers[i].id, p);
        }
        // borders along inner edge
        borders.filter(d => d.site === s.code).forEach((d, i, arr) => {
          const a = (i / Math.max(1, arr.length)) * Math.PI * 2 + 0.4;
          devPos.set(d.id, new THREE.Vector3(c.x + Math.cos(a) * platformR * 0.88, 0, c.z + Math.sin(a) * platformR * 0.88));
        });
        const lab = document.createElement('div'); lab.className = 'pg-bb-label'; lab.innerHTML = `${s.code}<small>${s.name} · ${routers.length} router${routers.length === 1 ? '' : 's'}</small>`;
        labelHost.appendChild(lab); siteLabels.push({ el: lab, pos: c.clone().setY(platformR * 0.55 + 4) });
      });
      // device towers
      const devMeshes = new Map();
      function addTower(d, h, r, color) {
        const p = devPos.get(d.id); if (!p) return;
        const mat = d.drained
          ? new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x7e22ce, emissiveIntensity: 0.7, transparent: true, opacity: 0.55, roughness: 0.4 })
          : new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: d.tier === 'backbone_router' ? 0.55 : 0.18, roughness: 0.45 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(r, h, r), mat);
        m.position.set(p.x, h / 2, p.z); m.userData = { type: 'device', id: d.id, baseEmissive: mat.emissiveIntensity, drained: d.drained };
        scene.add(m); pickables.push(m); devMeshes.set(d.id, m);
        if (d.drained) { const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 1.25, 0.35, r * 1.25), new THREE.MeshBasicMaterial({ color: 0xd8b4fe })); cap.position.set(p.x, h + 0.2, p.z); scene.add(cap); }
      }
      bbrs.forEach(d => addTower(d, 5.2, 2.5, tierColor.backbone_router));
      borders.forEach(d => addTower(d, 2.2, 1.5, tierColor.border));
      // selection ring
      const selRing = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.18, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      selRing.rotation.x = Math.PI / 2; selRing.visible = false; scene.add(selRing);

      // curves
      const circuitObjs = [];
      function arc(aId, bId, status, count, isCircuit, raw) {
        const p1 = devPos.get(aId), p2 = devPos.get(bId); if (!p1 || !p2) return null;
        const s = new THREE.Vector3(p1.x, 5.2, p1.z), e = new THREE.Vector3(p2.x, 5.2, p2.z);
        const mid = s.clone().add(e).multiplyScalar(0.5); mid.y = Math.max(s.y, e.y) + s.distanceTo(e) * 0.28 + 3;
        const curve = new THREE.QuadraticBezierCurve3(s, mid, e);
        const col = status === 'fully' ? 0xff3b30 : status === 'partly' ? 0xf5a623 : 0x5b6b82;
        const radius = isCircuit ? (status === 'healthy' ? 0.16 + count * 0.06 : status === 'partly' ? 0.3 + count * 0.08 : 0.42 + count * 0.08) : 0.07;
        const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: status === 'healthy' ? 0.25 : 1.1, transparent: true, opacity: status === 'healthy' ? (isCircuit ? 0.55 : 0.28) : 0.95, roughness: 0.3 });
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius, 7, false), mat);
        mesh.userData = { type: isCircuit ? 'circuit' : 'faint', circuit: raw || null, status, a: aId, b: bId, baseOpacity: mat.opacity };
        scene.add(mesh); if (isCircuit) { pickables.push(mesh); circuitObjs.push(mesh); } else circuitObjs.push(mesh);
        return mesh;
      }
      circuits.forEach(c => arc(c.a, c.b, statusOf(c.raw), c.count, true, c));
      intraBB.forEach(l => arc(l.a, l.b, statusOf(l), l.count, false, null));
      bbBorder.forEach(l => arc(l.a, l.b, statusOf(l), l.count, false, null));

      function applyFilter() {
        circuitObjs.forEach(m => {
          const healthy = m.userData.status === 'healthy';
          m.material.opacity = onlyBroken && healthy ? 0.05 : m.userData.baseOpacity;
          m.visible = !(onlyBroken && m.userData.type === 'faint' && healthy);
        });
        devMeshes.forEach((m, id) => {
          const d = byId.get(id); const st = devStats(id);
          const involvedBroken = st.broken > 0 || d.drained;
          m.material.opacity = (onlyBroken && !involvedBroken && !d.drained) ? 0.22 : (d.drained ? 0.55 : 1);
          m.material.transparent = true;
        });
      }
      function highlight() {
        devMeshes.forEach((m, id) => { m.material.emissiveIntensity = m.userData.baseEmissive; m.scale.setScalar(1); });
        circuitObjs.forEach(m => { if (m.userData.type === 'circuit') m.material.emissiveIntensity = m.userData.status === 'healthy' ? 0.25 : 1.1; });
        selRing.visible = false;
        if (selectedId && devMeshes.has(selectedId)) {
          const m = devMeshes.get(selectedId); m.material.emissiveIntensity = 2.2; m.scale.setScalar(1.25);
          selRing.position.set(m.position.x, 0.25, m.position.z); selRing.visible = true;
          controls.target.set(m.position.x, 2.5, m.position.z);
        }
        if (selectedCircuit) circuitObjs.forEach(m => { if (m.userData.circuit === selectedCircuit) m.material.emissiveIntensity = 3; });
        panel.querySelectorAll('tr[data-id]').forEach(tr => tr.classList.toggle('pg-bb-sel', tr.dataset.id === selectedId));
        panel.querySelectorAll('tr[data-circuit]').forEach(tr => tr.classList.toggle('pg-bb-sel', selectedCircuit && tr.dataset.circuit === selectedCircuit.a + '|' + selectedCircuit.b));
      }
      kit.onSelect(id => { selectedId = id; if (id) selectedCircuit = circuits.find(c => c.a === id || c.b === id) && selectedCircuit && (selectedCircuit.a === id || selectedCircuit.b === id) ? selectedCircuit : selectedCircuit; highlight(); });

      // ---------- side panel tables ----------
      let circuitSort = { key: 'a', dir: 1 }, siteSort = { key: 'code', dir: 1 };
      function sortRows(rows, sort) { return [...rows].sort((x, y) => { const a = x[sort.key], b = y[sort.key]; return (typeof a === 'number' ? a - b : String(a).localeCompare(String(b))) * sort.dir; }); }
      function renderPanel() {
        panel.innerHTML = '';
        const h = document.createElement('div');
        h.innerHTML = `<label class="pg-bb-check"><input type="checkbox" ${onlyBroken ? 'checked' : ''}> Show only broken</label><div style="color:#8ea3c4;margin-top:6px">Click a row to select. Click column headers to sort.</div>`;
        h.querySelector('input').addEventListener('change', e => { onlyBroken = e.target.checked; applyFilter(); renderPanel(); });
        panel.appendChild(h);
        const mkTable = (title, cols, rows, sort, onSort, rowAttrs) => {
          const t = document.createElement('h3'); t.textContent = title; panel.appendChild(t);
          const table = document.createElement('table');
          const thead = document.createElement('tr');
          cols.forEach(c => { const th = document.createElement('th'); th.textContent = c.label + (sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''); th.addEventListener('click', () => { if (sort.key === c.key) sort.dir *= -1; else { sort.key = c.key; sort.dir = 1; } onSort(); }); thead.appendChild(th); });
          table.appendChild(thead);
          const visible = onlyBroken && title.startsWith('Circuits') ? rows.filter(r => r.up < r.count) : rows;
          sortRows(visible, sort).forEach(r => {
            const tr = document.createElement('tr'); const attrs = rowAttrs(r); Object.entries(attrs).forEach(([k, v]) => tr.dataset[k] = v);
            cols.forEach(c => { const td = document.createElement('td'); td.textContent = r[c.key]; table && tr.appendChild(td); });
            tr.addEventListener('click', () => {
              if (r.a) { selectedCircuit = r; selectedId = r.a; kit.select(r.a); }
              else { const first = bbrs.find(d => d.site === r.code); if (first) { selectedId = first.id; kit.select(first.id); } }
              highlight();
            });
            table.appendChild(tr);
          });
          panel.appendChild(table);
        };
        mkTable('Circuits', [{ key: 'a', label: 'Router A' }, { key: 'b', label: 'Router B' }, { key: 'siteA', label: 'Site A' }, { key: 'siteB', label: 'Site B' }, { key: 'count', label: 'Count' }, { key: 'up', label: 'Up' }, { key: 'down', label: 'Down' }, { key: 'speed', label: 'Gbps' }], circuits, circuitSort, renderPanel, r => ({ id: r.a, circuit: r.a + '|' + r.b }));
        mkTable('Per site', [{ key: 'code', label: 'Site' }, { key: 'routers', label: 'Routers' }, { key: 'circuits', label: 'Circuits' }, { key: 'broken', label: 'Broken circuits' }, { key: 'drained', label: 'Drained routers' }], siteStats, siteSort, renderPanel, r => ({ id: (bbrs.find(d => d.site === r.code) || {}).id || '' }));
        highlight();
      }
      renderPanel();

      // camera fit: every device visible
      const fitR = R + platformR + 8;
      const dist = fitR / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
      camera.position.set(dist * 0.55, dist * 0.65, dist * 0.75); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0);
      if (selectedId) highlight();

      // raycast hover/click
      const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let downAt = 0;
      function pick(ev) {
        const r = renderer.domElement.getBoundingClientRect();
        mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(mouse, camera); const hits = ray.intersectObjects(pickables, false); return hits[0] ? hits[0].object : null;
      }
      renderer.domElement.addEventListener('pointermove', ev => {
        const o = pick(ev);
        if (!o) { tip.style.display = 'none'; renderer.domElement.style.cursor = ''; return; }
        renderer.domElement.style.cursor = 'pointer';
        if (o.userData.type === 'device') { const d = byId.get(o.userData.id), s = devStats(d.id); tip.innerHTML = `<b>${d.id}</b> (${d.site} · ${d.tier})${d.drained ? ' · drained' : ''}<br>Links: ${s.total} · Broken links: ${s.broken}<br>Link members up: ${s.upLinks}/${s.countLinks}`; }
        else { const c = o.userData.circuit; tip.innerHTML = `<b>${c.a} ↔ ${c.b}</b><br>${c.siteA} ↔ ${c.siteB}<br>Count ${c.count} · Up ${c.up} · Down ${c.down} · ${c.speed} Gbps<br>Status: ${statusOf(c.raw)}`; }
        const r = el.getBoundingClientRect(); tip.style.left = (ev.clientX - r.left + 14) + 'px'; tip.style.top = (ev.clientY - r.top + 12) + 'px'; tip.style.display = 'block';
      });
      renderer.domElement.addEventListener('pointerdown', () => downAt = Date.now());
      renderer.domElement.addEventListener('pointerup', ev => {
        if (Date.now() - downAt > 250) return; const o = pick(ev); if (!o) return;
        if (o.userData.type === 'device') { selectedId = o.userData.id; selectedCircuit = null; kit.select(selectedId); }
        else if (o.userData.circuit) { selectedCircuit = o.userData.circuit; selectedId = selectedCircuit.a; kit.select(selectedId); }
        highlight();
      });

      renderer.__pgResize = () => { const w = W(), h = H(); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
      onResize = () => renderer.__pgResize(); window.addEventListener('resize', onResize);

      const clock = new THREE.Clock();
      (function animate() {
        raf = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        circuitObjs.forEach(m => { if (m.userData.status === 'fully') { m.material.emissiveIntensity = 1.4 + Math.sin(t * 4) * 0.9; } });
        selRing.rotation.z = t * 0.8;
        controls.update(); renderer.render(scene, camera);
        siteLabels.forEach(({ el: lab, pos }) => { const p = kit.projectToScreen(pos, camera, W(), H()); lab.style.left = p.x + 'px'; lab.style.top = p.y + 'px'; lab.style.opacity = p.y < -20 || p.x < -40 ? '0' : '1'; });
      })();
      applyFilter();
    }
  };
});
