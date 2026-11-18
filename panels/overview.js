kit.page('overview', function () {
  let renderer = null, scene = null, camera = null, controls = null, raf = 0;
  let container = null, raycaster = null, pointer = null, inst = null, brokenInst = null;
  let devicesArr = [], posById = new Map(), devById = new Map(), hoverId = null, selectedId = null;
  let highlight = null, linkMats = [], brokenMat = null, emptyMat = null, onResizeWin = null;
  let tooltipEl = null, mouseEv = null, stateRef = null;

  function disposePrev() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (onResizeWin) window.removeEventListener('resize', onResizeWin); onResizeWin = null;
    if (renderer) { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {} renderer = null; }
    scene = null; camera = null; controls = null; inst = null; brokenInst = null; highlight = null;
    linkMats = []; brokenMat = null; stateRef = null;
  }
  function resize() {
    if (!renderer || !container || !camera) return;
    const w = container.clientWidth || 800, h = container.clientHeight || 600;
    camera.aspect = w / h;
    if (w > 900) camera.setViewOffset(w, h, 170, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
  }

  return {
    resize,
    mount(el, model, kit) {
      disposePrev();
      el.innerHTML = '';
      el.style.position = 'relative'; el.style.overflow = 'hidden'; el.style.background = '#0b0f17';
      container = el;
      const TIERS = kit.tiers;
      const rank = {}; TIERS.forEach((t, i) => rank[t] = i);
      const tierColor = { top_of_rack: 0x38bdf8, spine: 0x34d399, super_spine: 0xa78bfa, border: 0xfbbf24, backbone_router: 0xf472b6 };
      const tierShort = { top_of_rack: 'ToR', spine: 'Spine', super_spine: 'Super-spine', border: 'Border', backbone_router: 'Backbone' };

      // ---- counts (definitions exactly as specified) ----
      const isBroken = l => l.up < l.count, isPartly = l => l.up > 0 && l.up < l.count, isFull = l => l.up === 0;
      const totalBroken = model.links.filter(isBroken).length;
      const totalPartly = model.links.filter(isPartly).length;
      const totalFull = model.links.filter(isFull).length;
      const totalDrained = model.devices.filter(d => d.drained).length;
      const devLinks = new Map(); model.devices.forEach(d => devLinks.set(d.id, []));
      model.links.forEach(l => { if (devLinks.has(l.a)) devLinks.get(l.a).push(l); if (devLinks.has(l.b)) devLinks.get(l.b).push(l); });
      const devBroken = new Map(); model.devices.forEach(d => {
        const ls = devLinks.get(d.id) || [];
        devBroken.set(d.id, { links: ls.length, broken: ls.filter(isBroken).length, up: 0, upBroken: 0 });
      });
      // uplinks via kit
      model.devices.forEach(d => {
        try { const u = kit.uplinks(d.id); const e = devBroken.get(d.id); e.up = u.length; e.upBroken = u.filter(isBroken).length; } catch (e) {}
      });
      const brokenDevIds = new Set(model.devices.filter(d => d.drained || (devBroken.get(d.id) && devBroken.get(d.id).broken > 0)).map(d => d.id));

      // ---- layout ----
      devicesArr = model.devices.slice().sort((a, b) => a.id < b.id ? -1 : 1);
      devById = new Map(devicesArr.map(d => [d.id, d]));
      posById = new Map();
      const emptySlots = []; // {x,y,z,site}
      const sites = model.sites.slice();
      const siteLayouts = new Map();
      sites.forEach(site => {
        const devs = devicesArr.filter(d => d.site === site.code);
        const tors = devs.filter(d => d.tier === 'top_of_rack');
        const pods = [...new Set(tors.map(d => d.pod))].sort((a, b) => (a == null ? 0 : a) - (b == null ? 0 : b));
        const podsPerRow = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, pods.length))));
        // per-pod row/col sets
        let podW = 4, podD = 4;
        const podInfo = new Map();
        pods.forEach(p => {
          const pd = tors.filter(d => d.pod === p);
          const rows = [...new Set(pd.map(d => d.row).filter(v => v != null))].sort((a, b) => a - b);
          const cols = [...new Set(pd.map(d => d.col).filter(v => v != null))].sort((a, b) => a - b);
          podInfo.set(p, { rows, cols, pd });
          podW = Math.max(podW, Math.max(1, cols.length) * 1.15); podD = Math.max(podD, Math.max(1, rows.length) * 1.15);
        });
        const gap = 1.2;
        const width = podsPerRow * podW + (podsPerRow - 1) * gap;
        const podRowsN = Math.max(1, Math.ceil(pods.length / podsPerRow));
        const depth = podRowsN * podD + (podRowsN - 1) * gap;
        const local = new Map();
        pods.forEach((p, pi) => {
          const info = podInfo.get(p); if (!info) return;
          const px = (pi % podsPerRow) * (podW + gap) - width / 2 + podW / 2;
          const pz = Math.floor(pi / podsPerRow) * (podD + gap) - depth / 2 + podD / 2;
          const rIdx = {}; info.rows.forEach((r, i) => rIdx[r] = i); const cIdx = {}; info.cols.forEach((c, i) => cIdx[c] = i);
          const present = new Set(info.pd.map(d => d.row + ',' + d.col));
          info.pd.forEach(d => {
            const x = px + ((cIdx[d.col] || 0) - (info.cols.length - 1) / 2) * 1.15;
            const z = pz + ((rIdx[d.row] || 0) - (info.rows.length - 1) / 2) * 1.15;
            local.set(d.id, { x, y: 0.6, z });
          });
          info.rows.forEach(r => info.cols.forEach(c => {
            if (!present.has(r + ',' + c)) emptySlots.push({ site: site.code, pod: p, x: 0, z: 0, lx: px + ((cIdx[c] || 0) - (info.cols.length - 1) / 2) * 1.15, lz: pz + ((rIdx[r] || 0) - (info.rows.length - 1) / 2) * 1.15, y: 0.6 });
          }));
        });
        // upper tiers: spread across width, centered
        TIERS.slice(1).forEach(t => {
          const td = devs.filter(d => d.tier === t).sort((a, b) => a.id < b.id ? -1 : 1);
          td.forEach((d, i) => {
            const x = td.length === 1 ? 0 : -width / 2 + (width * i / (td.length - 1 || 1));
            local.set(d.id, { x, y: 0.6 + rank[t] * 4.4, z: 0 });
          });
        });
        // devices without row/col and not upper handled above; fallback grid
        devs.forEach((d, i) => { if (!local.has(d.id)) local.set(d.id, { x: (i % 10) - 5, y: 0.6 + rank[d.tier] * 4.4, z: Math.floor(i / 10) - 2 }); });
        siteLayouts.set(site.code, { width: Math.max(width, 10), depth: Math.max(depth, 8), local, height: 0.6 + 4 * 4.4 + 2 });
      });
      const siteCols = sites.length <= 3 ? Math.max(1, sites.length) : Math.ceil(Math.sqrt(sites.length));
      const maxW = Math.max(...sites.map(s => siteLayouts.get(s.code).width), 10);
      const maxD = Math.max(...sites.map(s => siteLayouts.get(s.code).depth), 8);
      const siteOrigin = new Map();
      sites.forEach((s, i) => {
        const cx = (i % siteCols) * (maxW + 14) - ((Math.min(siteCols, sites.length) - 1) * (maxW + 14)) / 2;
        const cz = Math.floor(i / siteCols) * (maxD + 14) - ((Math.ceil(sites.length / siteCols) - 1) * (maxD + 14)) / 2;
        siteOrigin.set(s.code, { x: cx, z: cz });
        const lay = siteLayouts.get(s.code);
        lay.local.forEach((p, id) => posById.set(id, new THREE.Vector3(cx + p.x, p.y, cz + p.z)));
        emptySlots.filter(e => e.site === s.code).forEach(e => { e.x = cx + e.lx; e.z = cz + e.lz; });
      });

      // ---- DOM overlays ----
      const style = document.createElement('style');
      style.textContent = `
.pg-ov-wrap{position:absolute;inset:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e5edf7}
.pg-ov-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pg-ov-legend{position:absolute;left:12px;top:12px;background:rgba(10,16,28,.88);border:1px solid #263449;border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.7;max-width:230px;backdrop-filter:blur(4px);z-index:3}
.pg-ov-legend b{font-size:13px}.pg-ov-sw{display:inline-block;width:22px;height:4px;border-radius:2px;vertical-align:middle;margin-right:7px}
.pg-ov-dot{display:inline-block;width:10px;height:10px;border-radius:3px;vertical-align:middle;margin-right:7px}
.pg-ov-side{position:absolute;right:12px;top:12px;bottom:12px;width:352px;background:rgba(10,16,28,.92);border:1px solid #263449;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;z-index:3}
.pg-ov-side h3{margin:0;padding:10px 12px 6px;font-size:13px}
.pg-ov-filters{padding:2px 12px 8px;display:flex;flex-wrap:wrap;gap:5px;border-bottom:1px solid #22304a}
.pg-ov-chip{border:1px solid #35507a;background:#16263f;color:#cfe3ff;border-radius:999px;padding:3px 9px;font-size:11px;cursor:pointer}
.pg-ov-chip.off{opacity:.38;background:transparent}.pg-ov-chip.on{background:#7c2d12;border-color:#f59e0b;color:#fff}
.pg-ov-twrap{overflow:auto;flex:1}
.pg-ov-table{border-collapse:collapse;width:100%;font-size:11px}
.pg-ov-table th{position:sticky;top:0;background:#16263f;color:#bcd3f5;text-align:right;padding:6px 6px;cursor:pointer;white-space:nowrap;user-select:none}
.pg-ov-table th:first-child,.pg-ov-table td:first-child,.pg-ov-table th:nth-child(2),.pg-ov-table td:nth-child(2){text-align:left}
.pg-ov-table td{padding:5px 6px;border-bottom:1px solid #1b2a42;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pg-ov-table tr{cursor:pointer}.pg-ov-table tr:hover td{background:#1a2f4d}
.pg-ov-sum td{background:#132238;font-weight:700}
.pg-ov-tip{position:absolute;pointer-events:none;background:rgba(5,10,20,.95);border:1px solid #3b82f6;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;display:none;z-index:5;max-width:280px}
.pg-ov-hint{position:absolute;left:12px;bottom:12px;font-size:11px;color:#8aa0bd;background:rgba(10,16,28,.7);padding:5px 9px;border-radius:7px;z-index:3}`;
      el.appendChild(style);
      const wrap = document.createElement('div'); wrap.className = 'pg-ov-wrap'; el.appendChild(wrap);

      // ---- three setup ----
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0f17); scene.fog = new THREE.Fog(0x0b0f17, 400, 900);
      camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2000);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.domElement.className = 'pg-ov-canvas'; wrap.appendChild(renderer.domElement);
      controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
      scene.add(new THREE.AmbientLight(0xffffff, 1.15));
      const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(60, 120, 40); scene.add(dl);
      const gridSize = Math.max(maxW * siteCols + 80, maxD * 3 + 80);
      const grid = new THREE.GridHelper(gridSize, 60, 0x24405f, 0x16263c); grid.position.y = -0.05; scene.add(grid);

      // devices InstancedMesh
      const geo = new THREE.BoxGeometry(0.92, 0.92, 0.92);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, vertexColors: false });
      inst = new THREE.InstancedMesh(geo, mat, devicesArr.length); inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const dummy = new THREE.Object3D(); const col = new THREE.Color();
      const baseColors = [];
      devicesArr.forEach((d, i) => {
        const p = posById.get(d.id); dummy.position.copy(p);
        const s = d.tier === 'top_of_rack' ? 1 : 1.55; dummy.scale.set(s, s, s); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
        col.set(d.drained ? 0xc084fc : tierColor[d.tier]); if (d.drained) col.set(0xa855f7);
        baseColors.push(col.clone()); inst.setColorAt(i, col);
      });
      scene.add(inst);
      const idxById = new Map(devicesArr.map((d, i) => [d.id, i]));

      // empty slots
      if (emptySlots.length) {
        const eg = new THREE.BoxGeometry(0.92, 0.92, 0.92);
        emptyMat = new THREE.MeshBasicMaterial({ color: 0x5b7aa6, wireframe: true, transparent: true, opacity: 0.28 });
        const em = new THREE.InstancedMesh(eg, emptyMat, emptySlots.length);
        emptySlots.forEach((e, i) => { dummy.position.set(e.x, e.y, e.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); em.setMatrixAt(i, dummy.matrix); });
        scene.add(em);
      }
      // site floor plates + labels
      function makeSprite(text, scale) {
        const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
        g.font = 'bold 44px system-ui,sans-serif'; g.textAlign = 'center'; g.fillStyle = '#eaf3ff'; g.shadowColor = '#000'; g.shadowBlur = 8; g.fillText(text, 256, 58);
        const tex = new THREE.CanvasTexture(c); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        sp.scale.set(scale || 22, (scale || 22) * 0.1875, 1); return sp;
      }
      sites.forEach(s => {
        const o = siteOrigin.get(s.code), lay = siteLayouts.get(s.code);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(lay.width + 2, 0.18, lay.depth + 2), new THREE.MeshStandardMaterial({ color: 0x111c2e, roughness: 0.9 }));
        plate.position.set(o.x, -0.12, o.z); scene.add(plate);
        const sp = makeSprite((s.name || s.code) + ' · ' + s.code, 20); sp.position.set(o.x, lay.height + 3, o.z); scene.add(sp);
      });

      // links
      const buckets = { healthy: [], partly: [], full: [] };
      const brokenMids = [];
      model.links.forEach(l => {
        const pa = posById.get(l.a), pb = posById.get(l.b); if (!pa || !pb) return;
        const da = devById.get(l.a), db = devById.get(l.b);
        const bucket = isFull(l) ? 'full' : isPartly(l) ? 'partly' : 'healthy';
        const inter = da && db && da.site !== db.site;
        if (inter) {
          const mid = pa.clone().add(pb).multiplyScalar(0.5); mid.y = Math.max(pa.y, pb.y) + pa.distanceTo(pb) * 0.22;
          let prev = pa; const N = 14;
          for (let i = 1; i <= N; i++) { const t = i / N; const p = pa.clone().lerp(pb, t); p.y = pa.y + (pb.y - pa.y) * t + Math.sin(t * Math.PI) * pa.distanceTo(pb) * 0.22; buckets[bucket].push(prev.x, prev.y, prev.z, p.x, p.y, p.z); prev = p; }
          if (bucket !== 'healthy') brokenMids.push(mid);
        } else {
          buckets[bucket].push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
          if (bucket !== 'healthy') brokenMids.push(pa.clone().add(pb).multiplyScalar(0.5));
        }
      });
      function addLines(arr, color, opacity) {
        if (!arr.length) return null;
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity }); scene.add(new THREE.LineSegments(g, m)); linkMats.push(m); return m;
      }
      const healthyMat = addLines(buckets.healthy, 0x3d5a78, 0.28);
      const partlyMat = addLines(buckets.partly, 0xf59e0b, 0.98);
      const fullMat = addLines(buckets.full, 0xef4444, 0.98);
      // broken markers
      if (brokenMids.length) {
        brokenMat = new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.95 });
        brokenInst = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.55), brokenMat, brokenMids.length);
        brokenMids.forEach((p, i) => { dummy.position.copy(p); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); brokenInst.setMatrixAt(i, dummy.matrix); });
        scene.add(brokenInst);
      }
      highlight = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true, transparent: true, opacity: 0.95 }));
      highlight.visible = false; scene.add(highlight);

      // fit camera to all devices
      const box = new THREE.Box3(); devicesArr.forEach(d => box.expandByPoint(posById.get(d.id)));
      const center = box.getCenter(new THREE.Vector3()), sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = Math.max(30, sphere.radius / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.02);
      camera.position.set(center.x + dist * 0.55, center.y + dist * 0.62, center.z + dist * 0.78);
      camera.lookAt(center); controls.target.copy(center);

      // ---- legend ----
      const legend = document.createElement('div'); legend.className = 'pg-ov-legend';
      legend.innerHTML = `<b>Overview — whole network</b><br>
<span class="pg-ov-sw" style="background:#3d5a78"></span>Healthy link (up = count)<br>
<span class="pg-ov-sw" style="background:#f59e0b;height:6px"></span>Partly broken link<br>
<span class="pg-ov-sw" style="background:#ef4444;height:8px"></span>Fully broken link<br>
<span class="pg-ov-dot" style="background:#a855f7"></span>Drained device<br>
${TIERS.map(t => `<span class="pg-ov-dot" style="background:#${tierColor[t].toString(16).padStart(6, '0')}"></span>${tierShort[t]}<br>`).join('')}
<span class="pg-ov-dot" style="background:transparent;border:1px solid #5b7aa6"></span>Empty rack slot<br>
<b>Totals:</b> Devices: ${model.devices.length} · Links: ${model.links.length}<br>
Broken links: ${totalBroken} · Partly: ${totalPartly} · Fully: ${totalFull}<br>Drained: ${totalDrained}`;
      wrap.appendChild(legend);
      const hint = document.createElement('div'); hint.className = 'pg-ov-hint'; hint.textContent = 'Drag to rotate · scroll to zoom · hover / click a device · click a table row to select'; wrap.appendChild(hint);
      tooltipEl = document.createElement('div'); tooltipEl.className = 'pg-ov-tip'; wrap.appendChild(tooltipEl);

      // ---- side panel / table ----
      const rowsData = [];
      sites.forEach(s => {
        TIERS.forEach(t => {
          const ds = devicesArr.filter(d => d.site === s.code && d.tier === t); if (!ds.length) return;
          const idset = new Set(ds.map(d => d.id)); const seen = new Set(); let links = 0, br = 0, pa = 0, fu = 0;
          model.links.forEach(l => { if (idset.has(l.a) || idset.has(l.b)) { const k = l.a + '|' + l.b; if (seen.has(k)) return; seen.add(k); links++; if (isBroken(l)) br++; if (isPartly(l)) pa++; if (isFull(l)) fu++; } });
          rowsData.push({ site: s.code, tier: t, devices: ds.length, drained: ds.filter(d => d.drained).length, links, broken: br, partly: pa, fully: fu, first: ds[0].id, sum: false, rank: rank[t] });
        });
        const ds = devicesArr.filter(d => d.site === s.code); const idset = new Set(ds.map(d => d.id)); let links = 0, br = 0, pa = 0, fu = 0;
        model.links.forEach(l => { if (idset.has(l.a) && idset.has(l.b)) { links++; if (isBroken(l)) br++; if (isPartly(l)) pa++; if (isFull(l)) fu++; } });
        rowsData.push({ site: s.code, tier: 'ALL', devices: ds.length, drained: ds.filter(d => d.drained).length, links, broken: br, partly: pa, fully: fu, first: ds[0] && ds[0].id, sum: true, rank: 99 });
      });
      const side = document.createElement('div'); side.className = 'pg-ov-side';
      side.innerHTML = `<h3>Site × tier — click a header to sort, a row to select</h3><div class="pg-ov-filters"></div><div class="pg-ov-twrap"><table class="pg-ov-table"><thead><tr>
${[['site', 'Site'], ['tier', 'Tier'], ['devices', 'Devices'], ['drained', 'Drained'], ['links', 'Links'], ['broken', 'Broken'], ['partly', 'Partly'], ['fully', 'Fully']].map(([k, l]) => `<th data-k="${k}">${l}</th>`).join('')}
</tr></thead><tbody></tbody></table></div>`;
      wrap.appendChild(side);
      const tbody = side.querySelector('tbody');
      let sortKey = null, sortDir = 1;
      const filters = side.querySelector('.pg-ov-filters');
      const activeTiers = new Set(TIERS), activeSites = new Set(sites.map(s => s.code));
      let onlyBroken = false;
      stateRef = { activeTiers, activeSites, get onlyBroken() { return onlyBroken; } };
      function chip(label, onClick) { const b = document.createElement('button'); b.className = 'pg-ov-chip'; b.textContent = label; b.addEventListener('click', () => onClick(b)); filters.appendChild(b); return b; }
      const obChip = chip('Show only broken', b => { onlyBroken = !onlyBroken; b.classList.toggle('on', onlyBroken); applyFilters(); });
      TIERS.forEach(t => chip(tierShort[t], b => { activeTiers.has(t) ? activeTiers.delete(t) : activeTiers.add(t); b.classList.toggle('off', !activeTiers.has(t)); applyFilters(); renderTable(); }));
      sites.forEach(s => chip(s.code, b => { activeSites.has(s.code) ? activeSites.delete(s.code) : activeSites.add(s.code); b.classList.toggle('off', !activeSites.has(s.code)); applyFilters(); renderTable(); }));

      function applyFilters() {
        if (!inst) return; const c = new THREE.Color();
        devicesArr.forEach((d, i) => {
          let show = activeTiers.has(d.tier) && activeSites.has(d.site);
          if (show && onlyBroken && !brokenDevIds.has(d.id)) show = false;
          c.copy(baseColors[i]); if (!show) c.multiplyScalar(0.12);
          if (selectedId === d.id) c.set(0xfacc15);
          inst.setColorAt(i, c);
        });
        inst.instanceColor.needsUpdate = true;
        if (healthyMat) healthyMat.opacity = onlyBroken ? 0.03 : 0.28;
        if (partlyMat) partlyMat.opacity = 0.98; if (fullMat) fullMat.opacity = 0.98;
      }
      function renderTable() {
        let rows = rowsData.filter(r => activeSites.has(r.site) && (r.sum || activeTiers.has(r.tier)));
        if (sortKey) rows = rows.slice().sort((a, b) => { const va = a[sortKey], vb = b[sortKey]; return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sortDir; });
        else rows = rows.slice().sort((a, b) => a.site.localeCompare(b.site) || a.rank - b.rank);
        tbody.innerHTML = '';
        rows.forEach(r => {
          const tr = document.createElement('tr'); if (r.sum) tr.className = 'pg-ov-sum';
          tr.innerHTML = `<td>${r.site}</td><td>${r.sum ? 'ALL' : tierShort[r.tier]}</td><td>${r.devices}</td><td>${r.drained}</td><td>${r.links}</td><td>${r.broken}</td><td>${r.partly}</td><td>${r.fully}</td>`;
          tr.addEventListener('click', () => { if (r.first) kit.select(r.first); });
          tbody.appendChild(tr);
        });
      }
      side.querySelectorAll('th').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; } renderTable(); }));
      renderTable();

      function focusDevice(id) {
        selectedId = id; const p = posById.get(id); if (!p) return;
        highlight.visible = true; highlight.position.copy(p);
        controls.target.copy(p); applyFilters();
      }
      kit.onSelect(id => { if (id && posById.has(id)) focusDevice(id); });
      if (kit.selected && posById.has(kit.selected)) focusDevice(kit.selected);

      // ---- raycast hover/click ----
      raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
      let downPos = null;
      function pick(ev) {
        const r = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera); const hits = raycaster.intersectObject(inst);
        return hits.length && hits[0].instanceId != null ? devicesArr[hits[0].instanceId] : null;
      }
      renderer.domElement.addEventListener('pointermove', ev => {
        const d = pick(ev);
        if (d) { hoverId = d.id; const e = devBroken.get(d.id); tooltipEl.style.display = 'block';
          const r = wrap.getBoundingClientRect(); tooltipEl.style.left = (ev.clientX - r.left + 14) + 'px'; tooltipEl.style.top = (ev.clientY - r.top + 10) + 'px';
          tooltipEl.innerHTML = `<b>${d.id}</b><br>${tierShort[d.tier]} · ${d.site}${d.drained ? ' · <span style="color:#c084fc">drained</span>' : ''}<br>Links: ${e.links} · Broken links: ${e.broken}<br>Uplinks: ${e.up} · Broken uplinks: ${e.upBroken}`;
          renderer.domElement.style.cursor = 'pointer';
        } else { hoverId = null; tooltipEl.style.display = 'none'; renderer.domElement.style.cursor = 'grab'; }
      });
      renderer.domElement.addEventListener('pointerdown', ev => downPos = [ev.clientX, ev.clientY]);
      renderer.domElement.addEventListener('pointerup', ev => {
        if (!downPos || Math.hypot(ev.clientX - downPos[0], ev.clientY - downPos[1]) > 5) return;
        const d = pick(ev); if (d) kit.select(d.id);
      });

      resize();
      onResizeWin = () => resize(); window.addEventListener('resize', onResizeWin);
      const clock = new THREE.Clock();
      (function animate() {
        raf = requestAnimationFrame(animate); const t = clock.getElapsedTime();
        if (brokenMat) brokenMat.opacity = 0.65 + 0.35 * Math.sin(t * 4);
        if (highlight && highlight.visible) highlight.rotation.y = t * 0.8;
        if (controls) controls.update(); if (renderer && scene && camera) renderer.render(scene, camera);
      })();
    }
  };
});
