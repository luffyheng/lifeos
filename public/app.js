const cfg = window.LIFE_AGENT_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
let session = restoreSessionFromUrl() || readJson("life-agent-session");
let installPrompt = null;
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
  renderMessages();
  bindEvents();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function bindEvents() {
  $$('[data-action="open-settings"]').forEach(button => button.addEventListener("click", () => $("#settings-dialog").showModal()));
  $('[data-action="close-settings"]').addEventListener("click", () => $("#settings-dialog").close());
  $$('[data-prompt]').forEach(button => button.addEventListener("click", () => usePrompt(button.dataset.prompt)));
  $("#composer").addEventListener("submit", sendMessage);
  $("#message-input").addEventListener("input", resizeComposer);
  $("#message-input").addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("#composer").requestSubmit(); } });
  $("#new-chat").addEventListener("click", newChat);
  $("#brand-button").addEventListener("click", () => $("#message-input").focus());
  $("#collapse-sidebar").addEventListener("click", () => document.body.classList.add("sidebar-collapsed"));
  $("#open-sidebar").addEventListener("click", () => window.innerWidth <= 700 ? document.body.classList.add("sidebar-open") : document.body.classList.remove("sidebar-collapsed"));
  $("#close-sidebar").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#theme-toggle-side").addEventListener("click", toggleTheme);
  $("#theme-select").addEventListener("change", event => setThemePreference(event.target.value));
  $("#auth-form").addEventListener("submit", authenticate);
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
  $("#signout-button").hidden = !signedIn;
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
    const result = session?.access_token ? await askEdgeFunction(text) : await demoReply(text);
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
  const response = await fetch(`${cfg.supabaseUrl}/functions/v1/${cfg.edgeFunctionName || "life-agent"}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", apikey:cfg.supabaseAnonKey, Authorization:`Bearer ${session.access_token}` },
    body:JSON.stringify({ message, recent_messages:state.messages.slice(-10), context:{ memories:state.memories, goals:state.goals } })
  });
  if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || "服务暂时不可用");
  return response.json();
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
  $("#messages").innerHTML = state.messages.map(message => `<div class="message ${message.role}"><div class="message-content">${message.role === "assistant" ? '<div class="assistant-head"><span class="assistant-mark">L</span>Life Agent</div>' : ""}${escapeHtml(message.content)}${message.tags?.length ? `<div class="tags">${message.tags.map(tag=>`<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`:""}</div></div>`).join("");
}

async function authenticate(event) {
  event.preventDefault();
  if (!configured || session) return;
  const email = $("#auth-email").value.trim(); if (!email) return;
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1/otp`, { method:"POST", headers:{ "Content-Type":"application/json", apikey:cfg.supabaseAnonKey }, body:JSON.stringify({ email, options:{ emailRedirectTo:location.origin } }) });
  $("#dialog-status").textContent = response.ok ? "链接已发送" : "发送失败";
  $("#dialog-status-detail").textContent = response.ok ? `请到 ${email} 查收` : "请检查邮箱或稍后再试";
}

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
function resizeComposer(event) { const el=event.target; el.style.height="auto"; el.style.height=`${Math.min(el.scrollHeight,160)}px`; }
function scrollChat() { requestAnimationFrame(() => $("#chat-scroll").scrollTo({ top:$("#chat-scroll").scrollHeight, behavior:"smooth" })); }

init();
