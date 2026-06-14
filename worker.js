// Dash Lala — Cloudflare Worker (ponte segura entre o front-end e o Coda)
//
// Variáveis/segredos que este Worker espera (configurados no Cloudflare, NÃO no código):
//   CODA_TOKEN     -> (Secret) token da API do Coda. NUNCA colocar no código.
//   CODA_DOC_ID    -> (Variable) id do doc no Coda. Ex: "dQfJPjC9o8G"
//   APP_KEY        -> (Secret) senha/chave que o front-end envia para provar que é você.
//   ALLOWED_ORIGIN -> (Variable, opcional) origem do front-end. Ex: "https://seuusuario.github.io"
//                     Se vazio, libera qualquer origem (a APP_KEY ainda protege).
//
// Endpoints (todos exigem o header  X-App-Key: <APP_KEY>):
//   GET    /tables/:tabela/rows                -> lista linhas (aceita ?query=Col:"valor"&limit=50)
//   POST   /tables/:tabela/rows   {rows:[{Coluna:valor,...}]}   -> insere linha(s)
//   PUT    /tables/:tabela/rows/:rowId  {fields:{Coluna:valor}} -> edita uma linha
//   DELETE /tables/:tabela/rows/:rowId        -> apaga uma linha
//
// "tabela" pode ser o NOME (ex: Lançamentos) ou o id da tabela.

const CODA_BASE = "https://coda.io/apis/v1";

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";

    // Pré-flight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // Autenticação: o front-end precisa mandar a APP_KEY
    if (!env.APP_KEY || request.headers.get("X-App-Key") !== env.APP_KEY) {
      return json({ error: "Não autorizado" }, 401, origin);
    }

    if (!env.CODA_TOKEN || !env.CODA_DOC_ID) {
      return json({ error: "Worker mal configurado (faltam CODA_TOKEN/CODA_DOC_ID)" }, 500, origin);
    }

    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean); // ex: ["tables","Lançamentos","rows","r-123"]

      if (parts[0] !== "tables" || parts[2] !== "rows") {
        return json({ error: "Rota inválida" }, 404, origin);
      }

      const table = encodeURIComponent(decodeURIComponent(parts[1]));
      const rowId = parts[3] ? encodeURIComponent(parts[3]) : null;
      const base = `${CODA_BASE}/docs/${env.CODA_DOC_ID}/tables/${table}/rows`;
      const auth = { Authorization: `Bearer ${env.CODA_TOKEN}` };

      // ----- LISTAR -----
      if (request.method === "GET" && !rowId) {
        const qp = new URLSearchParams();
        qp.set("useColumnNames", "true");
        qp.set("valueFormat", "simpleWithArrays");
        if (url.searchParams.get("query")) qp.set("query", url.searchParams.get("query"));
        if (url.searchParams.get("limit")) qp.set("limit", url.searchParams.get("limit"));
        const r = await fetch(`${base}?${qp}`, { headers: auth });
        const data = await r.json();
        if (!r.ok) return json(data, r.status, origin);
        const rows = (data.items || []).map((i) => ({ id: i.id, createdAt: i.createdAt, ...i.values }));
        return json({ rows }, 200, origin);
      }

      // ----- INSERIR -----
      if (request.method === "POST" && !rowId) {
        const body = await request.json();
        const list = body.rows || [];
        const codaBody = {
          rows: list.map((r) => ({
            cells: Object.entries(r).map(([column, value]) => ({ column, value })),
          })),
        };
        const r = await fetch(base, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify(codaBody),
        });
        return json(await r.json(), r.status, origin);
      }

      // ----- EDITAR -----
      if (request.method === "PUT" && rowId) {
        const body = await request.json();
        const fields = body.fields || {};
        const codaBody = {
          row: { cells: Object.entries(fields).map(([column, value]) => ({ column, value })) },
        };
        const r = await fetch(`${base}/${rowId}`, {
          method: "PUT",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify(codaBody),
        });
        return json(await r.json(), r.status, origin);
      }

      // ----- APAGAR -----
      if (request.method === "DELETE" && rowId) {
        const r = await fetch(`${base}/${rowId}`, { method: "DELETE", headers: auth });
        return json(await r.json(), r.status, origin);
      }

      return json({ error: "Método não suportado" }, 405, origin);
    } catch (e) {
      return json({ error: String(e) }, 500, origin);
    }
  },
};

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}
