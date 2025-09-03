// javascript/propostas.js
const PROPOSTAS_DB =
  "https://proposta-shelf-distribuidora-default-rtdb.firebaseio.com";

// ---------- utils ----------
function onlyDigits(s = "") {
  return String(s).replace(/\D/g, "");
}
function fmtBRL(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}
function badge(status) {
  const s = String(status || "").toLowerCase();
  const base =
    "display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;";
  if (s === "rascunho") return `${base}background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;`;
  if (s === "enviado")  return `${base}background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe;`;
  if (s === "aprovado") return `${base}background:#d1fae5;color:#065f46;border:1px solid #a7f3d0;`;
  if (s === "reprovado")return `${base}background:#fee2e2;color:#991b1b;border:1px solid #fecaca;`;
  return `${base}background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff;`;
}

// ---------- vendedor (mesma lógica do carrinho) ----------
function getVendedorFromLS() {
  try {
    const raw = localStorage.getItem("usuario_shelf");
    if (!raw) return null;
    const data = JSON.parse(raw);

    // formato 1: { id, tipo, usuario, cpf? }
    if (data && typeof data === "object" && ("id" in data || "tipo" in data || "usuario" in data)) {
      return {
        id: data.id ?? null,
        nome: data.usuario ?? null,
        tipo: data.tipo ?? null,
        cpfKey: data.cpf ? onlyDigits(data.cpf) : null,
      };
    }

    // formato 2: { "<cpf>": { id, tipo, usuario, ... } }
    const keys = Object.keys(data || {});
    if (keys.length) {
      const cpfKey = onlyDigits(keys[0]);
      const v = data[cpfKey] || {};
      return {
        id: v.id ?? null,
        nome: v.usuario ?? null,
        tipo: v.tipo ?? null,
        cpfKey: cpfKey || null,
      };
    }
  } catch {}
  return null;
}
const VENDEDOR = getVendedorFromLS();

function sanitizeKey(k = "") {
  // RTDB não aceita . $ # [ ] /
  return String(k).replace(/[.$#[\]/]/g, "_").trim();
}
function buildVendorKey(v = VENDEDOR) {
  if (!v) return null;
  const raw = (v.id ?? null) ?? (v.cpfKey ?? null) ?? (v.nome ?? null);
  const s = sanitizeKey(String(raw ?? "").trim());
  return s || null;
}

// ---------- REST helpers ----------
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return res.json();
}

// novo esquema: propostas/<vendedorKey>.json
function buildNestedUrl(vendedorKey) {
  return `${PROPOSTAS_DB}/propostas/${encodeURIComponent(vendedorKey)}.json`;
}

// legado (flat): /propostas.json?orderBy="vendedor/cpfKey"&equalTo="..."
function buildLegacyFilterUrl() {
  const base = `${PROPOSTAS_DB}/propostas.json`;
  // prioriza cpfKey se existir
  if (VENDEDOR?.cpfKey) {
    const orderBy = encodeURIComponent('"vendedor/cpfKey"');
    const equalTo = encodeURIComponent(`"${VENDEDOR.cpfKey}"`);
    return `${base}?orderBy=${orderBy}&equalTo=${equalTo}`;
  }
  // tenta por id (pode ter sido salvo como número ou string)
  if (VENDEDOR?.id !== undefined && VENDEDOR?.id !== null) {
    const orderBy = encodeURIComponent('"vendedor/id"');
    const asNumber = Number(VENDEDOR.id);
    const isNumber = Number.isFinite(asNumber);
    const equalTo = encodeURIComponent(isNumber ? String(asNumber) : `"${String(VENDEDOR.id)}"`);
    return `${base}?orderBy=${orderBy}&equalTo=${equalTo}`;
  }
  // último recurso (evite em bases grandes)
  return base;
}

// ---------- UI ----------
function mountRow(p) {
  const c = p?.clienteSnapshot || {};
  const total = p?.totais?.total ?? 0;
  const qtd = Array.isArray(p?.itens) ? p.itens.length : 0;

  const linha = document.createElement("div");
  linha.style.display = "grid";
  linha.style.gridTemplateColumns = "3fr 2fr 2fr 2fr 1fr";
  linha.style.gap = "8px";
  linha.style.padding = "10px 12px";
  linha.style.borderTop = "1px solid #e0e4e7";
  linha.style.alignItems = "center";

  const colCliente = document.createElement("div");
  const nm = document.createElement("div");
  nm.textContent = c?.nome || "—";
  nm.style.fontWeight = "600";
  nm.style.color = "#111827";
  const em = document.createElement("div");
  em.textContent = c?.email || "";
  em.style.fontSize = "12px";
  em.style.color = "#6b7280";
  colCliente.appendChild(nm);
  colCliente.appendChild(em);

  const colCpf = document.createElement("div");
  colCpf.textContent = c?.cpfCnpj || "—";
  colCpf.style.color = "#374151";

  const colData = document.createElement("div");
  colData.textContent = fmtDate(p?.createdAt);

  const colTotal = document.createElement("div");
  colTotal.textContent = fmtBRL(total);
  colTotal.style.fontWeight = "700";
  colTotal.style.color = "#111827";

  const colItens = document.createElement("div");
  colItens.textContent = String(qtd);
  colItens.style.textAlign = "right";

  const st = document.createElement("span");
  st.setAttribute("style", badge(p?.status));
  st.textContent = p?.status || "—";
  st.style.marginLeft = "6px";
  nm.appendChild(st);

  linha.appendChild(colCliente);
  linha.appendChild(colCpf);
  linha.appendChild(colData);
  linha.appendChild(colTotal);
  linha.appendChild(colItens);

  return linha;
}

// ---------- módulo ----------
export function init(rootMainEl) {
  const buscaEl  = document.getElementById("pp-busca");
  const statusEl = document.getElementById("pp-status");
  const corpoEl  = document.getElementById("pp-corpo");
  const vazioEl  = document.getElementById("pp-vazio");
  const erroEl   = document.getElementById("pp-erro");

  let baseData = [];

  async function load() {
    try {
      if (erroEl)  erroEl.style.display = "none";
      if (vazioEl) vazioEl.style.display = "none";
      if (corpoEl) corpoEl.innerHTML = '<div style="padding:14px;color:#6b7280;">Carregando…</div>';

      let loaded = [];
      const vendedorKey = buildVendorKey(VENDEDOR);

      // 1) tenta novo layout
      if (vendedorKey) {
        const nestedUrl = buildNestedUrl(vendedorKey);
        console.debug("[propostas] nestedUrl:", nestedUrl);
        const nested = await fetchJSON(nestedUrl); // { autoId: {...} } | null
        if (nested && typeof nested === "object") {
          loaded = Object.entries(nested).map(([key, v]) => ({ key, ...v }));
        }
      } else {
        console.warn("[propostas] vendedorKey ausente; pulando leitura aninhada");
      }

      // 2) fallback legado (se não achou nada no novo nó)
      if (!loaded.length) {
        const legacyUrl = buildLegacyFilterUrl();
        console.debug("[propostas] legacyUrl:", legacyUrl);
        const data = await fetchJSON(legacyUrl); // { autoId: {...} } | null
        if (data && typeof data === "object") {
          loaded = Object.entries(data).map(([key, v]) => ({ key, ...v }));
        }
      }

      // ordena por data desc
      baseData = (loaded || []).sort((a, b) => {
        const da = new Date(a.createdAt).getTime() || 0;
        const db = new Date(b.createdAt).getTime() || 0;
        return db - da;
      });

      render();
    } catch (e) {
      if (corpoEl) corpoEl.innerHTML = "";
      if (erroEl) {
        erroEl.textContent = e?.message || "Falha ao carregar propostas.";
        erroEl.style.display = "block";
      }
      console.error("[propostas] erro load:", e);
    }
  }

  function render() {
    const term = (buscaEl?.value || "").trim().toLowerCase();
    const st = (statusEl?.value || "todos").toLowerCase();

    const view = baseData.filter((p) => {
      const okStatus = st === "todos" || String(p.status || "").toLowerCase() === st;
      if (!okStatus) return false;
      if (!term) return true;
      const c = p?.clienteSnapshot || {};
      const blob = [
        c?.nome, c?.cpfCnpj, c?.email,
        p?.vendedor?.nome, p?.vendedor?.cpfKey
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(term);
    });

    if (!corpoEl) return;

    corpoEl.innerHTML = "";
    if (view.length === 0) {
      if (vazioEl) vazioEl.style.display = "block";
      return;
    }
    if (vazioEl) vazioEl.style.display = "none";
    view.forEach((p) => corpoEl.appendChild(mountRow(p)));
  }

  // listeners
  if (buscaEl)  buscaEl.addEventListener("input", render);
  if (statusEl) statusEl.addEventListener("change", render);

  // carrega ao entrar na página
  load();

  // cleanup opcional
  return () => {
    if (buscaEl)  buscaEl.removeEventListener("input", render);
    if (statusEl) statusEl.removeEventListener("change", render);
  };
}
