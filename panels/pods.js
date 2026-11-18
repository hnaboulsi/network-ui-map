kit.page('pods', function () {
  var cleanup = null;
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function sortKey(v) { return v == null ? '' : v; }
  return {
    mount: function (el, model, kit) {
      if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
      el.innerHTML = '';
      var P = 'pg-pods-';
      var style = document.createElement('style');
      style.textContent = [
        '.' + P + 'wrap{position:relative;width:100%;height:100%;min-height:520px;background:#0b0f17;color:#e6edf3;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden}',
        '.' + P + 'canvas{position:absolute;inset:0}',
        '.' + P + 'canvas canvas{display:block}',
        '.' + P + 'top{position:absolute;left:10px;top:10px;z-index:5;display:flex;flex-wrap:wrap;gap:6px;max-width:55%}',
        '.' + P + 'btn{background:#162033;color:#c9d6e3;border:1px solid #2a3a52;border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer}',
        '.' + P + 'btn.on{background:#2563eb;color:#fff;border-color:#2563eb}',
        '.' + P + 'legend{position:absolute;left:10px;bottom:10px;z-index:5;background:rgba(10,15,26,.88);border:1px solid #24344d;border-radius:10px;padding:9px 11px;font-size:12px;line-height:1.75;pointer-events:none}',
        '.' + P + 'sw{display:inline-block;width:18px;height:4px;border-radius:2px;vertical-align:middle;margin-right:7px}',
        '.' + P + 'dot{display:inline-block;width:10px;height:10px;border-radius:3px;vertical-align:middle;margin-right:7px}',
        '.' + P + 'side{position:absolute;right:10px;top:10px;bottom:10px;width:400px;max-width:46%;z-index:6;background:rgba(10,15,26,.92);border:1px solid #24344d;border-radius:12px;padding:10px;overflow-y:auto;overflow-x:hidden;box-sizing:border-box}',
        '.' + P + 'side h3{margin:8px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9fb3c8}',
        '.' + P + 'side table{width:100%;border-collapse:collapse;font-size:11px}',
        '.' + P + 'side th{position:sticky;top:0;background:#142038;color:#dbe7f3;text-align:left;padding:5px 4px;cursor:pointer;white-space:nowrap;user-select:none}',
        '.' + P + 'side td{padding:4px;border-top:1px solid #1c2a42;white-space:nowrap}',
        '.' + P + 'side tr[data-id]{cursor:pointer}',
        '.' + P + 'side tr[data-id]:hover td{background:#16263f}',
        '.' + P + 'side tr.sel td{background:#1d3558}',
        '.' + P + 'chk{display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;background:#111c2e;border:1px solid #24344d;border-radius:8px;padding:7px 9px}',
        '.' + P + 'tip{position:absolute;z-index:9;pointer-events:none;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:7px 9px;font-size:12px;display:none;max-width:280px;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
        '.' + P + 'empty{color:#64748b;font-size:12px;padding:6px 0}'
      ].join('\n');
      el.appendChild(style);

      var wrap = document.createElement('div'); wrap.className = P + 'wrap'; el.appendChild(wrap);
      var canvasHost = document.createElement('div'); canvasHost.className = P + 'canvas'; wrap.appendChild(canvasHost);
      var topBar = document.createElement('div'); topBar.className = P + 'top'; wrap.appendChild(topBar);
      var legend = document.createElement('div'); legend.className = P + 'legend'; wrap.appendChild(legend);
      var side = document.createElement('div'); side.className = P + 'side'; wrap.appendChild(side);
      var tip = document.createElement('div'); tip.className = P + 'tip'; wrap.appendChild(tip);

      // ---------- data prep ----------
      var allSpines = model.devices.filter(function (d) { return d.tier === 'spine'; });
      var allSupers = model.devices.filter(function (d) { return d.tier === 'super_spine'; });
      function statsFor(d) {
        var ups = [];
        try { ups = kit.uplinks(d.id) || []; } catch (e) { ups = []; }
        var broken = 0, down = 0;
        ups.forEach(function (l) { if (l.up < l.count) broken++; down += (l.count - l.up); });
        return { uplinks: ups.length, broken: broken, down: down, links: ups };
      }
      var spineStats = new Map();
      allSpines.forEach(function (d) { spineStats.set(d.id, statsFor(d)); });

      var siteCodes = model.sites.map(function (s) { return s.code; });
      var currentSite = siteCodes.length ? siteCodes[0] : 'ALL';
      var onlyBroken = false;
      var selectedId = kit.selected || null;
      var sortSpine = { key: 'id', dir: 1 };
      var sortPod = { key: 'pod', dir: 1 };

      // ---------- three ----------
      var W = Math.max(320, el.clientWidth || 900), H = Math.max(320, el.clientHeight || 600);
      var renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H);
      renderer.setClearColor(0x0b0f17, 1);
      canvasHost.appendChild(renderer.domElement);
      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0f17);
      scene.fog = new THREE.Fog(0x0b0f17, 120, 260);
      var camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
      var controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      var dl = new THREE.DirectionalLight(0xffffff, 1.1); dl.position.set(30, 50, 30); scene.add(dl);
      var grid = new THREE.GridHelper(140, 70, 0x1e3a5f, 0x14243c); grid.position.y = -0.05; scene.add(grid);

      var raycaster = new THREE.Raycaster();
      var mouse = new THREE.Vector2();
      var instSpine = null, instSuper = null, lineSeg = null, labelGroup = null, emptyMesh = null;
      var posById = new Map(), devById = new Map(), spineList = [], superList = [], linkList = [];
      model.devices.forEach(function (d) { devById.set(d.id, d); });
      var hoveredId = null, raf = 0, disposed = false;
      var tierColor = { spine: new THREE.Color(0x38bdf8), super_spine: new THREE.Color(0xa78bfa) };
      var drainedColor = new THREE.Color(0xd946ef), dimColor = new THREE.Color(0x334155);

      function visibleDevices() {
        var sp = currentSite === 'ALL' ? allSpines : allSpines.filter(function (d) { return d.site === currentSite; });
        var su = currentSite === 'ALL' ? allSupers : allSupers.filter(function (d) { return d.site === currentSite; });
        return { spines: sp, supers: su };
      }
      function makeLabel(text, scale) {
        var c = document.createElement('canvas'); c.width = 256; c.height = 64;
        var g = c.getContext('2d'); g.fillStyle = 'rgba(11,15,23,0.65)'; g.fillRect(0, 0, 256, 64);
        g.font = 'bold 26px system-ui,sans-serif'; g.fillStyle = '#e6edf3'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 32);
        var tex = new THREE.CanvasTexture(c);
        var m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
        var s = new THREE.Sprite(m); s.scale.set(6 * (scale || 1), 1.5 * (scale || 1), 1); return s;
      }
      function linkStatus(l) { return l.up === l.count ? 0 : (l.up === 0 ? 2 : 1); }

      function rebuild() {
        // dispose old
        [instSpine, instSuper, emptyMesh].forEach(function (m) { if (m) { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); } });
        if (lineSeg) { scene.remove(lineSeg); lineSeg.geometry.dispose(); lineSeg.material.dispose(); lineSeg = null; }
        if (labelGroup) { scene.remove(labelGroup); labelGroup.traverse(function (o) { if (o.material && o.material.map) o.material.map.dispose(); if (o.material) o.material.dispose(); }); }
        instSpine = instSuper = emptyMesh = null; labelGroup = new THREE.Group(); scene.add(labelGroup);
        posById.clear();
        var vis = visibleDevices(); spineList = vis.spines; superList = vis.supers;
        var pods = Array.from(new Set(spineList.map(function (d) { return String(d.pod); }))).sort(function (a, b) { return cmp(sortKey(a), sortKey(b)) || cmp(a, b); });
        var planes = Array.from(new Set(spineList.concat(superList).map(function (d) { return String(d.plane); }))).sort(function (a, b) { return cmp(sortKey(a), sortKey(b)) || cmp(a, b); });
        // group spines
        var groups = new Map();
        spineList.forEach(function (d) { var k = String(d.pod) + '|' + String(d.plane); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); });
        groups.forEach(function (arr) { arr.sort(function (a, b) { return cmp(a.id, b.id); }); });
        var maxPerGroup = 1; groups.forEach(function (arr) { maxPerGroup = Math.max(maxPerGroup, arr.length); });
        var podGap = 7, planeGap = 2.6, yGap = 1.7;
        var totalW = Math.max(1, pods.length) * podGap, totalD = Math.max(1, planes.length) * planeGap;
        var maxY = maxPerGroup * yGap + 1;
        spineList.forEach(function (d) {
          var pi = pods.indexOf(String(d.pod)), pli = planes.indexOf(String(d.plane));
          var arr = groups.get(String(d.pod) + '|' + String(d.plane)), idx = arr.indexOf(d);
          posById.set(d.id, new THREE.Vector3(pi * podGap - totalW / 2 + podGap / 2, 0.9 + idx * yGap, pli * planeGap - totalD / 2 + planeGap / 2));
        });
        // supers above, grouped by plane, spread along x
        var superByPlane = new Map();
        superList.forEach(function (d) { var k = String(d.plane); if (!superByPlane.has(k)) superByPlane.set(k, []); superByPlane.get(k).push(d); });
        superByPlane.forEach(function (arr) { arr.sort(function (a, b) { return cmp(a.id, b.id); }); });
        var superY = maxY + 5;
        superList.forEach(function (d) {
          var pli = planes.indexOf(String(d.plane)); var arr = superByPlane.get(String(d.plane)); var idx = arr.indexOf(d);
          var x = arr.length <= 1 ? 0 : (idx / (arr.length - 1) - 0.5) * (totalW * 0.9);
          posById.set(d.id, new THREE.Vector3(x, superY, pli * planeGap - totalD / 2 + planeGap / 2));
        });
        // instanced boxes
        function buildInst(list, isSuper) {
          if (!list.length) return null;
          var geo = new THREE.BoxGeometry(isSuper ? 1.5 : 1.25, 0.95, 1.25);
          var mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, vertexColors: false });
          var im = new THREE.InstancedMesh(geo, mat, list.length);
          var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
          list.forEach(function (d, i) { var p = posById.get(d.id); m4.compose(p, q, sc); im.setMatrixAt(i, m4); im.setColorAt(i, d.drained ? drainedColor : tierColor[d.tier]); });
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.userData.ids = list.map(function (d) { return d.id; });
          scene.add(im); return im;
        }
        instSpine = buildInst(spineList, false);
        instSuper = buildInst(superList, true);
        // empty slots: pod x plane cells with fewer than maxPerGroup
        var empties = [];
        pods.forEach(function (pod) { planes.forEach(function (pl) { var arr = groups.get(pod + '|' + pl) || []; for (var i = arr.length; i < maxPerGroup; i++) empties.push({ pod: pod, plane: pl, idx: i }); }); });
        if (empties.length) {
          var eg = new THREE.BoxGeometry(1.25, 0.95, 1.25);
          var em = new THREE.MeshBasicMaterial({ color: 0x334155, wireframe: true, transparent: true, opacity: 0.35 });
          emptyMesh = new THREE.InstancedMesh(eg, em, empties.length);
          var m4e = new THREE.Matrix4();
          empties.forEach(function (e, i) { var pi = pods.indexOf(e.pod), pli = planes.indexOf(e.plane); m4e.makeTranslation(pi * podGap - totalW / 2 + podGap / 2, 0.9 + e.idx * yGap, pli * planeGap - totalD / 2 + planeGap / 2); emptyMesh.setMatrixAt(i, m4e); });
          scene.add(emptyMesh);
        }
        // labels
        pods.forEach(function (pod) { var pi = pods.indexOf(pod); var s = makeLabel(pod, 1); s.position.set(pi * podGap - totalW / 2 + podGap / 2, -0.9, totalD / 2 + 1.6); labelGroup.add(s); });
        planes.forEach(function (pl) { var pli = planes.indexOf(pl); var s = makeLabel('plane ' + pl, 0.75); s.position.set(-totalW / 2 - 3.2, superY, pli * planeGap - totalD / 2 + planeGap / 2); labelGroup.add(s); });
        var sl = makeLabel('super-spines', 0.9); sl.position.set(0, superY + 1.6, -totalD / 2 - 1.4); labelGroup.add(sl);
        // links spine->super
        linkList = [];
        spineList.forEach(function (d) { (spineStats.get(d.id) || { links: [] }).links.forEach(function (l) { var other = l.a === d.id ? l.b : l.a; if (posById.has(d.id) && posById.has(other)) linkList.push({ link: l, from: d.id, to: other }); }); });
        var positions = new Float32Array(linkList.length * 6), colors = new Float32Array(linkList.length * 6);
        linkList.forEach(function (it, i) {
          var a = posById.get(it.from), b = posById.get(it.to);
          positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
          var st = linkStatus(it.link), col = st === 0 ? new THREE.Color(0x2f7d5a) : st === 1 ? new THREE.Color(0xf59e0b) : new THREE.Color(0xef4444);
          if (onlyBroken && st === 0) col = new THREE.Color(0x162033);
          colors.set([col.r, col.g, col.b, col.r, col.g, col.b], i * 6);
        });
        var lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        lg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        lineSeg = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
        scene.add(lineSeg);
        applyDim(); updateLegend(); renderTables(); fitCamera();
      }
      function applyDim() {
        [[instSpine, spineList], [instSuper, superList]].forEach(function (pair) {
          var im = pair[0], list = pair[1]; if (!im) return;
          list.forEach(function (d, i) {
            var base = d.drained ? drainedColor : tierColor[d.tier];
            var isBrokenDev = false;
            if (d.tier === 'spine') { var s = spineStats.get(d.id); isBrokenDev = s && s.broken > 0; }
            else { // super: broken if any incident link broken
              var ls = []; try { ls = kit.linksOf(d.id); } catch (e) {} isBrokenDev = ls.some(function (l) { return l.up < l.count; });
            }
            var c = base;
            if (onlyBroken && !isBrokenDev && !d.drained) c = dimColor;
            if (d.id === selectedId) c = new THREE.Color(0xffffff);
            else if (d.id === hoveredId) c = base.clone().lerp(new THREE.Color(0xffffff), 0.45);
            im.setColorAt(i, c);
          });
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
        });
        if (lineSeg) { // rebuild colors for filter
          var colors = lineSeg.geometry.getAttribute('color');
          linkList.forEach(function (it, i) { var st = linkStatus(it.link); var col = st === 0 ? (onlyBroken ? new THREE.Color(0x111827) : new THREE.Color(0x2f7d5a)) : st === 1 ? new THREE.Color(0xf59e0b) : new THREE.Color(0xef4444); colors.setXYZ(i * 2, col.r, col.g, col.b); colors.setXYZ(i * 2 + 1, col.r, col.g, col.b); });
          colors.needsUpdate = true;
          lineSeg.material.opacity = onlyBroken ? 1 : 0.92;
        }
      }
      function fitCamera() {
        var pts = Array.from(posById.values()); if (!pts.length) { camera.position.set(20, 18, 28); controls.target.set(0, 3, 0); return; }
        var box = new THREE.Box3(); pts.forEach(function (p) { box.expandByPoint(p); });
        var center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        var radius = Math.max(size.x, size.y, size.z) * 0.72 + 6;
        var fov = camera.fov * Math.PI / 180;
        var dist = radius / Math.sin(fov / 2) * 1.05;
        camera.position.set(center.x + dist * 0.55, center.y + dist * 0.5, center.z + dist * 0.75);
        camera.near = Math.max(0.1, dist / 100); camera.far = dist * 8; camera.updateProjectionMatrix();
        controls.target.copy(center); controls.update();
      }
      function focusDevice(id) {
        var p = posById.get(id); if (!p) return;
        controls.target.copy(p);
        var dir = camera.position.clone().sub(controls.target).normalize().multiplyScalar(14);
        camera.position.copy(p.clone().add(dir).add(new THREE.Vector3(0, 4, 0))); controls.update();
      }
      // ---------- legend + totals ----------
      function updateLegend() {
        var broken = 0, partly = 0, fully = 0;
        linkList.forEach(function (it) { var st = linkStatus(it.link); if (st === 1) { partly++; broken++; } if (st === 2) { fully++; broken++; } });
        var drained = spineList.filter(function (d) { return d.drained; }).length + superList.filter(function (d) { return d.drained; }).length;
        legend.innerHTML = '<div><span class="' + P + 'sw" style="background:#2f7d5a"></span>Healthy link</div>'
          + '<div><span class="' + P + 'sw" style="background:#f59e0b"></span>Partly broken link</div>'
          + '<div><span class="' + P + 'sw" style="background:#ef4444"></span>Fully broken link</div>'
          + '<div><span class="' + P + 'dot" style="background:#38bdf8"></span>Spine &nbsp;<span class="' + P + 'dot" style="background:#a78bfa"></span>Super-spine</div>'
          + '<div><span class="' + P + 'dot" style="background:#d946ef"></span>Drained device</div>'
          + '<div><span class="' + P + 'dot" style="background:transparent;border:1px solid #475569"></span>Empty slot</div>'
          + '<div style="margin-top:5px;color:#cbd5e1">Broken links: ' + broken + ' &middot; Partly broken: ' + partly + ' &middot; Fully broken: ' + fully + ' &middot; Drained: ' + drained + '</div>';
      }
      // ---------- side tables ----------
      function sortedRows(rows, sort) {
        return rows.slice().sort(function (a, b) { var av = sortKey(a[sort.key]), bv = sortKey(b[sort.key]); var c = (typeof av === 'number' && typeof bv === 'number') ? av - bv : cmp(String(av), String(bv)); return c * sort.dir; });
      }
      function th(label, key, sort, onSort) {
        var arrow = sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
        return '<th data-k="' + key + '">' + label + arrow + '</th>';
      }
      function renderTables() {
        var vis = visibleDevices();
        var rows = vis.spines.map(function (d) { var s = spineStats.get(d.id); return { id: d.id, site: d.site, pod: sortKey(d.pod), plane: sortKey(d.plane), uplinks: s.uplinks, broken: s.broken, down: s.down, drained: d.drained ? 'yes' : 'no', _d: d }; });
        if (onlyBroken) rows = rows.filter(function (r) { return r.broken > 0 || r._d.drained; });
        rows = sortedRows(rows, sortSpine);
        // per-pod
        var podMap = new Map();
        vis.spines.forEach(function (d) { var k = d.site + '|' + String(d.pod); if (!podMap.has(k)) podMap.set(k, { site: d.site, pod: sortKey(d.pod), spines: 0, broken: 0 }); var o = podMap.get(k); o.spines++; o.broken += spineStats.get(d.id).broken; });
        var podRows = Array.from(podMap.values());
        if (onlyBroken) podRows = podRows.filter(function (r) { return r.broken > 0; });
        podRows = sortedRows(podRows, sortPod);
        var h = '<label class="' + P + 'chk"><input type="checkbox" id="' + P + 'only" ' + (onlyBroken ? 'checked' : '') + '> Show only broken</label>';
        h += '<h3>Spines (' + rows.length + ')</h3><table><thead><tr>'
          + th('id', 'id', sortSpine) + th('site', 'site', sortSpine) + th('pod', 'pod', sortSpine) + th('plane', 'plane', sortSpine) + th('uplinks', 'uplinks', sortSpine) + th('broken uplinks', 'broken', sortSpine) + th('down lanes', 'down', sortSpine) + th('drained', 'drained', sortSpine)
          + '</tr></thead><tbody>';
        if (!rows.length) h += '<tr><td colspan="8" class="' + P + 'empty">No rows</td></tr>';
        rows.forEach(function (r) { h += '<tr data-id="' + r.id + '" class="' + (r.id === selectedId ? 'sel' : '') + '"><td>' + r.id + '</td><td>' + r.site + '</td><td>' + r.pod + '</td><td>' + r.plane + '</td><td>' + r.uplinks + '</td><td>' + r.broken + '</td><td>' + r.down + '</td><td>' + r.drained + '</td></tr>'; });
        h += '</tbody></table><h3>Per pod (' + podRows.length + ')</h3><table><thead><tr>'
          + th('site', 'site', sortPod) + th('pod', 'pod', sortPod) + th('spines', 'spines', sortPod) + th('broken uplinks', 'broken', sortPod) + '</tr></thead><tbody>';
        if (!podRows.length) h += '<tr><td colspan="4" class="' + P + 'empty">No rows</td></tr>';
        podRows.forEach(function (r) { h += '<tr><td>' + r.site + '</td><td>' + r.pod + '</td><td>' + r.spines + '</td><td>' + r.broken + '</td></tr>'; });
        h += '</tbody></table>';
        side.innerHTML = h;
        var chk = side.querySelector('#' + P + 'only');
        if (chk) chk.addEventListener('change', function () { onlyBroken = chk.checked; applyDim(); renderTables(); });
        // header sorting: first table = spine, second = pod
        var tables = side.querySelectorAll('table');
        if (tables[0]) tables[0].querySelectorAll('th').forEach(function (node) { node.addEventListener('click', function () { var k = node.getAttribute('data-k'); if (sortSpine.key === k) sortSpine.dir *= -1; else { sortSpine.key = k; sortSpine.dir = 1; } renderTables(); }); });
        if (tables[1]) tables[1].querySelectorAll('th').forEach(function (node) { node.addEventListener('click', function () { var k = node.getAttribute('data-k'); if (sortPod.key === k) sortPod.dir *= -1; else { sortPod.key = k; sortPod.dir = 1; } renderTables(); }); });
        side.querySelectorAll('tr[data-id]').forEach(function (tr) { tr.addEventListener('click', function () { kit.select(tr.getAttribute('data-id')); }); });
      }
      // ---------- site buttons ----------
      function renderSiteButtons() {
        topBar.innerHTML = '';
        var mk = function (label, code) { var b = document.createElement('button'); b.className = P + 'btn' + (currentSite === code ? ' on' : ''); b.textContent = label; b.addEventListener('click', function () { currentSite = code; renderSiteButtons(); rebuild(); }); topBar.appendChild(b); };
        siteCodes.forEach(function (c) { var s = model.sites.find(function (x) { return x.code === c; }); mk((s ? s.name : c) + ' (' + c + ')', c); });
        mk('All sites', 'ALL');
      }
      // ---------- interaction ----------
      function pick(ev) {
        var r = renderer.domElement.getBoundingClientRect();
        mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        var hits = [];
        if (instSpine) hits = hits.concat(raycaster.intersectObject(instSpine));
        if (instSuper) hits = hits.concat(raycaster.intersectObject(instSuper));
        if (!hits.length) return null;
        hits.sort(function (a, b) { return a.distance - b.distance; });
        var h = hits[0]; return h.object.userData.ids[h.instanceId];
      }
      function onMove(ev) {
        var id = pick(ev);
        hoveredId = id;
        if (id) {
          var d = devById.get(id); var s = d.tier === 'spine' ? spineStats.get(id) : null;
          var ls = []; try { ls = kit.linksOf(id); } catch (e) {}
          var brokenLs = ls.filter(function (l) { return l.up < l.count; }).length;
          tip.innerHTML = '<b>' + id + '</b><br>tier: ' + d.tier + ' &middot; site: ' + d.site + (d.pod != null ? ' &middot; pod: ' + d.pod : '') + (d.plane != null ? ' &middot; plane: ' + d.plane : '')
            + '<br>links: ' + ls.length + ' &middot; broken links: ' + brokenLs + (s ? '<br>uplinks: ' + s.uplinks + ' &middot; broken uplinks: ' + s.broken + ' &middot; down lanes: ' + s.down : '') + (d.drained ? '<br>drained: yes' : '');
          tip.style.display = 'block';
          var r = wrap.getBoundingClientRect(); tip.style.left = (ev.clientX - r.left + 14) + 'px'; tip.style.top = (ev.clientY - r.top + 10) + 'px';
          renderer.domElement.style.cursor = 'pointer';
        } else { tip.style.display = 'none'; renderer.domElement.style.cursor = 'grab'; }
        applyDim();
      }
      function onClick(ev) { var id = pick(ev); if (id) kit.select(id); }
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('click', onClick);
      kit.onSelect(function (id) {
        selectedId = id;
        var d = id ? devById.get(id) : null;
        if (d && currentSite !== 'ALL' && d.site !== currentSite) { currentSite = d.site; renderSiteButtons(); rebuild(); }
        applyDim(); renderTables();
        if (id && posById.has(id)) focusDevice(id);
        else if (id && d) { /* device not on this page (e.g. ToR): rebuild already handled site switch if needed */ if (!posById.has(id)) { /* try after rebuild */ if (posById.has(id)) focusDevice(id); } }
      });
      function onResize() {
        var w = Math.max(320, el.clientWidth || wrap.clientWidth || 900), h = Math.max(320, el.clientHeight || wrap.clientHeight || 600);
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      }
      window.addEventListener('resize', onResize);
      function animate() { if (disposed) return; raf = requestAnimationFrame(animate); var t = performance.now() * 0.004; if (lineSeg) lineSeg.material.opacity = 0.82 + Math.sin(t) * 0.13; controls.update(); renderer.render(scene, camera); }
      renderSiteButtons(); rebuild();
      if (selectedId && devById.has(selectedId)) { var sd = devById.get(selectedId); if (currentSite !== 'ALL' && sd.site !== currentSite) { currentSite = sd.site; renderSiteButtons(); rebuild(); } if (posById.has(selectedId)) { applyDim(); focusDevice(selectedId); } }
      animate();
      cleanup = function () {
        disposed = true; cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('click', onClick);
        controls.dispose(); renderer.dispose();
        scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
      this._pgPodsCleanup = cleanup;
    },
    resize: function () { window.dispatchEvent(new Event('resize')); }
  };
});
