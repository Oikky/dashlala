// Dash Lala — Cloudflare Worker (multiusuário com login)
//
// Variáveis/segredos no Cloudflare:
//   CODA_TOKEN      (Secret)  token da API do Coda (sua conta; acessa todos os docs)
//   CODA_USERS_DOC  (Variable) id do doc-mestre que tem a tabela "Usuários"
//   USERS_TABLE     (Variable, opcional) nome da tabela de usuários (padrão: Usuários)
//   SESSION_SECRET  (Secret)  segredo p/ assinar a sessão (invente algo longo)
//   ADMIN_KEY       (Secret)  chave de administrador p/ criar usuários
//   ALLOWED_ORIGIN  (Variable) ex: https://oikky.github.io
//   CODA_DOC_ID     (Variable) doc padrão p/ a APP_KEY legada (seu widget)
//   APP_KEY         (Secret)   chave legada (cronômetro do PC) -> usa CODA_DOC_ID
//
// Tabela "Usuários" (no doc-mestre): colunas
//   Usuario (texto) | SenhaHash (texto) | Salt (texto) | DocId (texto) | Ativo (checkbox)
//
// Rotas:
//   POST /login                 {usuario,senha} -> {token}
//   POST /admin/setuser         (X-Admin-Key)   {usuario,senha,docId,ativo} -> cria/atualiza
//   GET/POST/PUT/DELETE /tables/:tabela/rows[/:id]   (Authorization: Bearer <token>  OU  X-App-Key legada)

const CODA = "https://coda.io/apis/v1";
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    try {
      const url = new URL(request.url);
      const p = url.pathname.split("/").filter(Boolean);
      if (p[0] === "login" && request.method === "POST") return await login(request, env, origin);
      if (p[0] === "admin" && p[1] === "setuser" && request.method === "POST") return await setuser(request, env, origin);
      if (p[0] === "tables") return await dataRoute(request, env, origin, p, url);
      return json({ error: "Rota inválida" }, 404, origin);
    } catch (e) {
      return json({ error: String(e) }, 500, origin);
    }
  },
};

// ---------- AUTH ----------
async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlDec(str) { return decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/")))); }
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
async function makeToken(env, payload) {
  const p = b64urlStr(JSON.stringify(payload));
  const s = await hmac(env.SESSION_SECRET, p);
  return p + "." + s;
}
async function verifyToken(env, token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [p, s] = token.split(".");
  if ((await hmac(env.SESSION_SECRET, p)) !== s) return null;
  try {
    const obj = JSON.parse(b64urlDec(p));
    if (obj.exp && Date.now() / 1000 > obj.exp) return null;
    return obj;
  } catch { return null; }
}

async function getUsers(env) {
  const tbl = encodeURIComponent(env.USERS_TABLE || "Usuários");
  const r = await fetch(`${CODA}/docs/${env.CODA_USERS_DOC}/tables/${tbl}/rows?useColumnNames=true&valueFormat=simple&limit=500`, {
    headers: { Authorization: `Bearer ${env.CODA_TOKEN}` },
  });
  const d = await r.json();
  return (d.items || []).map((i) => ({ id: i.id, ...i.values }));
}

async function login(request, env, origin) {
  const { usuario, senha } = await request.json();
  if (!usuario || !senha) return json({ error: "Informe usuário e senha" }, 400, origin);
  const users = await getUsers(env);
  const u = users.find((x) => String(x["Usuario"] || "").toLowerCase() === String(usuario).toLowerCase());
  if (!u || u["Ativo"] === false) return json({ error: "Usuário ou senha inválidos" }, 401, origin);
  const hash = await sha256hex((u["Salt"] || "") + senha);
  if (hash !== u["SenhaHash"]) return json({ error: "Usuário ou senha inválidos" }, 401, origin);
  const token = await makeToken(env, { u: u["Usuario"], doc: u["DocId"], exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 });
  return json({ token, usuario: u["Usuario"] }, 200, origin);
}

async function setuser(request, env, origin) {
  if (!env.ADMIN_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_KEY)
    return json({ error: "Não autorizado (admin)" }, 401, origin);
  const { usuario, senha, docId, ativo } = await request.json();
  if (!usuario || !senha || !docId) return json({ error: "usuario, senha e docId são obrigatórios" }, 400, origin);
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sha256hex(salt + senha);
  const tbl = encodeURIComponent(env.USERS_TABLE || "Usuários");
  const body = {
    rows: [{ cells: [
      { column: "Usuario", value: usuario },
      { column: "SenhaHash", value: hash },
      { column: "Salt", value: salt },
      { column: "DocId", value: docId },
      { column: "Ativo", value: ativo === false ? false : true },
    ] }],
    keyColumns: ["Usuario"],
  };
  const r = await fetch(`${CODA}/docs/${env.CODA_USERS_DOC}/tables/${tbl}/rows`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CODA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json(await r.json(), r.status, origin);
}

// ---------- DADOS ----------
async function dataRoute(request, env, origin, p, url) {
  // resolve docId
  let docId = null;
  const authz = request.headers.get("Authorization") || "";
  if (authz.indexOf("Bearer ") === 0) {
    const v = await verifyToken(env, authz.slice(7));
    if (!v) return json({ error: "Sessão inválida" }, 401, origin);
    docId = v.doc;
  } else if (env.APP_KEY && request.headers.get("X-App-Key") === env.APP_KEY) {
    docId = env.CODA_DOC_ID; // legado (cronômetro)
  } else {
    return json({ error: "Não autorizado" }, 401, origin);
  }
  if (!env.CODA_TOKEN || !docId) return json({ error: "Worker mal configurado" }, 500, origin);
  if (p[2] !== "rows") return json({ error: "Rota inválida" }, 404, origin);

  const table = encodeURIComponent(decodeURIComponent(p[1]));
  const rowId = p[3] ? encodeURIComponent(p[3]) : null;
  const base = `${CODA}/docs/${docId}/tables/${table}/rows`;
  const auth = { Authorization: `Bearer ${env.CODA_TOKEN}` };

  if (request.method === "GET" && !rowId) {
    const qp = new URLSearchParams({ useColumnNames: "true", valueFormat: "simpleWithArrays" });
    if (url.searchParams.get("query")) qp.set("query", url.searchParams.get("query"));
    if (url.searchParams.get("limit")) qp.set("limit", url.searchParams.get("limit"));
    const r = await fetch(`${base}?${qp}`, { headers: auth });
    const data = await r.json();
    if (!r.ok) return json(data, r.status, origin);
    return json({ rows: (data.items || []).map((i) => ({ id: i.id, createdAt: i.createdAt, ...i.values })) }, 200, origin);
  }
  if (request.method === "POST" && !rowId) {
    const body = await request.json();
    const codaBody = { rows: (body.rows || []).map((r) => ({ cells: Object.entries(r).map(([column, value]) => ({ column, value })) })) };
    const r = await fetch(base, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(codaBody) });
    return json(await r.json(), r.status, origin);
  }
  if (request.method === "PUT" && rowId) {
    const body = await request.json();
    const codaBody = { row: { cells: Object.entries(body.fields || {}).map(([column, value]) => ({ column, value })) } };
    const r = await fetch(`${base}/${rowId}`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(codaBody) });
    return json(await r.json(), r.status, origin);
  }
  if (request.method === "DELETE" && rowId) {
    const r = await fetch(`${base}/${rowId}`, { method: "DELETE", headers: auth });
    return json(await r.json(), r.status, origin);
  }
  return json({ error: "Método não suportado" }, 405, origin);
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Key, X-Admin-Key, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
