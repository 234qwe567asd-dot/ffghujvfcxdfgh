(function () {
"use strict";

/* ================= 常數與小工具 ================= */
const CFG = window.APP_CONFIG || {};
const BUCKET = "submissions";
const DOW = ["日", "一", "二", "三", "四", "五", "六"];
const KINDS = { o: "正式賽", m: "模擬賽", c: "自製模擬題" };
const KIND_ORDER = { o: 0, m: 1, c: 2 };
const FMTS = ["docx", "pdf"];
const FMT_LABEL = { docx: "DOCX", pdf: "PDF" };
const MAXFILE = 20 * 1048576;
const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
const ACCEPT = { pdf: ".pdf," + MIME.pdf, docx: ".docx," + MIME.docx };

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseD = s => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const today0 = ymd(new Date());
const S = {
  sb: null, uid: null, profile: null, isAdmin: false, ready: false, recovery: false,
  today: today0, sel: today0, vy: new Date().getFullYear(), vm: new Date().getMonth(),
  plans: [], plansLoaded: false, pbusy: {},
  sets: [], items: {}, bankSel: null, bankPicked: false, pending: {}, busy: {}, errs: {},
  admin: {
    profiles: [], subs: [], loaded: false, loading: false, q: "",
    detailUid: null, sel: null, editId: null, confirmDel: null, tidy: null, busy: false
  }
};

let toastT = null;
function toast(msg) {
  $("toastMsg").textContent = msg;
  const t = $("toast"); t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 4500);
}
function fmtSize(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
function fmtTime(ts) {
  const d = new Date(ts);
  const y = d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + "/" : "";
  return y + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function humanErr(e) {
  const m = String((e && (e.message || e.error_description)) || e || "");
  if (/Invalid login credentials/i.test(m)) return "信箱或密碼不正確。";
  if (/Email not confirmed/i.test(m)) return "這個信箱還沒確認，請到信箱點確認連結後再登入。";
  if (/already registered|already been registered/i.test(m)) return "這個信箱已經註冊過了，請直接登入。";
  if (/Password should be at least|at least 6/i.test(m)) return "密碼至少需要 6 個字元。";
  if (/valid email|invalid format|Unable to validate email/i.test(m)) return "電子信箱格式不正確。";
  if (/rate limit|too many|over_email_send_rate_limit/i.test(m)) return "操作太頻繁，請稍等幾分鐘再試。";
  if (/exceeded the maximum allowed size|too large|Payload too large/i.test(m)) return "檔案太大。";
  if (/mime type|not supported|invalid_mime_type/i.test(m)) return "這種檔案格式不被接受。";
  if (/foreign key/i.test(m)) return "這份題目已經有繳交，不能刪除，只能隱藏。";
  if (/duplicate key|unique constraint|exam_sets_year_kind_uq/i.test(m)) return "這個年度已經有這種題目了。";
  if (/row-level security|violates row-level|not authorized|permission/i.test(m)) return "沒有權限做這個動作，或這份題目已被隱藏。";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "網路不穩，請稍後再試。";
  return "發生錯誤，請稍後再試。";
}
function must(r) { if (r && r.error) throw r.error; return r ? r.data : null; }

/* ================= 資料存取層（全部集中在這裡） ================= */
// Supabase 一次最多回傳 1000 筆，所以清單都用分頁讀完。
async function fetchAll(build) {
  const PAGE = 1000, out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await build(from, from + PAGE - 1)) || [];
    for (let i = 0; i < rows.length; i++) out.push(rows[i]);
    if (rows.length < PAGE) break;
  }
  return out;
}
const byCreated = q => q.order("created_at", { ascending: true }).order("id", { ascending: true });
const api = {
  getProfile: uid => S.sb.from("profiles").select("*").eq("id", uid).single().then(must),
  listSets: () => fetchAll((a, b) => byCreated(S.sb.from("exam_sets").select("*")).range(a, b)),
  listPlans: () => fetchAll((a, b) => byCreated(S.sb.from("plans").select("*")).range(a, b)),
  mySubs: uid => fetchAll((a, b) => byCreated(S.sb.from("submissions").select("*").eq("user_id", uid)).range(a, b)),
  addPlan: (date, text) => S.sb.from("plans").insert({ plan_date: date, text: text }).select().single().then(must),
  patchPlan: (id, patch) => S.sb.from("plans").update(patch).eq("id", id).then(must),
  deletePlan: id => S.sb.from("plans").delete().eq("id", id).then(must),
  upload: (path, file, fmt) => S.sb.storage.from(BUCKET).upload(path, file, { contentType: MIME[fmt], upsert: false }).then(must),
  removeFiles: paths => S.sb.storage.from(BUCKET).remove(paths),
  upsertSub: row => S.sb.from("submissions").upsert(row, { onConflict: "user_id,set_id,q,fmt" }).select().single().then(must),
  signedUrl: (path, name) => S.sb.storage.from(BUCKET).createSignedUrl(path, 180, name ? { download: name } : undefined),
  allProfiles: () => fetchAll((a, b) => byCreated(S.sb.from("profiles").select("*")).range(a, b)),
  allSubs: () => fetchAll((a, b) => byCreated(S.sb.from("submissions").select("*")).range(a, b)),
  addSets: rows => S.sb.from("exam_sets").insert(rows).select().then(must),
  patchSet: (id, patch) => S.sb.from("exam_sets").update(patch).eq("id", id).then(must),
  deleteSet: id => S.sb.from("exam_sets").delete().eq("id", id).then(must)
};

/* ================= 畫面切換與登入 ================= */
function showOnly(name) { ["setup", "auth", "main"].forEach(n => { $(n).hidden = n !== name; }); }
let authMode = "login";
function setAuthMode(m) {
  authMode = m;
  $("tabLogin").setAttribute("aria-selected", String(m === "login"));
  $("tabSignup").setAttribute("aria-selected", String(m === "signup"));
  $("nameField").hidden = m !== "signup";
  $("authSubmit").textContent = m === "signup" ? "註冊" : "登入";
  $("authPass").setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
  authNote("");
}
function authNote(msg, good) {
  const n = $("authMsg"); n.textContent = msg || ""; n.hidden = !msg; n.classList.toggle("good", !!good);
}
function recoverNote(msg) { const n = $("recoverMsg"); n.textContent = msg || ""; n.hidden = !msg; }

document.querySelector(".authtabs").addEventListener("click", e => {
  const b = e.target.closest("[data-mode]"); if (b) setAuthMode(b.dataset.mode);
});
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("authEmail").value.trim(), pass = $("authPass").value, name = $("authName").value.trim();
  if (!email || !pass) { authNote("請輸入信箱和密碼。"); return; }
  if (authMode === "signup" && pass.length < 6) { authNote("密碼至少需要 6 個字元。"); return; }
  const btn = $("authSubmit"); btn.disabled = true; authNote("");
  try {
    if (authMode === "signup") {
      const r = await S.sb.auth.signUp({ email: email, password: pass, options: { data: { display_name: name } } });
      if (r.error) throw r.error;
      if (!r.data.session) authNote("已寄出確認信，請到信箱點連結後，再回來登入。", true);
    } else {
      const r = await S.sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw r.error;
    }
  } catch (err) { authNote(humanErr(err)); }
  btn.disabled = false;
});
$("forgotBtn").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();
  if (!email) { authNote("請先在上面輸入你的信箱，再按「忘記密碼」。"); return; }
  try {
    const r = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (r.error) throw r.error;
    authNote("已寄出重設密碼的信，請到信箱點連結。", true);
  } catch (err) { authNote(humanErr(err)); }
});
$("recoverForm").addEventListener("submit", async e => {
  e.preventDefault();
  const p = $("newPass").value;
  if (p.length < 6) { recoverNote("密碼至少需要 6 個字元。"); return; }
  try {
    const r = await S.sb.auth.updateUser({ password: p });
    if (r.error) throw r.error;
    S.recovery = false; $("recoverForm").hidden = true; $("authLoginBox").hidden = false;
    toast("密碼已更新");
    const s = await S.sb.auth.getSession();
    await handleSession(s.data.session, true);
  } catch (err) { recoverNote(humanErr(err)); }
});
$("logoutBtn").addEventListener("click", async () => { await S.sb.auth.signOut(); });

async function handleSession(session, force) {
  if (S.recovery) return;
  if (!session) {
    S.uid = null; S.ready = false; S.profile = null; S.isAdmin = false;
    S.plans = []; S.plansLoaded = false; S.sets = []; S.items = {}; S.pending = {};
    S.admin.loaded = false; S.admin.profiles = []; S.admin.subs = [];
    showOnly("auth"); return;
  }
  if (!force && S.ready && S.uid === session.user.id) return;
  S.uid = session.user.id; S.ready = false;
  showOnly("main");
  $("whoName").textContent = "載入中…";
  try {
    const r = await Promise.all([api.getProfile(S.uid), api.listSets(), api.listPlans(), api.mySubs(S.uid)]);
    S.profile = r[0]; S.isAdmin = r[0].role === "admin";
    S.sets = r[1] || []; S.plans = r[2] || []; S.plansLoaded = true;
    S.items = toItems(r[3] || []);
    S.ready = true;
  } catch (err) {
    showOnly("auth");
    authNote("登入成功，但讀取資料失敗：" + humanErr(err) + " 請確認已執行最新的 schema.sql。");
    return;
  }
  $("whoName").textContent = S.profile.display_name || S.profile.email || "我";
  $("whoTag").hidden = !S.isAdmin;
  $("tab-admin").hidden = !S.isAdmin;
  $("tab-sets").hidden = !S.isAdmin;
  renderCalendar(); renderBank(); route();
}

/* ================= 路由 ================= */
const VIEWS = ["calendar", "bank", "admin", "sets"];
function route() {
  if (!S.ready) return;
  const parts = (location.hash || "#calendar").slice(1).split("/");
  let name = parts[0];
  if (VIEWS.indexOf(name) < 0) name = "calendar";
  if ((name === "admin" || name === "sets") && !S.isAdmin) name = "calendar";
  const detail = name === "admin" && parts[1];
  VIEWS.forEach(n => {
    $("view-" + n).hidden = !(n === name && !detail);
    const t = $("tab-" + n);
    if (n === name) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  $("view-detail").hidden = !detail;
  if (name === "admin" || name === "sets") {
    if (name === "sets") renderSets();
    ensureAdminData().then(() => {
      if (detail) openDetail(parts[1]);
      else if (name === "admin") renderAdmin();
      else renderSets();
    });
  }
}
window.addEventListener("hashchange", route);

/* ================= 行事曆 ================= */
function plansOf(ds) { return S.plans.filter(p => p.plan_date === ds).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))); }
function countsByDate() {
  const m = {};
  S.plans.forEach(p => { const c = m[p.plan_date] || (m[p.plan_date] = { t: 0, d: 0 }); c.t++; if (p.done) c.d++; });
  return m;
}
function rel(ds) {
  const diff = Math.round((parseD(ds) - parseD(S.today)) / 864e5);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  return diff > 0 ? diff + " 天後" : (-diff) + " 天前";
}
function renderMonth() {
  const y = S.vy, m = S.vm, first = new Date(y, m, 1), counts = countsByDate();
  $("mTitle").textContent = y + "年" + (m + 1) + "月";
  $("mRoc").textContent = "民國" + (y - 1911) + "年";
  let html = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - first.getDay() + i), ds = ymd(d), c = counts[ds];
    const cls = ["day"];
    if (d.getMonth() !== m) cls.push("out");
    if (ds === S.today) cls.push("today");
    if (ds === S.sel) cls.push("sel");
    const chip = c ? '<span class="chip' + (c.d === c.t ? " all" : "") + '">' + c.d + "/" + c.t + "</span>" : "";
    const label = (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + DOW[d.getDay()] + (c ? "，已完成 " + c.d + " / " + c.t : "，沒有計畫");
    html += '<button type="button" class="' + cls.join(" ") + '" data-date="' + ds + '" aria-pressed="' + (ds === S.sel) + '" aria-label="' + label + '"><span class="num">' + d.getDate() + "</span>" + chip + "</button>";
  }
  $("mGrid").innerHTML = html;
}
function renderDay() {
  const d = parseD(S.sel), list = plansOf(S.sel), done = list.filter(p => p.done).length;
  const pct = list.length ? Math.round(done / list.length * 100) : 0;
  $("dayHead").innerHTML =
    '<div class="dkick"><span class="rel' + (S.sel === S.today ? " now" : "") + '">' + rel(S.sel) + '</span><span class="roc">民國' + (d.getFullYear() - 1911) + "年</span></div>" +
    '<div class="bigdate"><span class="bd">' + d.getDate() + '</span><span class="bm">' + d.getFullYear() + "年" + (d.getMonth() + 1) + "月<br>星期" + DOW[d.getDay()] + "</span></div>" +
    '<div class="prog"><div class="progtxt"><span>已完成</span><b>' + done + " / " + list.length + '</b></div><div class="bar" role="progressbar" aria-label="當天完成進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div></div>';
  const ul = $("planList");
  if (!list.length) {
    ul.innerHTML = '<li class="empty">' + (S.sel > S.today ? "這天還沒有安排，可以先把要做的事排進來。" : "這天還沒有計畫。") + "<br>在下面寫下第一件事，按 Enter 新增。</li>";
    return;
  }
  ul.innerHTML = list.map(p =>
    '<li class="plan' + (p.done ? " done" : "") + '"><label class="chk"><input class="vh" type="checkbox" data-act="toggle" data-id="' + esc(p.id) + '"' + (p.done ? " checked" : "") + '><span class="box" aria-hidden="true"></span><span class="txt">' + esc(p.text) + "</span></label>" +
    '<span class="pa"><button type="button" class="txtbtn" data-act="push" data-id="' + esc(p.id) + '" aria-label="順延一天：' + esc(p.text) + '">順延</button><button type="button" class="txtbtn danger" data-act="del" data-id="' + esc(p.id) + '" aria-label="刪除：' + esc(p.text) + '">刪除</button></span></li>'
  ).join("");
}
function renderCalendar() { renderMonth(); renderDay(); }

async function addPlan(date, text) {
  try { const row = await api.addPlan(date, text); S.plans.push(row); renderCalendar(); }
  catch (e) { toast("新增失敗：" + humanErr(e)); }
}
async function togglePlan(id, done) {
  const p = S.plans.find(x => x.id === id); if (!p || S.pbusy[id]) { renderDay(); return; }
  S.pbusy[id] = 1; const old = p.done; p.done = done; renderCalendar();
  try { await api.patchPlan(id, { done: done }); }
  catch (e) { p.done = old; renderCalendar(); toast("儲存失敗：" + humanErr(e)); }
  delete S.pbusy[id];
}
async function pushPlan(id) {
  const p = S.plans.find(x => x.id === id); if (!p || S.pbusy[id]) return;
  const d = parseD(p.plan_date); d.setDate(d.getDate() + 1); const nd = ymd(d), old = p.plan_date;
  S.pbusy[id] = 1; p.plan_date = nd; renderCalendar();
  try { await api.patchPlan(id, { plan_date: nd }); toast("已順延到 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日"); }
  catch (e) { p.plan_date = old; renderCalendar(); toast("儲存失敗：" + humanErr(e)); }
  delete S.pbusy[id];
}
async function removePlan(id) {
  const i = S.plans.findIndex(x => x.id === id); if (i < 0 || S.pbusy[id]) return;
  const p = S.plans[i]; S.pbusy[id] = 1; S.plans.splice(i, 1); renderCalendar();
  try { await api.deletePlan(id); }
  catch (e) { S.plans.push(p); renderCalendar(); toast("刪除失敗：" + humanErr(e)); }
  delete S.pbusy[id];
}
$("view-calendar").addEventListener("click", e => {
  const b = e.target.closest("[data-date],[data-nav],[data-act]"); if (!b) return;
  if (b.dataset.date) {
    S.sel = b.dataset.date; const d = parseD(S.sel); S.vy = d.getFullYear(); S.vm = d.getMonth();
    renderCalendar();
    const nb = $("mGrid").querySelector('[data-date="' + S.sel + '"]'); if (nb) nb.focus({ preventScroll: true });
    return;
  }
  if (b.dataset.nav) {
    if (b.dataset.nav === "today") { const t = new Date(); S.sel = S.today; S.vy = t.getFullYear(); S.vm = t.getMonth(); }
    else { const n = new Date(S.vy, S.vm + (+b.dataset.nav), 1); S.vy = n.getFullYear(); S.vm = n.getMonth(); }
    renderCalendar(); return;
  }
  if (b.dataset.act === "push") pushPlan(b.dataset.id);
  else if (b.dataset.act === "del") removePlan(b.dataset.id);
});
$("view-calendar").addEventListener("change", e => {
  const t = e.target;
  if (t && t.dataset && t.dataset.act === "toggle") togglePlan(t.dataset.id, t.checked);
});
$("planForm").addEventListener("submit", e => {
  e.preventDefault();
  const i = $("planInput"), t = i.value.trim();
  if (!t) return;
  addPlan(S.sel, t); i.value = ""; i.focus();
});

/* ================= 題庫（選手自己的與管理員檢視共用） ================= */
// 每一題最多兩份：DOCX 一份、PDF 一份。items 的鍵：<題目 id>_q<題號>_<格式>
const slotKey = (setId, q, fmt) => setId + "_q" + q + "_" + fmt;
function toItems(rows) { const m = {}; rows.forEach(r => { m[slotKey(r.set_id, r.q, r.fmt)] = r; }); return m; }
function sortSets(a, b) {
  return (b.year - a.year) || ((KIND_ORDER[a.kind] || 0) - (KIND_ORDER[b.kind] || 0)) ||
    ((a.sort || 0) - (b.sort || 0)) || String(a.created_at).localeCompare(String(b.created_at));
}
const setById = id => S.sets.find(s => s.id === id);
const visibleSets = () => S.sets.filter(s => !s.hidden).sort(sortSets);
function qDone(items, set, q) { return !!(items[slotKey(set.id, q, "docx")] || items[slotKey(set.id, q, "pdf")]); }
function setCount(items, set) { let n = 0; for (let q = 1; q <= set.q_count; q++) if (qDone(items, set, q)) n++; return n; }
function statsOf(items, sets) {
  let sub = 0, full = 0, total = 0;
  sets.forEach(s => { const n = setCount(items, s); sub += n; total += s.q_count; if (n === s.q_count) full++; });
  return { sub: sub, full: full, total: total, sets: sets.length };
}
function statsHtml(items, sets) {
  const s = statsOf(items, sets), pct = s.total ? Math.round(s.sub / s.total * 100) : 0;
  return '<div class="bnum"><b>' + s.sub + "</b><span> / " + s.total + ' 題已繳</span></div>' +
    '<div class="bar" role="progressbar" aria-label="題庫繳交進度" aria-valuemin="0" aria-valuemax="' + s.total + '" aria-valuenow="' + s.sub + '"><i style="width:' + pct + '%"></i></div>' +
    "<p>整份完成 " + s.full + " / " + s.sets + " 份</p>";
}
function setLabel(s) { return s.kind === "c" ? s.title : KINDS[s.kind]; }
function listHtml(items, sets, sel) {
  const years = Array.from(new Set(sets.map(s => s.year))).sort((a, b) => b - a);
  if (!years.length) return '<li class="empty">目前沒有題目。</li>';
  return years.map(y => {
    const btns = sets.filter(s => s.year === y).sort(sortSets).map(s => {
      const n = setCount(items, s);
      let sq = ""; for (let q = 1; q <= s.q_count; q++) sq += '<i class="sq' + (qDone(items, s, q) ? " on" : "") + '"></i>';
      return '<button type="button" class="setbtn' + (sel === s.id ? " sel" : "") + (n === s.q_count ? " full" : "") + (s.hidden ? " hid" : "") + '" data-set="' + esc(s.id) + '" aria-pressed="' + (sel === s.id) + '" aria-label="' + esc(s.title) + "，已繳 " + n + " 題，共 " + s.q_count + ' 題">' +
        '<span class="stitle">' + esc(setLabel(s)) + '</span><span class="sqs">' + sq + '</span><span class="cnt">' + n + "/" + s.q_count + " 題" + (s.hidden ? " · 已隱藏" : "") + "</span></button>";
    }).join("");
    return '<li class="yrow"><div class="ylabel">' + y + "<small>民國 " + y + " 年</small></div><div class=\"yset\">" + btns + "</div></li>";
  }).join("");
}
function fileMetaHtml(it) {
  return '<span class="fn">' + esc(it.file_name) + '</span><span class="meta">' + fmtSize(it.size || 0) + " · " + fmtTime(it.created_at) + "</span>";
}
function fileBtns(it) {
  return (it.fmt === "pdf" ? '<button type="button" class="btn" data-act="open" data-path="' + esc(it.path) + '">開啟</button>' : "") +
    '<button type="button" class="btn" data-act="dl" data-path="' + esc(it.path) + '" data-name="' + esc(it.file_name) + '">下載</button>';
}
function slotHtml(items, set, q, fmt, admin) {
  const k = slotKey(set.id, q, fmt), it = items[k];
  const head = '<div class="slothead"><span class="tag">' + FMT_LABEL[fmt] + "</span>" + (it ? '<span class="seal sm" aria-hidden="true">已繳</span>' : "") + "</div>";
  if (admin) {
    return '<div class="slot' + (it ? " has" : "") + '">' + head + '<div class="slotbody">' + (it ? fileMetaHtml(it) : '<span class="muted">尚未繳交</span>') + "</div>" +
      (it ? '<div class="qact">' + fileBtns(it) + "</div>" : "") + "</div>";
  }
  const pf = S.pending[k], busy = !!S.busy[k], er = S.errs[k];
  const body = pf ? '<div class="pend">已選：' + esc(pf.name) + "（" + fmtSize(pf.size) + "）</div>" : it ? fileMetaHtml(it) : '<span class="muted">尚未繳交</span>';
  const pick = '<label class="btn">' + (it || pf ? "更換檔案" : "選擇 " + FMT_LABEL[fmt]) + '<input class="vh" type="file" id="f-' + esc(set.id) + "-" + q + "-" + fmt + '" data-q="' + q + '" data-fmt="' + fmt + '" accept="' + ACCEPT[fmt] + '"' + (busy ? " disabled" : "") + "></label>";
  const submit = pf ? '<button type="button" class="btn primary" data-act="submit" data-q="' + q + '" data-fmt="' + fmt + '"' + (busy ? " disabled" : "") + ">" + (busy ? "上傳中…" : (it ? "重新繳交" : "繳交")) + "</button>" : "";
  return '<div class="slot' + (it ? " has" : "") + '">' + head + '<div class="slotbody">' + body + "</div>" +
    (er ? '<p class="err" role="alert">' + esc(er) + "</p>" : "") +
    '<div class="qact">' + pick + submit + (it && !pf ? fileBtns(it) : "") + "</div></div>";
}
function slipHtml(items, setId, admin) {
  const set = setById(setId);
  if (!set) return '<p class="muted">從左邊選一份題目開始。</p>';
  const n = setCount(items, set);
  let rows = "";
  for (let q = 1; q <= set.q_count; q++) {
    rows += '<li class="qrow"><span class="qno">' + q + '</span><div class="slots">' + FMTS.map(f => slotHtml(items, set, q, f, admin)).join("") + "</div></li>";
  }
  let extra = "";
  if (admin) {
    const over = Object.keys(items).map(k => items[k]).filter(it => it.set_id === set.id && it.q > set.q_count)
      .sort((a, b) => (a.q - b.q) || a.fmt.localeCompare(b.fmt));
    if (over.length) {
      extra = '<li class="qrow extra"><span class="qno">!</span><div class="slots"><p class="muted" style="margin:0">這些是超出目前題數（' + set.q_count + " 題）的繳交，選手看不到，檔案都還在。</p>" +
        over.map(it => '<div class="slot has"><div class="slothead"><span class="tag">第 ' + it.q + " 題 · " + FMT_LABEL[it.fmt] + '</span></div><div class="slotbody">' + fileMetaHtml(it) + '</div><div class="qact">' + fileBtns(it) + "</div></div>").join("") +
        "</div></li>";
    }
  }
  return "<h3>" + esc(set.title) + '</h3><p class="sub">' + KINDS[set.kind] + (set.hidden ? " · 已隱藏（選手看不到）" : "") + " · 已繳 " + n + " / " + set.q_count + " 題" + (n === set.q_count ? " · 全部繳完了" : "") + "</p>" +
    '<ol class="qlist">' + rows + extra + "</ol>" +
    (admin ? "" : '<p class="rules">每一題可以繳一份 DOCX 和一份 PDF，只收這兩種格式，單檔上限 20 MB。重新繳交會取代同一格的舊檔。</p>');
}

function defaultSel(sets) { const s = sets.find(x => x.kind === "o") || sets[0]; return s ? s.id : null; }
function renderBank() {
  const sets = visibleSets();
  if (!S.bankPicked || !sets.some(s => s.id === S.bankSel)) S.bankSel = defaultSel(sets);
  $("bankStats").innerHTML = statsHtml(S.items, sets);
  $("bankList").innerHTML = listHtml(S.items, sets, S.bankSel);
  $("bankDetail").innerHTML = S.bankSel ? slipHtml(S.items, S.bankSel, false) : '<p class="muted">目前沒有開放的題目，請等老師新增。</p>';
}
$("bankList").addEventListener("click", e => {
  const b = e.target.closest("[data-set]"); if (!b) return;
  S.bankSel = b.dataset.set; S.bankPicked = true; renderBank();
  if (window.matchMedia("(max-width:899px)").matches) $("bankDetail").scrollIntoView({ block: "start" });
});
$("bankDetail").addEventListener("change", e => {
  const t = e.target;
  if (t && t.type === "file" && t.files && t.files[0]) {
    const k = slotKey(S.bankSel, t.dataset.q, t.dataset.fmt);
    S.pending[k] = t.files[0]; S.errs[k] = ""; renderBank();
  }
});
$("bankDetail").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.dataset.act === "submit") submitItem(S.bankSel, +b.dataset.q, b.dataset.fmt);
  else fileAction(b);
});

async function fileAction(btn) {
  const mode = btn.dataset.act, path = btn.dataset.path, name = btn.dataset.name;
  const w = mode === "open" ? window.open("", "_blank") : null;
  btn.disabled = true;
  try {
    const r = await api.signedUrl(path, mode === "dl" ? name : null);
    if (r.error || !r.data || !r.data.signedUrl) throw (r.error || new Error("no url"));
    if (w) w.location.href = r.data.signedUrl; else location.href = r.data.signedUrl;
  } catch (e) {
    if (w) w.close();
    toast("無法取得檔案：" + humanErr(e));
  }
  btn.disabled = false;
}

function upErr(e) { return (e && e.msg) ? e.msg : "上傳失敗：" + humanErr(e); }
async function submitItem(setId, q, fmt) {
  const k = slotKey(setId, q, fmt), f = S.pending[k], set = setById(setId);
  if (!f || S.busy[k] || !S.uid || !set) return;
  S.busy[k] = true; S.errs[k] = ""; renderBank();
  let newPath = null;
  try {
    if (!f.name.toLowerCase().endsWith("." + fmt)) throw { msg: "這一格只收 ." + fmt + " 檔案（" + FMT_LABEL[fmt] + "）。" };
    if (!f.size) throw { msg: "這是空檔案，請重新選擇。" };
    if (f.size > MAXFILE) throw { msg: "檔案超過上限（20 MB）。" };
    const h = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    const isPdf = h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46;
    const isZip = h[0] === 0x50 && h[1] === 0x4B && h[2] === 3 && h[3] === 4;
    if (fmt === "pdf" && !isPdf) throw { msg: "檔案內容不是 PDF，請確認檔案沒有被改過副檔名。" };
    if (fmt === "docx" && !isZip) throw { msg: "檔案內容不是 DOCX，請確認檔案沒有被改過副檔名。" };
    const oldPath = S.items[k] && S.items[k].path;
    newPath = S.uid + "/" + setId + "_q" + q + "_" + fmt + "_" + Date.now() + "." + fmt;
    await api.upload(newPath, f, fmt);
    let row;
    try {
      row = await api.upsertSub({ user_id: S.uid, set_id: setId, q: q, file_name: f.name, fmt: fmt, size: f.size, path: newPath });
    } catch (dbErr) { await api.removeFiles([newPath]); newPath = null; throw dbErr; }
    S.items[k] = row; newPath = null;
    if (oldPath && oldPath !== row.path) api.removeFiles([oldPath]);
    delete S.pending[k];
    toast("已繳交：" + set.title + " 第 " + q + " 題（" + FMT_LABEL[fmt] + "）");
  } catch (e) { S.errs[k] = upErr(e); }
  delete S.busy[k];
  renderBank();
}

/* ================= 後台：選手 ================= */
async function ensureAdminData(force) {
  if (!S.isAdmin) return;
  if (S.admin.loaded && !force) return;
  if (S.admin.loading) return;
  S.admin.loading = true;
  try {
    const r = await Promise.all([api.allProfiles(), api.allSubs(), api.listSets()]);
    S.admin.profiles = r[0] || []; S.admin.subs = r[1] || []; S.sets = r[2] || S.sets; S.admin.loaded = true;
  } catch (e) { toast("讀取後台資料失敗：" + humanErr(e)); }
  S.admin.loading = false;
}
function personName(p) { return p.display_name || p.email || "（未命名）"; }
function subsOf(uid) { return S.admin.subs.filter(s => s.user_id === uid); }
function isOpenSub(sub) { const s = setById(sub.set_id); return !!s && !s.hidden && sub.q <= s.q_count; }
function renderAdmin() {
  if (!S.isAdmin) return;
  const q = S.admin.q.trim().toLowerCase(), vis = visibleSets();
  const rows = S.admin.profiles.map(p => {
    const mine = subsOf(p.id), items = toItems(mine.filter(isOpenSub)), st = statsOf(items, vis);
    const last = mine.reduce((m, s) => Math.max(m, Date.parse(s.created_at) || 0), 0);
    return { p: p, st: st, hidden: mine.filter(s => !isOpenSub(s)).length, last: last };
  }).filter(r => !q || (personName(r.p) + " " + (r.p.email || "")).toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => (b.last - a.last) || personName(a.p).localeCompare(personName(b.p), "zh-Hant"));
  $("adminSum").textContent = S.admin.loaded ? "共 " + S.admin.profiles.length + " 位使用者，累計 " + S.admin.subs.length + " 份檔案。" : "讀取中…";
  if (!S.admin.loaded) { $("adminTable").innerHTML = ""; return; }
  if (!rows.length) { $("adminTable").innerHTML = '<p class="muted">沒有符合的選手。</p>'; return; }
  $("adminTable").innerHTML = '<table class="tbl"><thead><tr><th>選手</th><th>信箱</th><th>已繳題數</th><th>整份完成</th><th>隱藏題目中的檔案</th><th>最近繳交</th><th></th></tr></thead><tbody>' +
    rows.map(r => '<tr><td class="wrap">' + esc(personName(r.p)) + (r.p.role === "admin" ? ' <span class="tag admin">管理員</span>' : "") + '</td><td class="wrap">' + esc(r.p.email || "") + '</td><td class="num">' + r.st.sub + " / " + r.st.total + '</td><td class="num">' + r.st.full + " / " + r.st.sets + '</td><td class="num">' + r.hidden + '</td><td class="num">' + (r.last ? fmtTime(r.last) : "—") + '</td><td><a class="btn" href="#admin/' + esc(r.p.id) + '">查看</a></td></tr>').join("") +
    "</tbody></table>";
}
$("adminSearch").addEventListener("input", e => { S.admin.q = e.target.value; renderAdmin(); });
$("adminRefresh").addEventListener("click", async () => {
  await ensureAdminData(true); renderAdmin(); renderSets(); renderBank();
  if (S.admin.detailUid && !$("view-detail").hidden) openDetail(S.admin.detailUid);
  toast("已更新");
});

function openDetail(uid) {
  const p = S.admin.profiles.find(x => x.id === uid);
  if (!p) { $("dName").textContent = "找不到這位使用者"; $("dEmail").textContent = ""; $("dStats").innerHTML = ""; $("dList").innerHTML = ""; $("dSlip").innerHTML = ""; return; }
  const all = S.sets.slice().sort(sortSets);
  if (S.admin.detailUid !== uid || !all.some(s => s.id === S.admin.sel)) { S.admin.detailUid = uid; S.admin.sel = defaultSel(all.filter(s => !s.hidden)) || defaultSel(all); }
  const mine = subsOf(uid), items = toItems(mine), hiddenN = mine.filter(s => !isOpenSub(s)).length;
  $("dName").textContent = personName(p);
  $("dEmail").textContent = p.email || "";
  $("dStats").innerHTML = statsHtml(toItems(mine.filter(isOpenSub)), visibleSets()) +
    (hiddenN ? '<p class="muted">另有 ' + hiddenN + " 份檔案在已隱藏的題目或超出題數的題號中，選手看不到。</p>" : "");
  $("dList").innerHTML = listHtml(items, all, S.admin.sel);
  $("dSlip").innerHTML = slipHtml(items, S.admin.sel, true);
}
$("dList").addEventListener("click", e => {
  const b = e.target.closest("[data-set]"); if (!b) return;
  S.admin.sel = b.dataset.set; openDetail(S.admin.detailUid);
  if (window.matchMedia("(max-width:899px)").matches) $("dSlip").scrollIntoView({ block: "start" });
});
$("dSlip").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) fileAction(b); });

/* ================= 後台：題庫管理 ================= */
function fileCounts() { const m = {}; S.admin.subs.forEach(s => { m[s.set_id] = (m[s.set_id] || 0) + 1; }); return m; }
function intIn(v, lo, hi) { const n = parseInt(v, 10); return (n >= lo && n <= hi) ? n : null; }
function say(id, msg, bad) { const n = $(id); n.textContent = msg; n.classList.toggle("bad", !!bad); }
async function reloadSets() { S.sets = await api.listSets(); }

function renderSets() {
  if (!S.isAdmin) return;
  const list = S.sets.slice().sort(sortSets), counts = fileCounts(), ready = S.admin.loaded;
  const hid = list.filter(s => s.hidden).length;
  $("setsSum").textContent = ready ? "共 " + list.length + " 份題目（顯示中 " + (list.length - hid) + "、已隱藏 " + hid + "），累計 " + S.admin.subs.length + " 份檔案。" : "讀取中…";
  if (!ready) { $("setsTable").innerHTML = ""; return; }
  if (!list.length) { $("setsTable").innerHTML = '<p class="muted">還沒有題目。用上面的「新增年度」開始。</p>'; return; }
  $("setsTable").innerHTML = '<table class="tbl"><thead><tr><th>年度</th><th>名稱</th><th>類型</th><th>題數</th><th>已繳檔案</th><th>狀態</th><th></th></tr></thead><tbody>' +
    list.map(s => {
      const n = counts[s.id] || 0, editing = S.admin.editId === s.id, confirming = S.admin.confirmDel === s.id, id = esc(s.id);
      const state = s.hidden ? '<span class="tag hid">已隱藏</span>' : '<span class="tag">顯示中</span>';
      if (editing) {
        return '<tr><td class="num">' + s.year + '</td><td><label class="vh" for="editTitle">名稱</label><input class="inl" id="editTitle" type="text" maxlength="60" value="' + esc(s.title) + '"></td><td>' + KINDS[s.kind] + '</td><td><label class="vh" for="editQ">題數</label><input class="inl q" id="editQ" type="number" min="1" max="20" value="' + s.q_count + '"></td><td class="num">' + n + "</td><td>" + state + '</td><td class="acts"><button type="button" class="btn primary" data-act="save" data-id="' + id + '">儲存</button> <button type="button" class="txtbtn" data-act="cancel">取消</button></td></tr>';
      }
      let acts = '<button type="button" class="txtbtn" data-act="edit" data-id="' + id + '">編輯</button>';
      acts += s.hidden ? '<button type="button" class="txtbtn" data-act="show" data-id="' + id + '">重新顯示</button>' : '<button type="button" class="txtbtn" data-act="hide" data-id="' + id + '">隱藏</button>';
      if (n === 0) {
        acts += confirming ? ' <span class="muted">確定刪除？</span> <button type="button" class="txtbtn danger" data-act="delok" data-id="' + id + '">確定</button><button type="button" class="txtbtn" data-act="delno">取消</button>'
          : '<button type="button" class="txtbtn danger" data-act="del" data-id="' + id + '">刪除</button>';
      } else {
        acts += ' <span class="muted">有繳交，不能刪除</span>';
      }
      return "<tr><td class=\"num\">" + s.year + '</td><td class="wrap">' + esc(s.title) + '</td><td>' + KINDS[s.kind] + '</td><td class="num">' + s.q_count + '</td><td class="num">' + n + "</td><td>" + state + '</td><td class="acts">' + acts + "</td></tr>";
    }).join("") + "</tbody></table>";
}

$("setsTable").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b || S.admin.busy) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "edit") { S.admin.editId = id; S.admin.confirmDel = null; renderSets(); const t = $("editTitle"); if (t) t.focus(); return; }
  if (act === "cancel") { S.admin.editId = null; renderSets(); return; }
  if (act === "del") { S.admin.confirmDel = id; S.admin.editId = null; renderSets(); return; }
  if (act === "delno") { S.admin.confirmDel = null; renderSets(); return; }
  S.admin.busy = true;
  try {
    if (act === "hide" || act === "show") {
      await api.patchSet(id, { hidden: act === "hide" });
      const s = setById(id); if (s) s.hidden = act === "hide";
      toast(act === "hide" ? "已隱藏，選手看不到，檔案都還在。" : "已重新顯示。");
    } else if (act === "save") {
      const t = $("editTitle").value.trim(), q = intIn($("editQ").value, 1, 20);
      if (!t || t.length > 60) { toast("名稱要 1 到 60 個字。"); S.admin.busy = false; return; }
      if (q === null) { toast("題數要是 1 到 20。"); S.admin.busy = false; return; }
      const lost = S.admin.subs.filter(x => x.set_id === id && x.q > q).length;
      await api.patchSet(id, { title: t, q_count: q });
      const s = setById(id); if (s) { s.title = t; s.q_count = q; }
      S.admin.editId = null;
      toast(lost ? "已更新。第 " + (q + 1) + " 題以後有 " + lost + " 份繳交，現在對選手隱藏，後台仍看得到；把題數調回去就會再出現。" : "已更新。");
    } else if (act === "delok") {
      S.admin.confirmDel = null;
      try { await api.deleteSet(id); S.sets = S.sets.filter(x => x.id !== id); toast("已刪除。"); }
      catch (err) {
        if (/foreign key/i.test(String(err && err.message))) {
          await api.patchSet(id, { hidden: true }); const s = setById(id); if (s) s.hidden = true;
          await ensureAdminData(true);
          toast("這份剛好有人繳交了，不能刪除，已改為隱藏。");
        } else throw err;
      }
    }
  } catch (err) { toast("操作失敗：" + humanErr(err)); }
  S.admin.busy = false;
  renderSets(); renderBank();
});

$("yearForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (S.admin.busy) return;
  const a = intIn($("yearFrom").value, 1, 300), bRaw = $("yearTo").value.trim(), b = bRaw === "" ? a : intIn(bRaw, 1, 300);
  if (a === null || b === null) { say("yearMsg", "請輸入 1 到 300 之間的民國年。", true); return; }
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi - lo > 29) { say("yearMsg", "一次最多新增 30 個年度。", true); return; }
  S.admin.busy = true;
  try {
    const rows = [], reshow = []; let skip = 0;
    for (let y = lo; y <= hi; y++) ["o", "m"].forEach(k => {
      const ex = S.sets.find(s => s.year === y && s.kind === k);
      if (!ex) rows.push({ year: y, kind: k, title: y + " 年" + KINDS[k], q_count: 6 });
      else if (ex.hidden) reshow.push(ex); else skip++;
    });
    if (rows.length) await api.addSets(rows);
    for (const ex of reshow) await api.patchSet(ex.id, { hidden: false });
    await reloadSets();
    const parts = [];
    if (rows.length) parts.push("新增 " + rows.length + " 份");
    if (reshow.length) parts.push("重新顯示 " + reshow.length + " 份");
    if (skip) parts.push(skip + " 份本來就有");
    say("yearMsg", "完成：" + parts.join("、") + "。");
    $("yearFrom").value = ""; $("yearTo").value = "";
  } catch (err) { say("yearMsg", "失敗：" + humanErr(err), true); }
  S.admin.busy = false;
  renderSets(); renderBank();
});

let titleTouched = false, autoTitle = "";
$("cTitle").addEventListener("input", () => { titleTouched = $("cTitle").value !== autoTitle; });
$("cYear").addEventListener("input", () => {
  const y = intIn($("cYear").value, 1, 300);
  if (!titleTouched || !$("cTitle").value) { autoTitle = y ? y + " 自製模擬賽模擬題" : ""; $("cTitle").value = autoTitle; titleTouched = false; }
});
$("customForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (S.admin.busy) return;
  const y = intIn($("cYear").value, 1, 300), q = intIn($("cQ").value, 1, 20), t = $("cTitle").value.trim();
  if (y === null) { say("customMsg", "請輸入 1 到 300 之間的民國年。", true); return; }
  if (q === null) { say("customMsg", "題數要是 1 到 20。", true); return; }
  if (!t || t.length > 60) { say("customMsg", "名稱要 1 到 60 個字。", true); return; }
  S.admin.busy = true;
  try {
    const sorts = S.sets.filter(s => s.year === y && s.kind === "c").map(s => s.sort || 0);
    await api.addSets([{ year: y, kind: "c", title: t, q_count: q, sort: sorts.length ? Math.max.apply(null, sorts) + 1 : 0 }]);
    await reloadSets();
    say("customMsg", "已新增「" + t + "」，放在 " + y + " 年旁邊。");
    $("cTitle").value = ""; titleTouched = false; autoTitle = "";
  } catch (err) { say("customMsg", "失敗：" + humanErr(err), true); }
  S.admin.busy = false;
  renderSets(); renderBank();
});

function renderTidy() {
  const box = $("tidyBox"), t = S.admin.tidy;
  if (!t) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  if (!t.del.length && !t.hide.length) { box.innerHTML = "民國 " + t.year + " 年（含）以前沒有需要處理的題目。"; return; }
  box.innerHTML = "民國 " + t.year + " 年（含）以前：沒有繳交的 <b>" + t.del.length + "</b> 份會刪除，已有繳交的 <b>" + t.hide.length + "</b> 份會隱藏（檔案不會被動到）。" +
    '<div class="row"><button type="button" class="btn primary" data-act="tidyok">確定執行</button><button type="button" class="txtbtn" data-act="tidyno">取消</button></div>';
}
$("tidyForm").addEventListener("submit", e => {
  e.preventDefault();
  const y = intIn($("tidyYear").value, 1, 300);
  if (y === null) { say("tidyMsg", "請輸入 1 到 300 之間的民國年。", true); return; }
  if (!S.admin.loaded) { say("tidyMsg", "資料還在讀取，請稍後再按一次。", true); return; }
  say("tidyMsg", "沒有人繳交的會刪除，已有繳交的會改成隱藏，檔案不會被動到。先預覽，再確認。");
  const counts = fileCounts(), target = S.sets.filter(s => s.year <= y);
  S.admin.tidy = {
    year: y,
    del: target.filter(s => !(counts[s.id] > 0)).map(s => s.id),
    hide: target.filter(s => counts[s.id] > 0 && !s.hidden).map(s => s.id)
  };
  renderTidy();
});
$("tidyBox").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b || S.admin.busy) return;
  if (b.dataset.act === "tidyno") { S.admin.tidy = null; renderTidy(); return; }
  const t = S.admin.tidy; if (!t) return;
  S.admin.busy = true;
  let del = 0, hide = 0, fail = 0;
  for (const id of t.del) {
    try { await api.deleteSet(id); del++; }
    catch (err) { try { await api.patchSet(id, { hidden: true }); hide++; } catch (e2) { fail++; } }
  }
  for (const id of t.hide) { try { await api.patchSet(id, { hidden: true }); hide++; } catch (err) { fail++; } }
  S.admin.tidy = null; renderTidy();
  try { await ensureAdminData(true); } catch (err) { /* 已在內部提示 */ }
  S.admin.busy = false;
  say("tidyMsg", "完成：刪除 " + del + " 份、隱藏 " + hide + " 份" + (fail ? "、" + fail + " 份失敗" : "") + "。");
  $("tidyYear").value = "";
  renderSets(); renderBank();
});

/* ================= 啟動 ================= */
async function boot() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) { showOnly("setup"); return; }
  if (!window.supabase) {
    $("setup").querySelector(".card").innerHTML = '<h2>無法載入登入程式</h2><p>網站需要從網路載入 Supabase 程式庫，但這次沒有成功。請檢查網路後重新整理；如果一直這樣，請看 README 的「疑難排解」。</p>';
    showOnly("setup"); return;
  }
  S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  S.sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "PASSWORD_RECOVERY") {
      S.recovery = true; showOnly("auth"); $("authLoginBox").hidden = true; $("recoverForm").hidden = false; return;
    }
    setTimeout(() => handleSession(session), 0);
  });
  const r = await S.sb.auth.getSession();
  if (!S.recovery) await handleSession(r.data.session);
}

/* 跨日只重畫，不寫資料 */
setInterval(() => {
  const t = ymd(new Date());
  if (t !== S.today) {
    const wasToday = S.sel === S.today; S.today = t;
    if (wasToday) { S.sel = t; const d = parseD(t); S.vy = d.getFullYear(); S.vm = d.getMonth(); }
    if (S.ready) renderCalendar();
  }
}, 60000);

setAuthMode("login");
boot();
})();
