const PROPOSTAS_DB =
  "https://proposta-shelf-distribuidora-default-rtdb.firebaseio.com";

// ---------- utils ----------
function onlyDigits(s = "") { return String(s).replace(/\D/g, ""); }
function fmtBRL(n) { const v = Number(n) || 0; return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtDate(iso) { const d = new Date(iso); if (Number.isNaN(d.getTime())) return "—"; return d.toLocaleString("pt-BR"); }
function nowISO() { return new Date().toISOString(); }
function badge(status) {
  const s = String(status || "").toLowerCase();
  const base = "display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;";
  if (s === "rascunho") return `${base}background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;`;
  if (s === "enviado")  return `${base}background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe;`;
  if (s === "aprovado") return `${base}background:#d1fae5;color:#065f46;border:1px solid #a7f3d0;`;
  if (s === "reprovado")return `${base}background:#fee2e2;color:#991b1b;border:1px solid #fecaca;`;
  if (s === "pedido_em_aberto") return `${base}background:#fde68a;color:#92400e;border:1px solid #fcd34d;`;
  return `${base}background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff;`;
}
function sanitizeKey(k = "") { return String(k).replace(/[.$#[\]/]/g, "_").trim(); }
function qsParam(name) { const url = new URL(window.location.href); return url.searchParams.get(name); }

// ---------- vendedor ----------
function getVendedorFromLS() {
  try {
    const raw = localStorage.getItem("usuario_shelf");
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && ("id" in data || "tipo" in data || "usuario" in data)) {
      return { id: data.id ?? null, nome: data.usuario ?? null, tipo: data.tipo ?? null, cpfKey: data.cpf ? onlyDigits(data.cpf) : null };
    }
    const keys = Object.keys(data || {});
    if (keys.length) {
      const cpfKey = onlyDigits(keys[0]);
      const v = data[cpfKey] || {};
      return { id: v.id ?? null, nome: v.usuario ?? null, tipo: v.tipo ?? null, cpfKey: cpfKey || null };
    }
  } catch {}
  return null;
}
const VENDEDOR = getVendedorFromLS();
function buildVendorKey(v = VENDEDOR) {
  if (!v) return null;
  const raw = (v.id ?? null) ?? (v.cpfKey ?? null) ?? (v.nome ?? null);
  const s = sanitizeKey(String(raw ?? "").trim());
  return s || null;
}
function vendorKeyFromRecord(p) {
  const v = p?.vendedor || {};
  const raw = (v.id ?? null) ?? (v.cpfKey ?? null) ?? (v.nome ?? null);
  if (!raw) return null;
  return sanitizeKey(String(raw));
}

// ---------- REST helpers ----------
async function fetchJSON(url) { const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }
async function patchJSON(url, body) {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PATCH ${res.status}`); return res.json().catch(()=> ({}));
}
async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${res.status}`); return res.json();
}
async function deleteReq(url) { const res = await fetch(url, { method: "DELETE" }); if (!res.ok) throw new Error(`DELETE ${res.status}`); return true; }

// caminhos
function buildNestedUrl(vendedorKey) { return `${PROPOSTAS_DB}/propostas/${encodeURIComponent(vendedorKey)}.json`; }
function buildNestedItemUrl(vendedorKey, id) { return `${PROPOSTAS_DB}/propostas/${encodeURIComponent(vendedorKey)}/${encodeURIComponent(id)}.json`; }
function buildLegacyFilterUrl() {
  const base = `${PROPOSTAS_DB}/propostas.json`;
  if (VENDEDOR?.cpfKey) {
    const orderBy = encodeURIComponent('"vendedor/cpfKey"');
    const equalTo = encodeURIComponent(`"${VENDEDOR.cpfKey}"`);
    return `${base}?orderBy=${orderBy}&equalTo=${equalTo}`;
  }
  if (VENDEDOR?.id !== undefined && VENDEDOR?.id !== null) {
    const orderBy = encodeURIComponent('"vendedor/id"');
    const asNumber = Number(VENDEDOR.id);
    const isNumber = Number.isFinite(asNumber);
    const equalTo = encodeURIComponent(isNumber ? String(asNumber) : `"${String(VENDEDOR.id)}"`);
    return `${base}?orderBy=${orderBy}&equalTo=${equalTo}`;
  }
  return base;
}

// -------------------- Modal --------------------
function makeModal() {
  const modal = document.createElement("div");
  modal.id = "pp-modal";
  modal.style.cssText = `position: fixed; inset: 0; display:none; align-items:center; justify-content:center;background: rgba(0,0,0,.35); z-index: 9999;`;
  modal.innerHTML = `
    <div id="pp-modal-card" style="background:#fff; width:min(980px, 96vw); max-height:90vh; overflow:auto; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.25);">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e5e7eb;">
        <div style="display:flex; gap:10px; align-items:center">
          <h3 id="pp-modal-title" style="margin:0; font-size:18px;">Proposta</h3>
          <span id="pp-modal-status" style=""></span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="pp-btn-share"   class="pp-btn-sec">Compartilhar</button>
          <button id="pp-btn-pdf"     class="pp-btn-sec">Salvar PDF</button>
          <button id="pp-btn-print"   class="pp-btn-sec">Imprimir</button>
          <button id="pp-btn-clone"   class="pp-btn-sec">Clonar</button>
          <button id="pp-btn-delete"  class="pp-btn-danger">Excluir</button>
          <button id="pp-btn-edit-cart" class="pp-btn-primary">Editar no carrinho</button>
          <button id="pp-btn-close"   class="pp-btn-sec">Fechar</button>
        </div>
      </div>

      <div style="padding:14px 16px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:12px;">
          <div>
            <label class="pp-lb">Nome do cliente</label>
            <input id="pp-f-nome" class="pp-inp" type="text" placeholder="Ex.: Dra. Sabrina">
          </div>
          <div>
            <label class="pp-lb">Email</label>
            <input id="pp-f-email" class="pp-inp" type="email" placeholder="email@cliente.com">
          </div>
          <div>
            <label class="pp-lb">CPF/CNPJ</label>
            <input id="pp-f-doc" class="pp-inp" type="text" inputmode="numeric">
          </div>
          <div>
            <label class="pp-lb">Telefone</label>
            <input id="pp-f-tel" class="pp-inp" type="text" inputmode="tel">
          </div>
          <div>
            <label class="pp-lb">Status</label>
            <select id="pp-f-status" class="pp-inp">
              <option value="rascunho">Rascunho</option>
              <option value="enviado">Enviado</option>
              <option value="aprovado">Aprovado</option>
              <option value="reprovado">Reprovado</option>
              <option value="pedido_em_aberto">Pedido em aberto</option>
            </select>
          </div>
          <div>
            <label class="pp-lb">Desconto</label>
            <div style="display:flex; gap:10px; align-items:center;">
              <label style="display:flex;align-items:center;gap:6px;"><input type="radio" name="pp-desc-mode" value="item"> por item</label>
              <label style="display:flex;align-items:center;gap:6px;"><input type="radio" name="pp-desc-mode" value="global"> global</label>
              <input id="pp-f-desc-global" class="pp-inp" style="max-width:100px" type="text" placeholder="0,0"> %
            </div>
          </div>
        </div>

        <h4 style="margin:8px 0">Itens</h4>
        <div style="overflow:auto;">
          <table id="pp-items" class="pp-table">
            <thead>
              <tr>
                <th>Produto / SKU</th>
                <th style="width:90px;text-align:right">Qtd</th>
                <th style="width:130px;text-align:right">Preço (un)</th>
                <th style="width:120px;text-align:right">Desc. (%)</th>
                <th style="width:120px;text-align:right">Subtotal</th>
                <th style="width:80px"></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <button id="pp-btn-additem" class="pp-btn-sec" style="margin:8px 0;"></button>

        <div id="pp-totais" style="margin-top:8px; display:grid; gap:6px; justify-content:end;">
          <div>Subtotal (bruto): <b id="pp-subtotal">R$ 0,00</b></div>
          <div>Desconto: <b id="pp-desc">R$ 0,00</b></div>
          <div>Total: <b id="pp-total" style="font-size:18px">R$ 0,00</b></div>
        </div>

        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
          <button id="pp-btn-save" class="pp-btn-primary">Salvar alterações</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const style = document.createElement("style");
  style.textContent = `
    .pp-btn-sec { padding:8px 12px; border:1px solid #d1d5db; background:#fff; border-radius:8px; cursor:pointer; }
    .pp-btn-danger { padding:8px 12px; border:1px solid #fecaca; background:#fee2e2; color:#991b1b; border-radius:8px; cursor:pointer; }
    .pp-btn-primary { padding:10px 14px; border:none; background:#2563eb; color:#fff; border-radius:8px; cursor:pointer; font-weight:600; }
    .pp-lb { display:block; font-size:12px; color:#374151; margin:0 0 4px; }
    .pp-inp { width:100%; padding:8px 10px; border:1.5px solid #d1d5db; border-radius:8px; }
    .pp-table { width:100%; border-collapse:collapse; }
    .pp-table th, .pp-table td { border-top:1px solid #e5e7eb; padding:8px; text-align:left; vertical-align:top; }
    .pp-table input { width:100%; padding:6px 8px; border:1px solid #d1d5db; border-radius:6px; text-align:right; }
    .pp-prod { display:flex; gap:10px; align-items:flex-start; }
    .pp-thumb { width:42px; height:42px; object-fit:contain; background:#fff; border:1px solid #e5e7eb; border-radius:8px; flex:0 0 auto; }
    .pp-prod-info { min-width:0; }
    .pp-prod-nome { font-size:12px; color:#374151; line-height:1.25; margin-bottom:4px; }
    .pp-sku-inp { text-align:left !important; }
    @media (max-width: 760px) { #pp-modal-card { width:96vw; } }
  `;
  document.head.appendChild(style);
  return modal;
}

// ------- lógica do modal -------
const Modal = {
  el: null,
  state: {
    id: null,
    vendorKey: null,
    createdAt: null,
    status: "rascunho",
    cliente: {},
    itens: [],
    descMode: "item",
    descGlobal: 0,
    totais: { subtotalBruto: 0, descontoTotal: 0, total: 0 }
  },
};

function openModalWith(proposta, vendorKey, id) {
  if (!Modal.el) Modal.el = makeModal();
  Modal.el.style.display = "flex";

  const c = proposta?.clienteSnapshot || {};
  const t = proposta?.totais || {};
  const mode = (t.mode === "global" || t.mode === "item") ? t.mode : "item";
  const gperc = Number(t.descGlobal) || 0;
  Modal.state = {
    id: id || null,
    vendorKey: vendorKey || vendorKeyFromRecord(proposta) || buildVendorKey(VENDEDOR) || "sem_vendedor",
    createdAt: proposta?.createdAt || nowISO(),
    status: proposta?.status || "rascunho",
    cliente: {
      nome: c?.nome || "", email: c?.email || "", cpfCnpj: c?.cpfCnpj || "", tel: c?.tel || "",
      enderecoCadastro: c?.enderecoCadastro || {}, enderecoEntrega: c?.enderecoEntrega || null,
      entregaDiferente: c?.entregaDiferente || !!c?.enderecoEntrega
    },
    itens: Array.isArray(proposta?.itens) ? proposta.itens.map(it => ({
      sku: String(it.sku || ""), quantidade: Number(it.quantidade) || 0, preco: Number(it.preco) || 0, descPerc: Number(it.descPerc || 0),
      nome: (it.nome && String(it.nome).trim()) || null,
      marca: (it.marca && String(it.marca).trim()) || null,
      imagemUrl: (it.imagemUrl && String(it.imagemUrl).trim()) || null,
    })) : [],
    descMode: mode,
    descGlobal: gperc,
    totais: { subtotalBruto: 0, descontoTotal: 0, total: 0 }
  };

  renderModal();
}

function closeModal() { if (Modal?.el) Modal.el.style.display = "none"; }

function computeTotals() {
  const itens = Modal.state.itens;
  const subtotal = itens.reduce((acc, it) => acc + (Number(it.preco)||0)*(Number(it.quantidade)||0), 0);
  let desconto = 0;
  if (Modal.state.descMode === "global") desconto = subtotal * ((Number(Modal.state.descGlobal)||0) / 100);
  else desconto = itens.reduce((acc, it)=> acc + (Number(it.preco)||0)*(Number(it.quantidade)||0)*((Number(it.descPerc)||0)/100), 0);
  const total = subtotal - desconto;
  Modal.state.totais = { mode: Modal.state.descMode, descGlobal: Number(Modal.state.descGlobal)||0, subtotalBruto: subtotal, descontoTotal: desconto, total };
}

function renderModal() {
  const el = Modal.el; if (!el) return;
  const s = Modal.state;

  el.querySelector("#pp-modal-title").textContent = `Proposta #${s.id || "—"}`;
  const stBadge = el.querySelector("#pp-modal-status"); stBadge.setAttribute("style", badge(s.status)); stBadge.textContent = s.status;

  el.querySelector("#pp-f-nome").value  = s.cliente.nome || "";
  el.querySelector("#pp-f-email").value = s.cliente.email || "";
  el.querySelector("#pp-f-doc").value   = s.cliente.cpfCnpj || "";
  el.querySelector("#pp-f-tel").value   = s.cliente.tel || "";
  el.querySelector("#pp-f-status").value= s.status || "rascunho";

  el.querySelectorAll('input[name="pp-desc-mode"]').forEach(r => { r.checked = (r.value === s.descMode); });
  const gInp = el.querySelector("#pp-f-desc-global");
  gInp.value = String(s.descGlobal).replace(".", ","); gInp.disabled = (s.descMode !== "global");

  const tbody = el.querySelector("#pp-items tbody"); tbody.innerHTML = "";
  s.itens.forEach((it, idx) => {
    const nome = it.nome || "—";
    const img = it.imagemUrl || "img/logo-nav.png";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="pp-prod">
          <img class="pp-thumb" src="${img}" alt="">
          <div class="pp-prod-info">
            <div class="pp-prod-nome" title="${nome}">${nome}</div>
            <input class="pp-sku-inp" data-k="sku" data-i="${idx}" type="text" placeholder="SKU">
          </div>
        </div>
      </td>
      <td><input data-k="quantidade" data-i="${idx}" type="number" step="1" min="0"></td>
      <td><input data-k="preco"      data-i="${idx}" type="number" step="0.01" min="0"></td>
      <td><input data-k="descPerc"   data-i="${idx}" type="number" step="0.1"  min="0"></td>
      <td style="text-align:right">
        <span data-k="subtotal" data-i="${idx}">
          ${fmtBRL((it.preco||0)*(it.quantidade||0)*(1-((s.descMode==='item'? (it.descPerc||0):0)/100)))}
        </span>
      </td>
      <td><button data-action="rm" data-i="${idx}" class="pp-btn-sec">remover</button></td>
    `;
    tbody.appendChild(tr);
    tr.querySelector('[data-k="sku"]').value = it.sku;
    tr.querySelector('[data-k="quantidade"]').value = String(it.quantidade);
    tr.querySelector('[data-k="preco"]').value = String(it.preco);
    const descInput = tr.querySelector('[data-k="descPerc"]');
    descInput.value = String(it.descPerc);
    descInput.disabled = (s.descMode === "global");
  });

  computeTotals();
  el.querySelector("#pp-subtotal").textContent = fmtBRL(Modal.state.totais.subtotalBruto);
  el.querySelector("#pp-desc").textContent     = fmtBRL(Modal.state.totais.descontoTotal);
  el.querySelector("#pp-total").textContent    = fmtBRL(Modal.state.totais.total);

  wireModalHandlers();
}

let modalHandlersWired = false;
function wireModalHandlers() {
  if (modalHandlersWired || !Modal.el) return;
  modalHandlersWired = true;
  const el = Modal.el;

  el.querySelector("#pp-btn-close").addEventListener("click", closeModal);
  el.addEventListener("click", (ev)=> { if (ev.target === Modal.el) closeModal(); });

  el.querySelector("#pp-f-nome").addEventListener("input", (e)=>{ Modal.state.cliente.nome = e.target.value; });
  el.querySelector("#pp-f-email").addEventListener("input", (e)=>{ Modal.state.cliente.email = e.target.value; });
  el.querySelector("#pp-f-doc").addEventListener("input", (e)=>{ Modal.state.cliente.cpfCnpj = onlyDigits(e.target.value); e.target.value = Modal.state.cliente.cpfCnpj; });
  el.querySelector("#pp-f-tel").addEventListener("input", (e)=>{ Modal.state.cliente.tel = e.target.value; });

  el.querySelector("#pp-f-status").addEventListener("change", (e)=>{
    Modal.state.status = e.target.value;
    const stBadge = el.querySelector("#pp-modal-status");
    stBadge.setAttribute("style", badge(Modal.state.status));
    stBadge.textContent = Modal.state.status;
  });

  el.querySelectorAll('input[name="pp-desc-mode"]').forEach(r=>{
    r.addEventListener("change", ()=>{
      const selected = [...el.querySelectorAll('input[name="pp-desc-mode"]')].find(x=>x.checked)?.value || "item";
      Modal.state.descMode = (selected === "global") ? "global" : "item";
      el.querySelectorAll('#pp-items [data-k="descPerc"]').forEach(inp => { inp.disabled = (Modal.state.descMode === "global"); });
      const gInp = el.querySelector("#pp-f-desc-global");
      gInp.disabled = (Modal.state.descMode !== "global");
      updateTotalsFromUI();
    });
  });
  el.querySelector("#pp-f-desc-global").addEventListener("input", (e)=>{
    const s = String(e.target.value || "").replace(",", ".");
    const n = parseFloat(s);
    Modal.state.descGlobal = Number.isFinite(n) ? n : 0;
    updateTotalsFromUI();
  });

  el.querySelector("#pp-items").addEventListener("input", (ev)=>{
    const target = ev.target;
    const k = target.getAttribute("data-k");
    const idx = Number(target.getAttribute("data-i"));
    if (!k || Number.isNaN(idx)) return;
    const it = Modal.state.itens[idx]; if (!it) return;

    if (k === "sku") it.sku = String(target.value || "");
    else if (k === "quantidade") it.quantidade = Math.max(0, Number(target.value)||0);
    else if (k === "preco") it.preco = Math.max(0, Number(target.value)||0);
    else if (k === "descPerc") it.descPerc = Math.max(0, Number(target.value)||0);

    updateRowSubtotal(idx);
    updateTotalsFromUI();
  });

  el.querySelector("#pp-items").addEventListener("click", (ev)=>{
    const btn = ev.target.closest("button[data-action='rm']");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-i"));
    Modal.state.itens.splice(idx, 1);
    renderModal();
  });

  el.querySelector("#pp-btn-additem").addEventListener("click", ()=>{
    Modal.state.itens.push({ sku:"", quantidade:1, preco:0, descPerc:0, nome:null, marca:null, imagemUrl:null });
    renderModal();
  });

  el.querySelector("#pp-btn-save").addEventListener("click", saveModalChanges);
  el.querySelector("#pp-btn-clone").addEventListener("click", cloneCurrentProposal);
  el.querySelector("#pp-btn-delete").addEventListener("click", deleteCurrentProposal);
  el.querySelector("#pp-btn-share").addEventListener("click", shareCurrentProposal);
  el.querySelector("#pp-btn-print").addEventListener("click", ()=> printOrPdf("print"));
  el.querySelector("#pp-btn-pdf").addEventListener("click", ()=> printOrPdf("pdf"));
  el.querySelector("#pp-btn-edit-cart").addEventListener("click", handoffToCart);
}

function updateRowSubtotal(idx) {
  const el = Modal.el; const it = Modal.state.itens[idx]; if (!el || !it) return;
  const mode = Modal.state.descMode; const perc = (mode === "item") ? (Number(it.descPerc)||0) : 0;
  const sub = (Number(it.preco)||0)*(Number(it.quantidade)||0)*(1 - (perc/100));
  const span = el.querySelector(`#pp-items [data-k="subtotal"][data-i="${idx}"]`);
  if (span) span.textContent = fmtBRL(sub);
}
function updateTotalsFromUI() {
  const el = Modal.el; computeTotals();
  el.querySelector("#pp-subtotal").textContent = fmtBRL(Modal.state.totais.subtotalBruto);
  el.querySelector("#pp-desc").textContent     = fmtBRL(Modal.state.totais.descontoTotal);
  el.querySelector("#pp-total").textContent    = fmtBRL(Modal.state.totais.total);
}

// salvar alterações (PATCH)
async function saveModalChanges() {
  try {
    const nomeOk = (Modal.state.cliente.nome || "").trim().length >= 2;
    const docOk = onlyDigits(Modal.state.cliente.cpfCnpj || "").length >= 11;
    if (!nomeOk || !docOk) { alert("Preencha nome e CPF/CNPJ válidos."); return; }
    if (!Modal.state.itens.length) { alert("Adicione ao menos 1 item."); return; }

    computeTotals();
    const payload = {
      createdAt: Modal.state.createdAt || nowISO(),
      updatedAt: nowISO(),
      status: Modal.state.status || "rascunho",
      clienteSnapshot: { ...Modal.state.cliente, cpfCnpj: onlyDigits(Modal.state.cliente.cpfCnpj || "") },
      itens: Modal.state.itens.map(it => ({
        sku: it.sku, quantidade: Number(it.quantidade)||0, preco: Number(it.preco)||0,
        ...(Modal.state.descMode === "item" ? { descPerc: Number(it.descPerc)||0 } : {}),
        ...(it.nome ? { nome: it.nome } : {}), ...(it.marca ? { marca: it.marca } : {}), ...(it.imagemUrl ? { imagemUrl: it.imagemUrl } : {}),
      })),
      totais: {
        mode: Modal.state.descMode, descGlobal: Number(Modal.state.descGlobal)||0,
        subtotalBruto: Modal.state.totais.subtotalBruto, descontoTotal: Modal.state.totais.descontoTotal, total: Modal.state.totais.total
      },
      vendedor: { id: VENDEDOR?.id ?? null, nome: VENDEDOR?.nome ?? null, tipo: VENDEDOR?.tipo ?? null, cpfKey: VENDEDOR?.cpfKey ?? null },
    };

    const url = buildNestedItemUrl(Modal.state.vendorKey, Modal.state.id);
    await patchJSON(url, payload);

    alert("Proposta atualizada!");
    const idx = BASE_DATA.findIndex(x => x.key === Modal.state.id);
    if (idx >= 0) BASE_DATA[idx] = { key: Modal.state.id, ...payload };
    renderList();
    closeModal();
  } catch (e) {
    console.error("save error:", e);
    alert("Falha ao salvar alterações.");
  }
}

// clonar proposta
async function cloneCurrentProposal() {
  try {
    const clone = structuredClone({
      createdAt: nowISO(), updatedAt: nowISO(), status: "rascunho",
      clienteSnapshot: Modal.state.cliente, itens: Modal.state.itens, totais: Modal.state.totais,
      vendedor: { id: VENDEDOR?.id ?? null, nome: VENDEDOR?.nome ?? null, tipo: VENDEDOR?.tipo ?? null, cpfKey: VENDEDOR?.cpfKey ?? null },
    });
    computeTotals(); clone.totais = { ...Modal.state.totais };
    const url = buildNestedUrl(Modal.state.vendorKey);
    const { name: newId } = await postJSON(url, clone);
    BASE_DATA.unshift({ key: newId, ...clone });
    renderList();
    alert(`Proposta clonada (#${newId}).`);
    openModalWith(clone, Modal.state.vendorKey, newId);
  } catch (e) {
    console.error("clone error:", e); alert("Falha ao clonar proposta.");
  }
}

// excluir
async function deleteCurrentProposal() {
  const ok = confirm("Tem certeza que deseja excluir esta proposta? Esta ação não pode ser desfeita.");
  if (!ok) return;
  try {
    const url = buildNestedItemUrl(Modal.state.vendorKey, Modal.state.id);
    await deleteReq(url);
    const idx = BASE_DATA.findIndex(x => x.key === Modal.state.id);
    if (idx >= 0) BASE_DATA.splice(idx, 1);
    renderList(); closeModal();
  } catch (e) {
    console.error("delete error:", e); alert("Falha ao excluir.");
  }
}

// compartilhar
async function shareCurrentProposal() {
  const link = buildOpenLink(Modal.state.vendorKey, Modal.state.id);
  try {
    if (navigator.share) { await navigator.share({ title: "Proposta", url: link }); }
    else { await navigator.clipboard.writeText(link); alert("Link copiado!"); }
  } catch { await navigator.clipboard.writeText(link); alert("Link copiado!"); }
}
function buildOpenLink(vendorKey, id) { const u = new URL(window.location.href); u.searchParams.set("open", id); u.searchParams.set("vendor", vendorKey); return u.toString(); }

// imprimir / pdf
// imprimir / pdf
function printOrPdf(kind = "print") {
  const s = Modal.state;
  const win = window.open("", "_blank");
  const rows = s.itens.map(it => {
    const nome = it.nome || "—";
    const img = (it.imagemUrl && String(it.imagemUrl).trim()) || "img/logo-nav.png";
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <img src="${img}" alt="" style="width:42px;height:42px;object-fit:contain;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
            <div>${nome}<br><small style="color:#6b7280">${it.sku}</small></div>
          </div>
        </td>
        <td style="text-align:right">${Number(it.quantidade)||0}</td>
        <td style="text-align:right">${fmtBRL(Number(it.preco)||0)}</td>
        <td style="text-align:right">${s.descMode==='item' ? (Number(it.descPerc)||0).toFixed(1) +'%' : '-'}</td>
        <td style="text-align:right">${fmtBRL((Number(it.preco)||0)*(Number(it.quantidade)||0))}</td>
      </tr>
    `;
  }).join("");

  const html = `
    <html><head><meta charset="utf-8"><title>Proposta #${s.id}</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding:16px; }
        h1 { font-size:18px; margin:0 0 10px; }
        table { width:100%; border-collapse: collapse; margin-top:8px; }
        th, td { border:1px solid #e5e7eb; padding:8px; }
        .totais { margin-top:10px; text-align:right; }
      </style>
    </head>
    <body>
      <h1>Proposta #${s.id}</h1>
      <div><b>Status:</b> ${s.status}</div>
      <div><b>Cliente:</b> ${s.cliente.nome} — ${s.cliente.email || ""}</div>
      <div><b>CPF/CNPJ:</b> ${s.cliente.cpfCnpj || ""} — <b>Tel:</b> ${s.cliente.tel || ""}</div>

      <table>
        <thead><tr><th>Produto / SKU</th><th>Qtd</th><th>Preço (un)</th><th>Desc.</th><th>Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="totais">
        <div>Subtotal (bruto): <b>${fmtBRL(s.totais.subtotalBruto)}</b></div>
        <div>Desconto ${s.descMode==='global' ? `(global ${Number(s.descGlobal||0).toFixed(1)}%)`:""}: <b>${fmtBRL(s.totais.descontoTotal)}</b></div>
        <div style="font-size:18px">TOTAL: <b>${fmtBRL(s.totais.total)}</b></div>
      </div>
      <script>window.onload = () => window.print();</script>
    </body></html>
  `;
  win.document.write(html); win.document.close();
}

// -------------------- Lista --------------------
function mountRow(p, vendorKeyForRow) {
  const c = p?.clienteSnapshot || {};
  const total = p?.totais?.total ?? 0;
  const qtd = Array.isArray(p?.itens) ? p.itens.length : 0;

  const linha = document.createElement("div");
  linha.style.display = "grid";
  linha.style.gridTemplateColumns = "3fr 2fr 2fr 2fr 1fr 1fr";
  linha.style.gap = "8px";
  linha.style.padding = "10px 12px";
  linha.style.borderTop = "1px solid #e0e4e7";
  linha.style.alignItems = "center";

  const colCliente = document.createElement("div");
  const nm = document.createElement("div");
  nm.textContent = c?.nome || "—";
  nm.style.fontWeight = "600"; nm.style.color = "#111827";
  const em = document.createElement("div");
  em.textContent = c?.email || ""; em.style.fontSize = "12px"; em.style.color = "#6b7280";
  colCliente.appendChild(nm); colCliente.appendChild(em);

  const colCpf = document.createElement("div"); colCpf.textContent = c?.cpfCnpj || "—"; colCpf.style.color = "#374151";
  const colData = document.createElement("div"); colData.textContent = fmtDate(p?.createdAt);
  const colTotal = document.createElement("div"); colTotal.textContent = fmtBRL(total); colTotal.style.fontWeight = "700"; colTotal.style.color = "#111827";
  const colItens = document.createElement("div"); colItens.textContent = String(qtd); colItens.style.textAlign = "right";

  const st = document.createElement("span"); st.setAttribute("style", badge(p?.status)); st.textContent = p?.status || "—"; st.style.marginLeft = "6px"; nm.appendChild(st);

  const colAcoes = document.createElement("div");
  colAcoes.style.textAlign = "right";
  const btn = document.createElement("button");
  btn.textContent = "Gerenciar"; btn.className = "pp-btn-sec";
  btn.addEventListener("click", () => { const vendorKey = vendorKeyForRow || vendorKeyFromRecord(p) || buildVendorKey(VENDEDOR); openModalWith(p, vendorKey, p.key); });
  colAcoes.appendChild(btn);

  linha.appendChild(colCliente);
  linha.appendChild(colCpf);
  linha.appendChild(colData);
  linha.appendChild(colTotal);
  linha.appendChild(colItens);
  linha.appendChild(colAcoes);

  return linha;
}

// -------------------- Módulo principal --------------------
let BASE_DATA = [];
let CURRENT_VENDOR_KEY = null;
let UI = {};

export function init() {
  UI = {
    buscaEl: document.getElementById("pp-busca"),
    statusEl: document.getElementById("pp-status"),
    corpoEl: document.getElementById("pp-corpo"),
    vazioEl: document.getElementById("pp-vazio"),
    erroEl: document.getElementById("pp-erro"),
  };

  UI.buscaEl?.addEventListener("input", renderList);
  UI.statusEl?.addEventListener("change", renderList);

  loadAll().then(()=>{
    const openId = qsParam("open");
    const vendorParam = qsParam("vendor");
    if (openId && vendorParam) {
      const found = BASE_DATA.find(x => x.key === openId);
      if (found) openModalWith(found, vendorParam, openId);
    }
  });

  return () => {
    UI.buscaEl?.removeEventListener("input", renderList);
    UI.statusEl?.removeEventListener("change", renderList);
  };
}

async function loadAll() {
  try {
    UI.erroEl && (UI.erroEl.style.display = "none");
    UI.vazioEl && (UI.vazioEl.style.display = "none");
    UI.corpoEl && (UI.corpoEl.innerHTML = '<div style="padding:14px;color:#6b7280;">Carregando…</div>');

    let loaded = [];
    const vendedorKey = buildVendorKey(VENDEDOR);
    CURRENT_VENDOR_KEY = vendedorKey || null;

    if (vendedorKey) {
      const nestedUrl = buildNestedUrl(vendedorKey);
      const nested = await fetchJSON(nestedUrl);
      if (nested && typeof nested === "object") loaded = Object.entries(nested).map(([key, v]) => ({ key, ...v }));
    }

    if (!loaded.length) {
      const legacyUrl = buildLegacyFilterUrl();
      const data = await fetchJSON(legacyUrl);
      if (data && typeof data === "object") loaded = Object.entries(data).map(([key, v]) => ({ key, ...v }));
    }

    BASE_DATA = (loaded || []).sort((a, b) => (new Date(b.createdAt).getTime()||0) - (new Date(a.createdAt).getTime()||0));
    renderList();
  } catch (e) {
    UI.corpoEl && (UI.corpoEl.innerHTML = "");
    if (UI.erroEl) { UI.erroEl.textContent = e?.message || "Falha ao carregar propostas."; UI.erroEl.style.display = "block"; }
    console.error("[propostas] erro load:", e);
  }
}

function renderList() {
  const busca = (UI.buscaEl?.value || "").trim().toLowerCase();
  const st = (UI.statusEl?.value || "todos").toLowerCase();

  const view = BASE_DATA.filter((p) => {
    const okStatus = st === "todos" || String(p.status || "").toLowerCase() === st;
    if (!okStatus) return false;
    if (!busca) return true;
    const c = p?.clienteSnapshot || {};
    const blob = [ c?.nome, c?.cpfCnpj, c?.email, p?.vendedor?.nome, p?.vendedor?.cpfKey ]
      .filter(Boolean).join(" ").toLowerCase();
    return blob.includes(busca);
  });

  if (!UI.corpoEl) return;
  UI.corpoEl.innerHTML = "";
  if (!view.length) { UI.vazioEl && (UI.vazioEl.style.display = "block"); return; }
  UI.vazioEl && (UI.vazioEl.style.display = "none");
  view.forEach((p) => UI.corpoEl.appendChild(mountRow(p, CURRENT_VENDOR_KEY)));
}

// -------- Handoff para o carrinho --------
function handoffToCart(){
  const itensForCart = Modal.state.itens.map(it => ({
    sku: String(it.sku || ""),
    quantidade: Number(it.quantidade) || 0,
    preco: Number(it.preco) || 0,
    ...(Modal.state.descMode === "item" ? { descPerc: Number(it.descPerc) || 0 } : {}),
    ...(it.nome ? { nome: it.nome } : {}),
    ...(it.marca ? { marca: it.marca } : {}),
    ...(it.imagemUrl ? { imagemUrl: it.imagemUrl } : {})
  }));
  localStorage.setItem("carrinhoProposta_itens", JSON.stringify(itensForCart));
  localStorage.setItem("carrinhoProposta_descMode", Modal.state.descMode);
  localStorage.setItem("carrinhoProposta_descGlobalPerc", String(Number(Modal.state.descGlobal) || 0));
  localStorage.setItem("carrinhoProposta_editRef", JSON.stringify({ vendorKey: Modal.state.vendorKey, id: Modal.state.id }));
  if (Modal.state.cliente?.cpfCnpj) localStorage.setItem("carrinhoProposta_clienteCPF", String(Modal.state.cliente.cpfCnpj));
  closeModal();
  window.location.hash = "#carrinho";
}

