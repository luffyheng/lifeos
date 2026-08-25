const cfg = window.LIFE_AGENT_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
let session = restoreSessionFromUrl() || readJson("life-agent-session");
let installPrompt = null;
let healthRows = [];
const identity = session?.access_token ? decodeJwt(session.access_token) : null;
if (session && identity) session.user = { id:identity.sub, email:identity.email || session.user?.email || "已登录" };

const storageKey = session?.user?.id ? `life-agent-user-${session.user.id}` : "life-agent-guest-v2";
const state = { messages:[], memories:[], goals:[], ...readJson(storageKey) };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const persist = () => localStorage.setItem(storageKey, JSON.stringify(state));

function init() {
  initTheme();
  initInstall();
  updateAccountUi();
  ensureSession().then(updateAccountUi);
  renderMessages();
  bindEvents();
  setTodayDate();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function bindEvents() {
  $$('[data-action="open-settings"]').forEach(button => button.addEventListener("click", () => $("#settings-dialog").showModal()));
  $('[data-action="close-settings"]').addEventListener("click", () => $("#settings-dialog").close());
  $$('[data-prompt]').forEach(button => button.addEventListener("click", () => usePrompt(button.dataset.prompt)));
  $("#composer").addEventListener("submit", sendMessage);
  $("#message-input").addEventListener("input", resizeComposer);
  $("#message-input").addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); $("#composer").requestSubmit(); } });
  $("#new-chat").addEventListener("click", newChat);
  $("#brand-button").addEventListener("click", showChat);
  $("#health-link").addEventListener("click", showHealth);
  $("#health-back").addEventListener("click", showChat);
  $("#health-form").addEventListener("submit", saveHealthCheckin);
  $("#energy-score").addEventListener("input", event => $("#energy-output").textContent=event.target.value);
  $("#mood-score").addEventListener("input", event => $("#mood-output").textContent=event.target.value);
  $("#collapse-sidebar").addEventListener("click", () => document.body.classList.add("sidebar-collapsed"));
  $("#open-sidebar").addEventListener("click", () => window.innerWidth <= 700 ? document.body.classList.add("sidebar-open") : document.body.classList.remove("sidebar-collapsed"));
  $("#close-sidebar").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#theme-toggle-side").addEventListener("click", toggleTheme);
  $("#theme-select").addEventListener("change", event => setThemePreference(event.target.value));
  $("#auth-form").addEventListener("submit", authenticate);
  $("#signup-button").addEventListener("click", signUp);
  $("#password-form").addEventListener("submit", setPassword);
  $("#signout-button").addEventListener("click", signOut);
  $("#install-app").addEventListener("click", installApp);
  $("#install-app-settings").addEventListener("click", installApp);
}

function initInstall() {
  hideInstallControls();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) { document.body.classList.add("standalone"); return; }
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isiOS) showInstallControls("在 Safari 点分享，然后选择“添加到主屏幕”");
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); installPrompt = event; showInstallControls("安装到主屏幕，像原生 App 一样打开");
  });
  window.addEventListener("appinstalled", () => { installPrompt = null; hideInstallControls(); });
}

function showInstallControls(detail) { $("#install-app").hidden=false; $("#install-setting").hidden=false; $("#install-detail").textContent=detail; }
function hideInstallControls() { $("#install-app").hidden=true; $("#install-setting").hidden=true; }
async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    hideInstallControls();
    return;
  }
  alert("iPhone / iPad：请使用 Safari 打开，点底部分享按钮，再选择“添加到主屏幕”。");
}

function initTheme() {
  const preference = localStorage.getItem("life-agent-theme") || "system";
  $("#theme-select").value = preference;
  applyTheme(preference);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if ((localStorage.getItem("life-agent-theme") || "system") === "system") applyTheme("system"); });
}

function setThemePreference(preference) { localStorage.setItem("life-agent-theme", preference); applyTheme(preference); }
function applyTheme(preference) {
  const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#212121" : "#ffffff";
  $("#theme-toggle").textContent = dark ? "☀" : "☾";
  $("#theme-icon-side").textContent = dark ? "☀" : "☾";
  $("#theme-label-side").textContent = dark ? "浅色模式" : "深色模式";
}
function toggleTheme() { setThemePreference(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); $("#theme-select").value = localStorage.getItem("life-agent-theme"); }

function updateAccountUi() {
  const signedIn = Boolean(session?.access_token);
  const email = session?.user?.email || "私人空间已连接";
  $("#connection-status").textContent = signedIn ? "已连接" : "未登录";
  $("#profile-name").textContent = signedIn ? email : "你的空间";
  $("#dialog-status").textContent = signedIn ? "已登录" : "未登录";
  $("#dialog-status-detail").textContent = signedIn ? email : "连接后启用私人记忆与跨设备同步";
  $("#auth-form").hidden = signedIn || !configured;
  $("#password-form").hidden = !signedIn;
  $("#signout-button").hidden = !signedIn;
  $("#health-login").hidden = signedIn;
  $("#health-content").hidden = !signedIn;
}

function showChat() {
  $("#chat-view").hidden=false;
  $("#health-view").hidden=true;
  $("#health-link").classList.remove("active");
  $("#page-title").innerHTML='Life Agent <span>⌄</span>';
  document.body.classList.remove("sidebar-open");
  $("#message-input").focus();
}

async function showHealth() {
  $("#chat-view").hidden=true;
  $("#health-view").hidden=false;
  $("#health-link").classList.add("active");
  $("#page-title").textContent="健康";
  document.body.classList.remove("sidebar-open");
  updateAccountUi();
  if (await ensureSession()) await loadHealthData();
}

function setTodayDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,10);
  $("#health-date").value = local;
}

function usePrompt(type) {
  const prompts = {
    daily:"我想记录一下今天发生的事。",
    weekly:"帮我回顾这一周，找出值得继续和需要调整的地方。",
    decision:"我有一个决定还没想清楚，请帮我拆解。"
  };
  $("#message-input").value = prompts[type];
  resizeComposer({ target:$("#message-input") });
  $("#message-input").focus();
}

function newChat() {
  showChat();
  if (state.messages.length && !confirm("开始新对话？当前对话仍会保存在你的私人记录里。")) return;
  state.messages = [];
  persist();
  renderMessages();
  $("#message-input").focus();
  document.body.classList.remove("sidebar-open");
}

async function sendMessage(event) {
  event.preventDefault();
  const input = $("#message-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = ""; resizeComposer({ target:input });
  state.messages.push({ role:"user", content:text, created_at:new Date().toISOString() });
  persist(); renderMessages(); addTyping(); scrollChat();
  $(".send").disabled = true;
  try {
    const activeSession = await ensureSession();
    const result = activeSession ? await askEdgeFunction(text) : await demoReply(text);
    state.messages.push({ role:"assistant", content:result.assistant, tags:result.tags || [], created_at:new Date().toISOString() });
    for (const memory of result.memories || []) if (!state.memories.includes(memory)) state.memories.unshift(memory);
    state.memories = state.memories.slice(0, 20);
  } catch (error) {
    state.messages.push({ role:"assistant", content:`暂时连不上你的 Life Agent。请稍后再试。\n\n${error.message}`, tags:[] });
  } finally {
    $(".send").disabled = false; persist(); renderMessages(); scrollChat();
  }
}

async function askEdgeFunction(message) {
  let activeSession = await ensureSession();
  if (!activeSession) throw new Error("登录已过期，请在设置中重新登录");
  let response = await requestEdgeFunction(message, activeSession.access_token);
  if (response.status === 401) {
    activeSession = await ensureSession(true);
    if (!activeSession) throw new Error("登录已过期，请在设置中重新登录");
    response = await requestEdgeFunction(message, activeSession.access_token);
  }
  if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || "服务暂时不可用");
  return response.json();
}

function requestEdgeFunction(message, accessToken) {
  return fetch(`${cfg.supabaseUrl}/functions/v1/${cfg.edgeFunctionName || "life-agent"}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", apikey:cfg.supabaseAnonKey, Authorization:`Bearer ${accessToken}` },
    body:JSON.stringify({ message, recent_messages:state.messages.slice(-10), context:{ memories:state.memories, goals:state.goals } })
  });
}

async function ensureSession(forceRefresh=false) {
  if (!session?.access_token) return null;
  const claims = decodeJwt(session.access_token) || {};
  const expiresAt = Number(session.expires_at) || Number(claims.exp || 0) * 1000;
  const normalizedExpiry = expiresAt > 0 && expiresAt < 100000000000 ? expiresAt * 1000 : expiresAt;
  if (!forceRefresh && normalizedExpiry > Date.now() + 60000) return session;
  if (!session.refresh_token || !configured) { clearSession(); return null; }
  try {
    const response = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", apikey:cfg.supabaseAnonKey },
      body:JSON.stringify({ refresh_token:session.refresh_token })
    });
    if (!response.ok) { clearSession(); return null; }
    const refreshed = await response.json();
    const refreshedClaims = decodeJwt(refreshed.access_token) || {};
    session = {
      access_token:refreshed.access_token,
      refresh_token:refreshed.refresh_token || session.refresh_token,
      expires_at:Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      user:{ id:refreshed.user?.id || refreshedClaims.sub, email:refreshed.user?.email || refreshedClaims.email || session.user?.email || "已登录" }
    };
    localStorage.setItem("life-agent-session", JSON.stringify(session));
    updateAccountUi();
    return session;
  } catch {
    return session;
  }
}

function clearSession() {
  session = null;
  localStorage.removeItem("life-agent-session");
  updateAccountUi();
}

async function demoReply() {
  await new Promise(resolve => setTimeout(resolve, 500));
  return { assistant:"你目前还没有登录。打开右上角设置，用邮箱登录后就能开始和你的私人 Life Agent 对话。", tags:[], memories:[] };
}

function addTyping() {
  const typing = document.createElement("div");
  typing.className = "message assistant"; typing.id = "typing";
  typing.innerHTML = '<div class="message-content"><div class="assistant-head"><span class="assistant-mark">L</span>Life Agent</div><span class="typing"><i></i><i></i><i></i></span></div>';
  $("#messages").append(typing);
}

function renderMessages() {
  const hasMessages = state.messages.length > 0;
  $("#empty-state").hidden = hasMessages;
  $("#suggestions").hidden = hasMessages;
  $("#current-chat-title").textContent = hasMessages ? state.messages.find(message => message.role === "user")?.content.slice(0,32) || "新的对话" : "新的对话";
  $("#messages").innerHTML = state.messages.map(message => `<div class="message ${message.role}"><div class="message-content">${message.role === "assistant" ? '<div class="assistant-head"><span class="assistant-mark">L</span>Life Agent</div>' : ""}${message.role === "assistant" ? renderMarkdown(message.content) : escapeHtml(message.content)}${message.tags?.length ? `<div class="tags">${message.tags.map(tag=>`<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`:""}</div></div>`).join("");
}

async function supabaseRequest(path, options={}) {
  let activeSession = await ensureSession();
  if (!activeSession) throw new Error("请先登录");
  const request = token => fetch(`${cfg.supabaseUrl}${path}`, { ...options, headers:{ apikey:cfg.supabaseAnonKey, Authorization:`Bearer ${token}`, ...(options.headers || {}) } });
  let response = await request(activeSession.access_token);
  if (response.status === 401) {
    activeSession = await ensureSession(true);
    if (!activeSession) throw new Error("登录已过期，请重新登录");
    response = await request(activeSession.access_token);
  }
  return response;
}

async function loadHealthData() {
  $("#health-status").textContent="正在同步…";
  try {
    const response = await supabaseRequest("/rest/v1/daily_checkins?select=checkin_date,energy,mood,sleep_hours,exercise_minutes,note&order=checkin_date.desc&limit=7");
    if (!response.ok) throw new Error((await response.json().catch(()=>({}))).message || "无法读取健康资料");
    healthRows = await response.json();
    renderHealth();
    $("#health-status").textContent="";
  } catch (error) {
    $("#health-status").textContent=error.message;
  }
}

async function saveHealthCheckin(event) {
  event.preventDefault();
  const activeSession = await ensureSession();
  if (!activeSession) { $("#settings-dialog").showModal(); return; }
  const valueOrNull = id => $(id).value === "" ? null : Number($(id).value);
  const body = {
    user_id:activeSession.user.id,
    checkin_date:$("#health-date").value,
    sleep_hours:valueOrNull("#sleep-hours"),
    energy:valueOrNull("#energy-score"),
    mood:valueOrNull("#mood-score"),
    exercise_minutes:valueOrNull("#exercise-minutes"),
    note:$("#health-note").value.trim() || null,
    updated_at:new Date().toISOString()
  };
  $("#health-status").textContent="正在保存…";
  try {
    const response = await supabaseRequest("/rest/v1/daily_checkins?on_conflict=user_id,checkin_date", { method:"POST", headers:{ "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=representation" }, body:JSON.stringify(body) });
    if (!response.ok) throw new Error((await response.json().catch(()=>({}))).message || "保存失败");
    $("#health-status").textContent="已安全保存到你的私人账号";
    await loadHealthData();
  } catch (error) { $("#health-status").textContent=error.message; }
}

function renderHealth() {
  const today = $("#health-date").value;
  const latest = healthRows.find(row => row.checkin_date === today) || healthRows[0];
  $("#health-sleep").textContent=latest?.sleep_hours ?? "—";
  $("#health-energy").textContent=latest?.energy ?? "—";
  $("#health-mood").textContent=latest?.mood ?? "—";
  $("#health-exercise").textContent=latest?.exercise_minutes ?? "—";
  if (latest?.checkin_date === today) {
    $("#sleep-hours").value=latest.sleep_hours ?? "";
    $("#energy-score").value=latest.energy ?? 5; $("#energy-output").textContent=$("#energy-score").value;
    $("#mood-score").value=latest.mood ?? 5; $("#mood-output").textContent=$("#mood-score").value;
    $("#exercise-minutes").value=latest.exercise_minutes ?? "";
    $("#health-note").value=latest.note ?? "";
  }
  const rows = [...healthRows].reverse();
  $("#health-chart").innerHTML = rows.length ? rows.map(row => `<div class="trend-day"><div class="trend-bars"><i class="energy-bar" style="height:${(row.energy || 0)*10}%" title="能量 ${row.energy ?? '—'}"></i><i class="mood-bar" style="height:${(row.mood || 0)*10}%" title="心情 ${row.mood ?? '—'}"></i></div><span>${formatDay(row.checkin_date)}</span></div>`).join("") : '<div class="health-empty">还没有记录。保存今天后，趋势会出现在这里。</div>';
}

function formatDay(value) { const [,month,day]=value.split("-"); return `${Number(month)}/${Number(day)}`; }

async function authenticate(event) {
  event.preventDefault();
  if (!configured || session) return;
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  if (!email || password.length < 8) { showAuthStatus("无法登录", "请输入 Email 和至少 8 位密码"); return; }
  showAuthStatus("登录中", email);
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, { method:"POST", headers:{ "Content-Type":"application/json", apikey:cfg.supabaseAnonKey }, body:JSON.stringify({ email, password }) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) { showAuthStatus("登录失败", data.error_description || data.msg || "账号或密码不正确"); return; }
  saveAuthSession(data); location.reload();
}

async function signUp() {
  if (!configured || session) return;
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  if (!email || password.length < 8) { showAuthStatus("无法注册", "请输入 Email 和至少 8 位密码"); return; }
  showAuthStatus("注册中", email);
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1/signup`, { method:"POST", headers:{ "Content-Type":"application/json", apikey:cfg.supabaseAnonKey }, body:JSON.stringify({ email, password }) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) { showAuthStatus("注册失败", data.error_description || data.msg || "请检查账号资料"); return; }
  if (data.access_token) { saveAuthSession(data); location.reload(); return; }
  showAuthStatus("注册成功", "请完成 Email 验证，然后使用密码登录");
}

async function setPassword(event) {
  event.preventDefault();
  const password = $("#new-password").value;
  if (password.length < 8) { showAuthStatus("无法保存", "密码至少需要 8 位"); return; }
  const activeSession = await ensureSession();
  if (!activeSession) { showAuthStatus("登录已过期", "请重新登录后再设置密码"); return; }
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { method:"PUT", headers:{ "Content-Type":"application/json", apikey:cfg.supabaseAnonKey, Authorization:`Bearer ${activeSession.access_token}` }, body:JSON.stringify({ password }) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) { showAuthStatus("保存失败", data.msg || data.error_description || "请换一个更安全的密码"); return; }
  $("#password-form").reset();
  showAuthStatus("密码已建立", "以后可以直接使用 Email + 密码登录");
}

function saveAuthSession(data) {
  const claims = decodeJwt(data.access_token) || {};
  session = { access_token:data.access_token, refresh_token:data.refresh_token, expires_at:Date.now()+Number(data.expires_in || 3600)*1000, user:{ id:data.user?.id || claims.sub, email:data.user?.email || claims.email || "已登录" } };
  localStorage.setItem("life-agent-session", JSON.stringify(session));
}

function showAuthStatus(title, detail) { $("#dialog-status").textContent=title; $("#dialog-status-detail").textContent=detail; }

async function signOut() {
  if (session?.access_token) await fetch(`${cfg.supabaseUrl}/auth/v1/logout`, { method:"POST", headers:{ apikey:cfg.supabaseAnonKey, Authorization:`Bearer ${session.access_token}` } }).catch(()=>{});
  localStorage.removeItem("life-agent-session"); location.reload();
}

function restoreSessionFromUrl() {
  if (!location.hash.includes("access_token=")) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const access_token = params.get("access_token"); if (!access_token) return null;
  const claims = decodeJwt(access_token) || {};
  const value = { access_token, refresh_token:params.get("refresh_token"), expires_at:Date.now()+Number(params.get("expires_in")||3600)*1000, user:{ id:claims.sub, email:claims.email || "已登录" } };
  localStorage.setItem("life-agent-session", JSON.stringify(value));
  history.replaceState(null,"",location.pathname+location.search);
  return value;
}

function decodeJwt(token) { try { return JSON.parse(decodeURIComponent(escape(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))))); } catch { return null; } }
function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch { return {}; } }
function escapeHtml(value) { const div=document.createElement("div"); div.textContent=value; return div.innerHTML; }
function renderMarkdown(value) { return escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>").replace(/`([^`\n]+)`/g,"<code>$1</code>"); }
function resizeComposer(event) { const el=event.target; el.style.height="auto"; el.style.height=`${Math.min(el.scrollHeight,160)}px`; }
function scrollChat() { requestAnimationFrame(() => $("#chat-scroll").scrollTo({ top:$("#chat-scroll").scrollHeight, behavior:"smooth" })); }

init();

