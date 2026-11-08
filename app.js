(function () {
"use strict";

/* ================= 常數與小工具 ================= */
const CFG = window.APP_CONFIG || {};
const BUCKET = "submissions";
const DOW = ["日", "一", "二", "三", "四", "五", "六"];
const YEARS = 14, QN = 6;
const MAXFILE = 20 * 1048576;
const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
const ACCEPT = ".pdf,.docx," + MIME.pdf + "," + MIME.docx;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseD = s => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const typeName = t => (t === "o" ? "正式賽" : "模擬賽");

const today0 = ymd(new Date());
const S = {
  sb: null, uid: null, profile: null, isAdmin: false, ready: false, recovery: false,
  today: today0, sel: today0, vy: new Date().getFullYear(), vm: new Date().getMonth(),
  plans: [], plansLoaded: false, pbusy: {},
  items: {}, startYear: 102, bankSel: null, bankPicked: false, pending: {}, busy: {}, errs: {},
  admin: { profiles: [], subs: [], loaded: false, loading: false, q: "", detailUid: null, sel: null }
};

let toastT = null;
function toast(msg) {
  $("toastMsg").textContent = msg;
  const t = $("toast"); t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3800);
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
  if (/row-level security|violates row-level|not authorized|permission/i.test(m)) return "沒有權限做這個動作。";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "網路不穩，請稍後再試。";
  return "發生錯誤，請稍後再試。";
}
function must(r) { if (r && r.error) throw r.error; return r ? r.data : null; }

/* ================= 資料存取層（全部集中在這裡） ================= */
const api = {
  getProfile: uid => S.sb.from("profiles").select("*").eq("id", uid).single().then(must),
  getSettings: () => S.sb.from("settings").select("*").then(must),
  listPlans: () => S.sb.from("plans").select("*").order("created_at", { ascending: true }).then(must),
  addPlan: (date, text) => S.sb.from("plans").insert({ plan_date: date, text: text }).select().single().then(must),
  patchPlan: (id, patch) => S.sb.from("plans").update(patch).eq("id", id).then(must),
  deletePlan: id => S.sb.from("plans").delete().eq("id", id).then(must),
  mySubs: uid => S.sb.from("submissions").select("*").eq("user_id", uid).then(must),
  upload: (path, file, fmt) => S.sb.storage.from(BUCKET).upload(path, file, { contentType: MIME[fmt], upsert: false }).then(must),
  removeFiles: paths => S.sb.storage.from(BUCKET).remove(paths),
  upsertSub: row => S.sb.from("submissions").upsert(row, { onConflict: "user_id,year,kind,q" }).select().single().then(must),
  signedUrl: (path, name) => S.sb.storage.from(BUCKET).createSignedUrl(path, 180, name ? { download: name } : undefined),
  allProfiles: () => S.sb.from("profiles").select("*").order("created_at", { ascending: true }).then(must),
  allSubs: () => S.sb.from("submissions").select("*").then(must),
  setStartYear: v => S.sb.from("settings").upsert({ key: "start_year", value: v }).then(must)
};

/* ================= 畫面切換與登入 ================= */
function showOnly(name) {
  ["setup", "auth", "main"].forEach(n => { $(n).hidden = n !== name; });
}
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
    S.plans = []; S.plansLoaded = false; S.items = {}; S.pending = {}; S.admin.loaded = false;
    showOnly("auth"); return;
  }
  if (!force && S.ready && S.uid === session.user.id) return;
  S.uid = session.user.id; S.ready = false;
  showOnly("main");
  $("whoName").textContent = "載入中…";
  try {
    const [profile, settings, plans, subs] = await Promise.all([
      api.getProfile(S.uid), api.getSettings(), api.listPlans(), api.mySubs(S.uid)
    ]);
    S.profile = profile; S.isAdmin = profile.role === "admin";
    applySettings(settings);
    S.plans = plans || []; S.plansLoaded = true;
    S.items = toItems(subs || []);
    S.ready = true;
  } catch (err) {
    showOnly("auth");
    authNote("登入成功，但讀取資料失敗：" + humanErr(err) + " 請確認已執行 schema.sql。");
    return;
  }
  $("whoName").textContent = S.profile.display_name || S.profile.email || "我";
  $("whoTag").hidden = !S.isAdmin;
  $("tab-admin").hidden = !S.isAdmin;
  renderCalendar(); renderBank(); route();
}
function applySettings(rows) {
  (rows || []).forEach(r => {
    if (r.key === "start_year") {
      const v = Number(r.value);
      if (Number.isInteger(v) && v >= 50 && v <= 200) S.startYear = v;
    }
  });
}

/* ================= 路由 ================= */
function route() {
  if (!S.ready) return;
  const parts = (location.hash || "#calendar").slice(1).split("/");
  let name = parts[0];
  if (["calendar", "bank", "admin"].indexOf(name) < 0) name = "calendar";
  if (name === "admin" && !S.isAdmin) name = "calendar";
  const detail = name === "admin" && parts[1];
  ["calendar", "bank", "admin"].forEach(n => {
    $("view-" + n).hidden = !(n === name && !detail);
    const t = $("tab-" + n);
    if (n === name) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  $("view-detail").hidden = !detail;
  if (name === "admin") {
    ensureAdminData().then(() => { if (detail) openDetail(parts[1]); else renderAdmin(); });
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
  try {
    const row = await api.addPlan(date, text);
    S.plans.push(row); renderCalendar();
  } catch (e) { toast("新增失敗：" + humanErr(e)); }
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
const setKey = (y, t) => "y" + y + "-" + t;
const itemKey = (sk, q) => sk + "_q" + q;
const rowKey = r => "y" + r.year + "-" + r.kind + "_q" + r.q;
function toItems(rows) { const m = {}; rows.forEach(r => { m[rowKey(r)] = r; }); return m; }
function yearList() { const a = []; for (let i = 0; i < YEARS; i++) a.push(S.startYear + YEARS - 1 - i); return a; }
function setCount(items, sk) { let n = 0; for (let q = 1; q <= QN; q++) if (items[itemKey(sk, q)]) n++; return n; }
function parseSet(sk) { const m = /^y(\d+)-([om])$/.exec(sk || ""); return m ? { y: +m[1], t: m[2] } : null; }
function statsOf(items) {
  let sub = 0, full = 0;
  yearList().forEach(y => ["o", "m"].forEach(t => { const n = setCount(items, setKey(y, t)); sub += n; if (n === QN) full++; }));
  return { sub: sub, full: full };
}
function statsHtml(items) {
  const s = statsOf(items), total = YEARS * 2 * QN, pct = Math.round(s.sub / total * 100);
  return '<div class="bnum"><b>' + s.sub + "</b><span> / " + total + ' 題已繳</span></div>' +
    '<div class="bar" role="progressbar" aria-label="題庫繳交進度" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + s.sub + '"><i style="width:' + pct + '%"></i></div>' +
    "<p>整份完成 " + s.full + " / " + YEARS * 2 + " 份</p>";
}
function tableHtml(items, sel) {
  return yearList().map(y => {
    const cells = ["o", "m"].map(t => {
      const sk = setKey(y, t), n = setCount(items, sk);
      let sq = ""; for (let q = 1; q <= QN; q++) sq += '<i class="sq' + (items[itemKey(sk, q)] ? " on" : "") + '"></i>';
      return '<td><button type="button" class="setbtn' + (sel === sk ? " sel" : "") + (n === QN ? " full" : "") + '" data-set="' + sk + '" aria-pressed="' + (sel === sk) + '" aria-label="' + y + " 年" + typeName(t) + "，已繳 " + n + " 題，共 " + QN + ' 題"><span class="sqs">' + sq + '</span><span class="cnt">' + n + "/" + QN + " 題</span></button></td>";
    }).join("");
    return '<tr><th scope="row">' + y + "<small>民國 " + y + " 年</small></th>" + cells + "</tr>";
  }).join("");
}
function fileMetaHtml(it) {
  return '<span class="seal" aria-hidden="true">已繳</span><div class="qfile"><span class="fn">' + esc(it.file_name) + '</span><span class="meta">' + esc(String(it.fmt || "").toUpperCase()) + " · " + fmtSize(it.size || 0) + " · " + fmtTime(it.created_at) + "</span></div>";
}
function fileBtns(it) {
  return (it.fmt === "pdf" ? '<button type="button" class="btn" data-act="open" data-path="' + esc(it.path) + '">開啟</button>' : "") +
    '<button type="button" class="btn" data-act="dl" data-path="' + esc(it.path) + '" data-name="' + esc(it.file_name) + '">下載</button>';
}
function slipHtml(items, sk, admin) {
  const ps = parseSet(sk);
  if (!ps) return '<p class="muted">從左邊選一份題目開始。</p>';
  const n = setCount(items, sk);
  let rows = "";
  for (let q = 1; q <= QN; q++) {
    const k = itemKey(sk, q), it = items[k];
    if (admin) {
      rows += '<li class="qrow"><span class="qno">' + q + '</span><div class="qmain">' + (it ? fileMetaHtml(it) : '<span class="muted">尚未繳交</span>') + "</div>" +
        (it ? '<div class="qact">' + fileBtns(it) + "</div>" : "") + "</li>";
      continue;
    }
    const pf = S.pending[k], busy = !!S.busy[k], er = S.errs[k];
    let main;
    if (pf) main = '<div class="pend">已選：' + esc(pf.name) + "（" + fmtSize(pf.size) + "）</div>";
    else if (it) main = fileMetaHtml(it);
    else main = '<span class="muted">尚未繳交</span>';
    const submitBtn = pf ? '<button type="button" class="btn primary" data-act="submit" data-q="' + q + '"' + (busy ? " disabled" : "") + ">" + (busy ? "上傳中…" : (it ? "重新繳交" : "繳交")) + "</button>" : "";
    rows += '<li class="qrow"><span class="qno">' + q + '</span><div class="qmain">' + main + "</div>" +
      (er ? '<p class="err" role="alert">' + esc(er) + "</p>" : "") +
      '<div class="qact"><label class="btn">' + (it || pf ? "更換檔案" : "選擇檔案") + '<input class="vh" type="file" id="f-' + sk + "-" + q + '" data-q="' + q + '" accept="' + ACCEPT + '"' + (busy ? " disabled" : "") + ">" + "</label>" + submitBtn + (it && !pf ? fileBtns(it) : "") + "</div></li>";
  }
  return "<h3>" + ps.y + " 年 " + typeName(ps.t) + '</h3><p class="sub">已繳 ' + n + " / " + QN + " 題" + (n === QN ? " · 這份全部繳完了" : "") + "</p>" +
    '<ol class="qlist">' + rows + "</ol>" +
    (admin ? "" : '<p class="rules">只收 PDF 或 DOCX，單檔上限 20 MB。重新繳交會取代舊檔。</p>');
}

function renderBank() {
  if (!S.bankPicked) S.bankSel = setKey(S.startYear + YEARS - 1, "o");
  $("bankStats").innerHTML = statsHtml(S.items);
  $("bankBody").innerHTML = tableHtml(S.items, S.bankSel);
  $("bankDetail").innerHTML = slipHtml(S.items, S.bankSel, false);
}
$("bankBody").addEventListener("click", e => {
  const b = e.target.closest("[data-set]"); if (!b) return;
  S.bankSel = b.dataset.set; S.bankPicked = true; renderBank();
  if (window.matchMedia("(max-width:899px)").matches) $("bankDetail").scrollIntoView({ block: "start" });
});
$("bankDetail").addEventListener("change", e => {
  const t = e.target;
  if (t && t.type === "file" && t.files && t.files[0]) {
    const k = itemKey(S.bankSel, t.dataset.q);
    S.pending[k] = t.files[0]; S.errs[k] = ""; renderBank();
  }
});
$("bankDetail").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.dataset.act === "submit") submitItem(S.bankSel, +b.dataset.q);
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
async function submitItem(sk, q) {
  const k = itemKey(sk, q), f = S.pending[k];
  if (!f || S.busy[k] || !S.uid) return;
  S.busy[k] = true; S.errs[k] = ""; renderBank();
  let newPath = null;
  try {
    const lower = f.name.toLowerCase();
    const fmt = lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".docx") ? "docx" : null;
    if (!fmt) throw { msg: "只接受 .pdf 或 .docx 檔案。" };
    if (!f.size) throw { msg: "這是空檔案，請重新選擇。" };
    if (f.size > MAXFILE) throw { msg: "檔案超過上限（20 MB）。" };
    const h = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    const isPdf = h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46;
    const isZip = h[0] === 0x50 && h[1] === 0x4B && h[2] === 3 && h[3] === 4;
    if (fmt === "pdf" && !isPdf) throw { msg: "檔案內容不是 PDF，請確認檔案沒有被改過副檔名。" };
    if (fmt === "docx" && !isZip) throw { msg: "檔案內容不是 DOCX，請確認檔案沒有被改過副檔名。" };
    const ps = parseSet(sk), oldPath = S.items[k] && S.items[k].path;
    newPath = S.uid + "/" + sk + "_q" + q + "_" + Date.now() + "." + fmt;
    await api.upload(newPath, f, fmt);
    let row;
    try {
      row = await api.upsertSub({ user_id: S.uid, year: ps.y, kind: ps.t, q: q, file_name: f.name, fmt: fmt, size: f.size, path: newPath });
    } catch (dbErr) { await api.removeFiles([newPath]); newPath = null; throw dbErr; }
    S.items[k] = row; newPath = null;
    if (oldPath && oldPath !== row.path) api.removeFiles([oldPath]);
    delete S.pending[k];
    toast("已繳交：" + ps.y + " 年" + typeName(ps.t) + " 第 " + q + " 題");
  } catch (e) { S.errs[k] = upErr(e); }
  delete S.busy[k];
  renderBank();
}

/* ================= 管理員 ================= */
async function ensureAdminData(force) {
  if (!S.isAdmin) return;
  if (S.admin.loaded && !force) return;
  if (S.admin.loading) return;
  S.admin.loading = true;
  try {
    const r = await Promise.all([api.allProfiles(), api.allSubs()]);
    S.admin.profiles = r[0] || []; S.admin.subs = r[1] || []; S.admin.loaded = true;
  } catch (e) { toast("讀取選手資料失敗：" + humanErr(e)); }
  S.admin.loading = false;
}
function personName(p) { return p.display_name || p.email || "（未命名）"; }
function subsOf(uid) { return S.admin.subs.filter(s => s.user_id === uid); }
function renderAdmin() {
  if (!S.isAdmin) return;
  const i = $("cfgYear");
  if (document.activeElement !== i) i.value = S.startYear;
  $("cfgNote").textContent = "目前顯示民國 " + S.startYear + "–" + (S.startYear + YEARS - 1) + " 年，共 " + YEARS + " 年 × 正式／模擬 = " + YEARS * 2 + " 份。已繳的檔案以年度為準，改這裡不會弄亂舊紀錄。";
  const q = S.admin.q.trim().toLowerCase();
  const rows = S.admin.profiles.map(p => {
    const mine = subsOf(p.id), bySet = {};
    mine.forEach(s => { const k = "y" + s.year + "-" + s.kind; bySet[k] = (bySet[k] || 0) + 1; });
    const full = Object.keys(bySet).filter(k => bySet[k] === QN).length;
    const last = mine.reduce((m, s) => Math.max(m, Date.parse(s.created_at) || 0), 0);
    return { p: p, n: mine.length, full: full, last: last };
  }).filter(r => !q || (personName(r.p) + " " + (r.p.email || "")).toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => (b.last - a.last) || personName(a.p).localeCompare(personName(b.p), "zh-Hant"));
  const total = S.admin.subs.length;
  $("adminSum").textContent = S.admin.loaded ? "共 " + S.admin.profiles.length + " 位使用者，累計 " + total + " 份檔案。" : "讀取中…";
  if (!S.admin.loaded) { $("adminTable").innerHTML = ""; return; }
  if (!rows.length) { $("adminTable").innerHTML = '<p class="muted">沒有符合的選手。</p>'; return; }
  $("adminTable").innerHTML = '<table class="tbl"><thead><tr><th>選手</th><th>信箱</th><th>已繳題數</th><th>整份完成</th><th>最近繳交</th><th></th></tr></thead><tbody>' +
    rows.map(r => '<tr><td class="wrap">' + esc(personName(r.p)) + (r.p.role === "admin" ? ' <span class="tag admin">管理員</span>' : "") + "</td><td class=\"wrap\">" + esc(r.p.email || "") + '</td><td class="num">' + r.n + " / " + YEARS * 2 * QN + '</td><td class="num">' + r.full + " / " + YEARS * 2 + '</td><td class="num">' + (r.last ? fmtTime(r.last) : "—") + '</td><td><a class="btn" href="#admin/' + esc(r.p.id) + '">查看</a></td></tr>').join("") +
    "</tbody></table>";
}
$("adminSearch").addEventListener("input", e => { S.admin.q = e.target.value; renderAdmin(); });
$("adminRefresh").addEventListener("click", async () => { await ensureAdminData(true); renderAdmin(); if (S.admin.detailUid) openDetail(S.admin.detailUid); toast("已更新"); });
$("cfgForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = parseInt($("cfgYear").value, 10);
  if (!(v >= 50 && v <= 200)) { toast("請輸入 50 到 200 之間的年度。"); return; }
  try { await api.setStartYear(v); S.startYear = v; S.bankPicked = false; renderBank(); renderAdmin(); toast("已更新起始年度"); }
  catch (err) { toast("儲存失敗：" + humanErr(err)); }
});

function openDetail(uid) {
  const p = S.admin.profiles.find(x => x.id === uid);
  if (!p) { $("dName").textContent = "找不到這位使用者"; $("dEmail").textContent = ""; $("dStats").innerHTML = ""; $("dBody").innerHTML = ""; $("dSlip").innerHTML = ""; return; }
  if (S.admin.detailUid !== uid) { S.admin.detailUid = uid; S.admin.sel = setKey(S.startYear + YEARS - 1, "o"); }
  const items = toItems(subsOf(uid));
  $("dName").textContent = personName(p);
  $("dEmail").textContent = p.email || "";
  $("dStats").innerHTML = statsHtml(items);
  $("dBody").innerHTML = tableHtml(items, S.admin.sel);
  $("dSlip").innerHTML = slipHtml(items, S.admin.sel, true);
}
$("dBody").addEventListener("click", e => {
  const b = e.target.closest("[data-set]"); if (!b) return;
  S.admin.sel = b.dataset.set; openDetail(S.admin.detailUid);
  if (window.matchMedia("(max-width:899px)").matches) $("dSlip").scrollIntoView({ block: "start" });
});
$("dSlip").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) fileAction(b); });

/* ================= 啟動 ================= */
async function boot() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) { showOnly("setup"); return; }
  if (!window.supabase) {
    $("setup").querySelector("h2").textContent = "無法載入登入程式";
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
