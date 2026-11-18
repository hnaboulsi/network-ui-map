kit.page('site', function () {
  var S = null;
  function disposeState() {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    window.removeEventListener('resize', S.onResize);
    if (S.renderer) { try { S.renderer.dispose(); } catch (e) {} if (S.renderer.domElement && S.renderer.domElement.parentNode) S.renderer.domElement.parentNode.removeChild(S.renderer.domElement); }
    S = null;
  }
  function statsFor(d, kit) {
    var all = kit.linksOf(d.id);
    var broken = 0, down = 0;
    all.forEach(function (l) { if (l.up < l.count) broken++; down += (l.count - l.up); });
    return { links: all.length, broken: broken, down: down };
  }
  return {
    resize: function () { if (S && S.onResize) S.onResize(); },
    mount: function (el, model, kit) {
      disposeState();
      el.innerHTML = '';
      var tiersColor = { super_spine: 0x38bdf8, border: 0xa78bfa, backbone_router: 0xfacc15, spine: 0x64748b };
      var state = { site: model.sites.length ? model.sites[0].code : 'all', onlyBroken: false, sortKey: 'id', sortDir: 1, planeSortKey: 'plane', planeSortDir: 1, selected: null, hover: null };
      var wrap = document.createElement('div'); wrap.className = 'pg-site-wrap'; el.appendChild(wrap);
      wrap.innerHTML = '<style>'
        + '.pg-site-wrap{position:relative;width:100%;height:100%;min-height:560px;background:#0b0f17;color:#e2e8f0;font-family:system-ui,sans-serif;overflow:hidden}'
        + '.pg-site-canvas{position:absolute;inset:0}.pg-site-canvas canvas{display:block}'
        + '.pg-site-top{position:absolute;top:10px;left:10px;z-index:5;display:flex;gap:6px;flex-wrap:wrap;max-width:55%}'
        + '.pg-site-btn{background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:999px;padding:6px 12px;cursor:pointer;font-size:12px}.pg-site-btn.pg-site-on{background:#0ea5e9;color:#fff;border-color:#38bdf8}'
        + '.pg-site-legend{position:absolute;left:10px;bottom:10px;z-index:5;background:rgba(15,23,42,.92);border:1px solid #334155;border-radius:10px;padding:10px 12px;font-size:11px;line-height:1.7;max-width:260px}'
        + '.pg-site-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle}'
        + '.pg-site-panel{position:absolute;top:0;right:0;bottom:0;width:360px;z-index:6;background:rgba(13,20,36,.97);border-left:1px solid #334155;padding:12px;overflow-y:auto;box-sizing:border-box}'
        + '.pg-site-panel h3{margin:10px 0 6px;font-size:12px;color:#f1f5f9}.pg-site-panel table{width:100%;border-collapse:collapse;font-size:11px}'
        + '.pg-site-panel th{cursor:pointer;text-align:left;color:#7dd3fc;border-bottom:1px solid #334155;padding:5px 4px;white-space:nowrap;user-select:none}.pg-site-panel td{padding:5px 4px;border-bottom:1px solid #1e293b;white-space:nowrap}'
        + '.pg-site-panel tr{cursor:pointer}.pg-site-panel tbody tr:hover{background:#1e293b}.pg-site-sel{background:#164e63!important}'
        + '.pg-site-tip{position:absolute;pointer-events:none;z-index:9;background:#020617;border:1px solid #38bdf8;border-radius:8px;padding:8px 10px;font-size:11px;display:none;max-width:240px;line-height:1.5}'
        + '.pg-site-check{font-size:12px;color:#e2e8f0;display:flex;gap:6px;align-items:center;cursor:pointer}'
        + '@media(max-width:900px){.pg-site-panel{width:300px}}'
        + '</style>'
        + '<div class="pg-site-canvas"></div><div class="pg-site-top"></div><div class="pg-site-legend"></div>'
        + '<div class="pg-site-panel"></div><div class="pg-site-tip"></div>';
      var canvasDiv = wrap.querySelector('.pg-site-canvas'), topDiv = wrap.querySelector('.pg-site-top'), legendDiv = wrap.querySelector('.pg-site-legend'), panelDiv = wrap.querySelector('.pg-site-panel'), tip = wrap.querySelector('.pg-site-tip');

      // site buttons
      function renderTop() {
        topDiv.innerHTML = '';
        var opts = model.sites.map(function (s) { return { code: s.code, label: s.code + ' ' + s.name }; });
        opts.push({ code: 'all', label: 'All sites' });
        opts.forEach(function (o) {
          var b = document.createElement('button'); b.className = 'pg-site-btn' + (state.site === o.code ? ' pg-site-on' : ''); b.textContent = o.label;
          b.onclick = function () { state.site = o.code; renderTop(); build(); }; topDiv.appendChild(b);
        });
      }

      // three setup
      var W = function () { return Math.max(300, el.clientWidth || wrap.clientWidth); }, H = function () { return Math.max(300, el.clientHeight || wrap.clientHeight); };
      var renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), H()); renderer.setClearColor(0x0b0f17); canvasDiv.appendChild(renderer.domElement);
      var scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x0b0f17, 120, 260);
      var camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 1000);
      var controls = new THREE.OrbitControls(camera, renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      var dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(20, 40, 20); scene.add(dl);
      var grid = new THREE.GridHelper(120, 60, 0x1e3a5f, 0x162032); grid.position.y = -1.2; scene.add(grid);

      var ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
      var inst = null, brokenCyl = null, linkLines = null, posMap = {}, deviceList = [], idToIdx = {}, ring = null, emptyEdges = null;
      var linkData = []; // {a,b,link, brokenKind}
      var clockStart = performance.now();

      function visibleSites() { return state.site === 'all' ? model.sites.map(function (s) { return s.code; }) : [state.site]; }

      function build() {
        // clear dynamic
        [inst, brokenCyl, linkLines, ring, emptyEdges].forEach(function (o) { if (o) { scene.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); }); } });
        inst = null; brokenCyl = null; linkLines = null; ring = null; emptyEdges = null;
        posMap = {}; deviceList = []; idToIdx = {}; linkData = [];
        var sites = visibleSites();
        var perSite = {};
        sites.forEach(function (code, si) {
          var devs = model.devices.filter(function (d) { return d.site === code; });
          var ss = devs.filter(function (d) { return d.tier === 'super_spine'; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
          var borders = devs.filter(function (d) { return d.tier === 'border'; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
          var bbs = devs.filter(function (d) { return d.tier === 'backbone_router'; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
          var spines = devs.filter(function (d) { return d.tier === 'spine'; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
          var planes = Array.from(new Set(ss.map(function (d) { return d.plane; }).concat(spines.map(function (d) { return d.plane; })))).sort(function (a, b) { return a - b; });
          var ox = si * 42 - (sites.length - 1) * 21;
          perSite[code] = { planes: planes, ss: ss };
          // empty slot positions: max SS per plane
          var maxPerPlane = 0; var byPlane = {};
          planes.forEach(function (p) { byPlane[p] = ss.filter(function (d) { return d.plane === p; }); if (byPlane[p].length > maxPerPlane) maxPerPlane = byPlane[p].length; });
          var empties = [];
          planes.forEach(function (p, pi) {
            for (var i = 0; i < maxPerPlane; i++) {
              var x = ox + pi * 7, z = (i - (maxPerPlane - 1) / 2) * 3.2;
              var d = byPlane[p][i];
              if (d) posMap[d.id] = new THREE.Vector3(x, 4, z);
              else empties.push(x, 4, z);
            }
          });
          // borders / bbs centered
          var cx = ox + (planes.length - 1) * 3.5;
          borders.forEach(function (d, i) { posMap[d.id] = new THREE.Vector3(cx + (i - (borders.length - 1) / 2) * 4, 9, 0); });
          bbs.forEach(function (d, i) { posMap[d.id] = new THREE.Vector3(cx + (i - (bbs.length - 1) / 2) * 4, 14, 0); });
          spines.forEach(function (d) {
            var pi = Math.max(0, planes.indexOf(d.plane));
            var idxInPlane = spines.filter(function (s) { return s.plane === d.plane; }).sort(function (a, b) { return a.id.localeCompare(b.id); }).indexOf(d);
            posMap[d.id] = new THREE.Vector3(ox + pi * 7, 0, (idxInPlane - 4.5) * 1.6);
          });
          // store empties geometry later
          perSite[code].empties = empties; perSite[code].cx = cx;
        });
        deviceList = model.devices.filter(function (d) { return sites.indexOf(d.site) >= 0 && posMap[d.id]; });
        deviceList.forEach(function (d, i) { idToIdx[d.id] = i; });
        // InstancedMesh devices
        var geo = new THREE.BoxGeometry(1.6, 1.1, 2.2);
        var mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
        inst = new THREE.InstancedMesh(geo, mat, Math.max(1, deviceList.length));
        var m4 = new THREE.Matrix4(), col = new THREE.Color();
        deviceList.forEach(function (d, i) {
          var p = posMap[d.id]; var s = d.tier === 'spine' ? 0.55 : (d.tier === 'backbone_router' ? 1.15 : 1);
          m4.makeScale(s, s, s); m4.setPosition(p); inst.setMatrixAt(i, m4);
          col.setHex(d.drained ? 0xa855f7 : (tiersColor[d.tier] || 0x94a3b8)); if (d.drained) col.multiplyScalar(0.9);
          inst.setColorAt(i, col);
        });
        inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        scene.add(inst);
        // ring for selection
        ring = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 2.9), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.95 }));
        ring.visible = false; scene.add(ring);
        // empty slots
        var ePts = [];
        sites.forEach(function (code) { var em = perSite[code].empties || []; for (var i = 0; i < em.length; i += 3) { var x = em[i], y = em[i + 1], z = em[i + 2]; var s = 0.9; ePts.push(x - s, y, z - s, x + s, y, z - s, x + s, y, z - s, x + s, y, z + s, x + s, y, z + s, x - s, y, z + s, x - s, y, z + s, x - s, y, z - s); } });
        if (ePts.length) { var eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ePts, 3)); emptyEdges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.6 })); scene.add(emptyEdges); }
        // links: only among visible posMap, tiers ss-border, border-bb, ss-spine (+ spine-ss same)
        var seen = new Set();
        model.links.forEach(function (l) {
          if (!posMap[l.a] || !posMap[l.b]) return;
          var da = kit.device(l.a), db = kit.device(l.b); if (!da || !db) return;
          var pair = [da.tier, db.tier].sort().join('|');
          if (pair !== 'border|super_spine' && pair !== 'backbone_router|border' && pair !== 'spine|super_spine') return;
          var k = l.a + '|' + l.b; if (seen.has(k)) return; seen.add(k); linkData.push(l);
        });
        var lp = [], lc = [];
        var cHealthy = new THREE.Color(0x2f6f4f), cPart = new THREE.Color(0xffaa00), cFull = new THREE.Color(0xff2222);
        linkData.forEach(function (l) {
          var a = posMap[l.a], b = posMap[l.b]; lp.push(a.x, a.y, a.z, b.x, b.y, b.z);
          var c = l.up === l.count ? cHealthy : (l.up === 0 ? cFull : cPart); lc.push(c.r, c.g, c.b, c.r, c.g, c.b);
        });
        var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
        linkLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: state.onlyBroken ? 0.12 : 0.75 }));
        scene.add(linkLines);
        // broken cylinders (thicker)
        var broken = linkData.filter(function (l) { return l.up < l.count; });
        if (broken.length) {
          var cg = new THREE.CylinderGeometry(0.09, 0.09, 1, 6);
          brokenCyl = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ color: 0xff3333 }), broken.length);
          var up = new THREE.Vector3(0, 1, 0), mid = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
          broken.forEach(function (l, i) { var a = posMap[l.a], b = posMap[l.b]; mid.addVectors(a, b).multiplyScalar(0.5); dir.subVectors(b, a); var len = dir.length(); q.setFromUnitVectors(up, dir.normalize()); sc.set(l.up === 0 ? 2.2 : 1.4, len, l.up === 0 ? 2.2 : 1.4); var mm = new THREE.Matrix4().compose(mid, q, sc); brokenCyl.setMatrixAt(i, mm); brokenCyl.setColorAt(i, new THREE.Color(l.up === 0 ? 0xff2222 : 0xffaa00)); });
          brokenCyl.instanceMatrix.needsUpdate = true; scene.add(brokenCyl);
        }
        applyDim(); fitCamera(); renderPanel(); renderLegend();
        if (state.selected && posMap[state.selected]) highlight(state.selected, false);
      }

      function fitCamera() {
        var pts = Object.keys(posMap).map(function (k) { return posMap[k]; }); if (!pts.length) return;
        var box = new THREE.Box3(); pts.forEach(function (p) { box.expandByPoint(p); });
        var c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
        var r = Math.max(sz.x, sz.z, sz.y) * 0.9 + 10;
        camera.position.set(c.x + r * 0.7, c.y + r * 0.75, c.z + r * 0.95); controls.target.copy(c); controls.update();
      }
      function applyDim() {
        if (!inst) return; var col = new THREE.Color();
        deviceList.forEach(function (d, i) {
          var ls = kit.linksOf(d.id), hasBroken = ls.some(function (l) { return l.up < l.count; });
          col.setHex(d.drained ? 0xa855f7 : (tiersColor[d.tier] || 0x94a3b8));
          if (state.onlyBroken && !hasBroken && !d.drained) col.multiplyScalar(0.18);
          if (state.selected === d.id) col.setHex(0xffffff);
          inst.setColorAt(i, col);
        });
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        if (linkLines) linkLines.material.opacity = state.onlyBroken ? 0.1 : 0.75;
      }
      function renderLegend() {
        var sites = visibleSites();
        var visLinks = linkData, broken = visLinks.filter(function (l) { return l.up < l.count; }).length, part = visLinks.filter(function (l) { return l.up > 0 && l.up < l.count; }).length, full = visLinks.filter(function (l) { return l.up === 0; }).length;
        var drained = deviceList.filter(function (d) { return d.drained; }).length;
        legendDiv.innerHTML = '<b style="color:#fff">Legend</b><br>'
          + '<span class="pg-site-sw" style="background:#38bdf8"></span>Super-spine &nbsp;<span class="pg-site-sw" style="background:#a78bfa"></span>Border<br>'
          + '<span class="pg-site-sw" style="background:#facc15"></span>Backbone &nbsp;<span class="pg-site-sw" style="background:#64748b"></span>Spine (faint)<br>'
          + '<span class="pg-site-sw" style="background:#2f6f4f"></span>Healthy link<br><span class="pg-site-sw" style="background:#ffaa00"></span>Partly broken link<br>'
          + '<span class="pg-site-sw" style="background:#ff2222"></span>Fully broken link<br><span class="pg-site-sw" style="background:#a855f7"></span>Drained device<br>'
          + '<span style="color:#334155">□</span> Empty slot<br><hr style="border-color:#334155">'
          + 'Broken links: ' + broken + '<br>Partly broken: ' + part + '<br>Fully broken: ' + full + '<br>Drained: ' + drained + '<br>Devices shown: ' + deviceList.length;
      }
      function renderPanel() {
        var sites = visibleSites();
        var rows = model.devices.filter(function (d) { return sites.indexOf(d.site) >= 0 && (d.tier === 'super_spine' || d.tier === 'border'); }).map(function (d) { var s = statsFor(d, kit); return { id: d.id, site: d.site, plane: d.plane == null ? '' : d.plane, links: s.links, broken: s.broken, down: s.down, drained: d.drained ? 'yes' : 'no', _d: d }; });
        if (state.onlyBroken) rows = rows.filter(function (r) { return r.broken > 0 || r._d.drained; });
        rows.sort(function (a, b) { var k = state.sortKey, va = a[k], vb = b[k]; if (typeof va === 'number') return (va - vb) * state.sortDir; return String(va).localeCompare(String(vb)) * state.sortDir; });
        // plane table
        var pmap = {};
        rows; // keep
        var allSS = model.devices.filter(function (d) { return sites.indexOf(d.site) >= 0 && d.tier === 'super_spine'; });
        allSS.forEach(function (d) { var key = d.site + '|' + d.plane; if (!pmap[key]) pmap[key] = { plane: (sites.length > 1 ? d.site + ' P' : 'P') + d.plane, count: 0, broken: 0, _k: key }; pmap[key].count++; pmap[key].broken += statsFor(d, kit).broken; });
        var prows = Object.values(pmap); prows.sort(function (a, b) { var k = state.planeSortKey, va = a[k], vb = b[k]; if (typeof va === 'number') return (va - vb) * state.planeSortDir; return String(va).localeCompare(String(vb)) * state.planeSortDir; });
        function arrow(k, cur, dir) { return cur === k ? (dir > 0 ? ' ▲' : ' ▼') : ''; }
        var cols = [['id', 'ID'], ['site', 'Site'], ['plane', 'Plane'], ['links', 'Links'], ['broken', 'Broken'], ['down', 'Down lanes'], ['drained', 'Drained']];
        panelDiv.innerHTML = '<label class="pg-site-check"><input type="checkbox" id="pg-site-only" ' + (state.onlyBroken ? 'checked' : '') + '> Show only broken</label>'
          + '<h3>Super-spines &amp; border routers (' + rows.length + ')</h3><table><thead><tr>' + cols.map(function (c) { return '<th data-k="' + c[0] + '">' + c[1] + arrow(c[0], state.sortKey, state.sortDir) + '</th>'; }).join('') + '</tr></thead><tbody>'
          + rows.map(function (r) { return '<tr data-id="' + r.id + '" class="' + (state.selected === r.id ? 'pg-site-sel' : '') + '"><td>' + r.id + '</td><td>' + r.site + '</td><td>' + r.plane + '</td><td>' + r.links + '</td><td>' + r.broken + '</td><td>' + r.down + '</td><td>' + r.drained + '</td></tr>'; }).join('') + '</tbody></table>'
          + '<h3>Per plane</h3><table><thead><tr><th data-pk="plane">Plane' + arrow('plane', state.planeSortKey, state.planeSortDir) + '</th><th data-pk="count">Super-spines' + arrow('count', state.planeSortKey, state.planeSortDir) + '</th><th data-pk="broken">Broken links' + arrow('broken', state.planeSortKey, state.planeSortDir) + '</th></tr></thead><tbody>'
          + prows.map(function (r) { return '<tr><td>' + r.plane + '</td><td>' + r.count + '</td><td>' + r.broken + '</td></tr>'; }).join('') + '</tbody></table>'
          + '<p style="font-size:11px;color:#94a3b8">Click a row to select. Click headers to sort. Drag to orbit, scroll to zoom.</p>';
        panelDiv.querySelector('#pg-site-only').onchange = function (e) { state.onlyBroken = e.target.checked; applyDim(); renderPanel(); };
        panelDiv.querySelectorAll('th[data-k]').forEach(function (th) { th.onclick = function () { var k = th.getAttribute('data-k'); if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = 1; } renderPanel(); }; });
        panelDiv.querySelectorAll('th[data-pk]').forEach(function (th) { th.onclick = function () { var k = th.getAttribute('data-pk'); if (state.planeSortKey === k) state.planeSortDir *= -1; else { state.planeSortKey = k; state.planeSortDir = 1; } renderPanel(); }; });
        panelDiv.querySelectorAll('tr[data-id]').forEach(function (tr) { tr.onclick = function () { kit.select(tr.getAttribute('data-id')); }; });
      }
      function highlight(id, focus) {
        state.selected = id;
        if (ring && posMap[id]) { ring.position.copy(posMap[id]); ring.visible = true; }
        applyDim(); renderPanel();
        if (focus && posMap[id]) { controls.target.copy(posMap[id]); }
      }

      // interaction
      function pick(ev) {
        var r = renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        ray.setFromCamera(mouse, camera);
        if (!inst) return null; var hits = ray.intersectObject(inst); return hits.length ? hits[0] : null;
      }
      renderer.domElement.addEventListener('pointermove', function (ev) {
        var hit = pick(ev); if (!hit || hit.instanceId == null) { tip.style.display = 'none'; return; }
        var d = deviceList[hit.instanceId]; if (!d) return; var s = statsFor(d, kit);
        tip.innerHTML = '<b>' + d.id + '</b><br>Tier: ' + d.tier + ' · Site: ' + d.site + (d.plane != null ? ' · Plane ' + d.plane : '') + (d.pod != null ? ' · Pod ' + d.pod : '') + '<br>Links: ' + s.links + ' · Broken: ' + s.broken + ' · Down lanes: ' + s.down + '<br>' + (d.drained ? 'Drained' : 'In service');
        tip.style.display = 'block'; tip.style.left = (ev.clientX - wrap.getBoundingClientRect().left + 14) + 'px'; tip.style.top = (ev.clientY - wrap.getBoundingClientRect().top + 12) + 'px';
      });
      renderer.domElement.addEventListener('pointerleave', function () { tip.style.display = 'none'; });
      renderer.domElement.addEventListener('click', function (ev) { var hit = pick(ev); if (hit && hit.instanceId != null && deviceList[hit.instanceId]) kit.select(deviceList[hit.instanceId].id); });

      kit.onSelect(function (id) {
        if (!id) return; var d = kit.device(id); if (!d) return;
        if (state.site !== 'all' && d.site && d.site !== state.site) { state.site = d.site; renderTop(); build(); }
        highlight(id, true);
      });

      var onResize = function () { var w = W(), h = H(); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
      window.addEventListener('resize', onResize);
      S = { raf: 0, renderer: renderer, onResize: onResize };
      (function loop() {
        S.raf = requestAnimationFrame(loop);
        var t = (performance.now() - clockStart) / 1000;
        if (brokenCyl) brokenCyl.material.color.setHSL(0, 0.9, 0.45 + 0.15 * Math.sin(t * 4));
        if (ring && ring.visible) { var s = 1 + 0.06 * Math.sin(t * 3); ring.scale.set(s, s, s); }
        controls.update(); renderer.render(scene, camera);
      })();
      renderTop(); build();
      if (kit.selected) { var sd = kit.device(kit.selected); if (sd) { if (sd.site !== state.site) { state.site = sd.site; renderTop(); build(); } highlight(kit.selected, false); } }
    }
  };
});
