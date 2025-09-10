// ====================== BASE ======================
const PEDIDOS_DB = "https://proposta-shelf-distribuidora-default-rtdb.firebaseio.com";

// utils
const pdOnlyDigits = (s="") => String(s).replace(/\D/g,"");
const pdFmtBRL = n => (Number(n)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const pdFmtDate = iso => { const d=new Date(iso); return Number.isNaN(d.getTime())?"—":d.toLocaleString("pt-BR"); };
const pdSanKey = k => String(k).replace(/[.$#[\]/]/g,"_").trim();
const pdQS = n => new URL(location.href).searchParams.get(n);

// vendedor (compatível com seu app)
function pdGetVendedorFromLS(){
  try{
    const raw = localStorage.getItem("usuario_shelf");
    if(!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && ("id" in data || "tipo" in data || "usuario" in data)){
      return { id:data.id??null, nome:data.usuario??null, tipo:data.tipo??null, cpfKey:data.cpf?pdOnlyDigits(data.cpf):null };
    }
    const keys = Object.keys(data||{});
    if(keys.length){
      const cpfKey = pdOnlyDigits(keys[0]); const v = data[cpfKey]||{};
      return { id:v.id??null, nome:v.usuario??null, tipo:v.tipo??null, cpfKey: cpfKey||null };
    }
  }catch{}
  return null;
}
const PD_VENDEDOR = pdGetVendedorFromLS();
const pdBuildVendorKey = (v=PD_VENDEDOR) => {
  if(!v) return null; 
  const raw = (v.id ?? null) ?? (v.cpfKey ?? null) ?? (v.nome ?? null);
  const s = pdSanKey(String(raw ?? "").trim());
  return s || null;
};

// REST
async function pdFetchJSON(url){
  const r = await fetch(url);
  if(!r.ok){ throw new Error(`HTTP ${r.status}`); }
  return r.json();
}

// endpoints
const pdUrlPedidos = vendorKey => `${PEDIDOS_DB}/pedidos/${encodeURIComponent(vendorKey)}.json`;

// status helpers
function pdNormStatus(s){ if(!s) return ""; const t=String(s).trim().toLowerCase(); return t==="nao entregue"?"não entregue":t; }
function pdBadgeEl(status){
  const span = document.createElement("span");
  const s = pdNormStatus(status||"");
  span.className = "pd-badge";
  span.dataset.s = s;
  span.textContent = s || "—";
  return span;
}

// modal (read-only)
function pdMakeModal(){
  const modal = document.createElement("div");
  modal.id = "pd-modal";
  modal.innerHTML = `
    <div id="pd-card">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
        <div style="display:flex;gap:10px;align-items:center">
          <h3 id="pd-title" style="margin:0;font-size:18px;">Pedido</h3>
          <span id="pd-badge" class="pd-badge" data-s=""></span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="pd-btn-share" class="pd-btn-sec">Compartilhar</button>
          <button id="pd-btn-pdf"   class="pd-btn-sec">Salvar PDF</button>
          <button id="pd-btn-print" class="pd-btn-sec">Imprimir</button>
          <button id="pd-btn-close" class="pd-btn-sec">Fechar</button>
        </div>
      </div>
      <div style="padding:14px 16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px;">
          <div>
            <div style="font-size:12px;color:#374151;">Cliente</div>
            <div id="pd-c-nome" style="font-weight:600"></div>
            <div id="pd-c-email" style="font-size:12px;color:#6b7280"></div>
          </div>
          <div>
            <div style="font-size:12px;color:#374151;">Documento / Telefone</div>
            <div id="pd-c-doc" style="font-feature-settings:'tnum' 1;"></div>
            <div id="pd-c-tel" style="font-size:12px;color:#6b7280"></div>
          </div>
          <div>
            <div style="font-size:12px;color:#374151;">Nº pedido ecommerce</div>
            <div id="pd-num" style="font-weight:600"></div>
          </div>
          <div>
            <div style="font-size:12px;color:#374151;">Criado em</div>
            <div id="pd-data"></div>
          </div>
        </div>

        <h4 style="margin:8px 0">Itens</h4>
        <div style="overflow:auto;">
          <table class="pd-table">
            <thead>
              <tr>
                <th>Produto / SKU</th>
                <th style="width:90px;text-align:right">Qtd</th>
                <th style="width:130px;text-align:right">Preço (un)</th>
                <th style="width:120px;text-align:right">Desc. (%)</th>
                <th style="width:120px;text-align:right">Subtotal</th>
              </tr>
            </thead>
            <tbody id="pd-items"></tbody>
          </table>
        </div>

        <h4 style="margin:12px 0 6px">Pagamentos</h4>
        <div id="pd-pag" style="font-size:14px;color:#374151;"></div>

        <div id="pd-totais" style="margin-top:12px;display:grid;gap:6px;justify-content:end;">
          <div>Subtotal (bruto): <b id="pd-subtotal">R$ 0,00</b></div>
          <div>Desconto: <b id="pd-desc">R$ 0,00</b></div>
          <div>Total: <b id="pd-total" style="font-size:18px">R$ 0,00</b></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // handlers
  modal.addEventListener("click",(ev)=>{ if(ev.target===modal) modal.style.display="none"; });
  modal.querySelector("#pd-btn-close").addEventListener("click", ()=> modal.style.display="none");
  modal.querySelector("#pd-btn-print").addEventListener("click", ()=> pdPrintOrPdf("print"));
  modal.querySelector("#pd-btn-pdf").addEventListener("click",   ()=> pdPrintOrPdf("pdf"));
  modal.querySelector("#pd-btn-share").addEventListener("click", pdSharePedido);
  return modal;
}
const PD_MODAL = { el:null, vendorKey:null, numero:null, data:null };

function pdOpenModal(pedido, vendorKey, numero){
  if(!PD_MODAL.el) PD_MODAL.el = pdMakeModal();
  PD_MODAL.el.style.display="flex";
  PD_MODAL.vendorKey = vendorKey; PD_MODAL.numero = numero; PD_MODAL.data = pedido;

  const s = pedido || {};
  PD_MODAL.el.querySelector("#pd-title").textContent = `Pedido #${numero || "—"}`;
  const badge = PD_MODAL.el.querySelector("#pd-badge"); badge.dataset.s = pdNormStatus(s.status || s.situacao || "aprovado"); badge.textContent = badge.dataset.s;

  const c = s.clienteSnapshot || s.cliente || {};
  PD_MODAL.el.querySelector("#pd-c-nome").textContent  = c.nome || "—";
  PD_MODAL.el.querySelector("#pd-c-email").textContent = c.email || "";
  PD_MODAL.el.querySelector("#pd-c-doc").textContent   = c.cpfCnpj || c.cpf_cnpj || "—";
  PD_MODAL.el.querySelector("#pd-c-tel").textContent   = c.tel || c.fone || "";
  PD_MODAL.el.querySelector("#pd-num").textContent     = s.numero_pedido_ecommerce || numero || "—";
  PD_MODAL.el.querySelector("#pd-data").textContent    = pdFmtDate(s.createdAt || s.data || new Date().toISOString());

  const tb = PD_MODAL.el.querySelector("#pd-items"); tb.innerHTML = "";
  (Array.isArray(s.itens)?s.itens:[]).forEach(it=>{
    const nome=it.nome||"—", sku=it.sku||it.codigo||"", img=it.imagemUrl||"img/logo-nav.png";
    const qtd=Number(it.quantidade)||0, preco=Number(it.preco ?? it.valor_unitario)||0, desc=Number(it.descPerc||0);
    const sub=(preco*qtd)*(1-desc/100);
    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="pd-prod">
          <img class="pd-thumb" src="${img}" alt="">
          <div class="pd-prod-info">
            <div class="pd-prod-nome" title="${nome}">${nome}</div>
            <div style="font-size:12px;color:#6b7280">SKU: ${sku}</div>
          </div>
        </div>
      </td>
      <td style="text-align:right">${qtd}</td>
      <td style="text-align:right">${pdFmtBRL(preco)}</td>
      <td style="text-align:right">${desc.toFixed(1)}%</td>
      <td style="text-align:right">${pdFmtBRL(sub)}</td>`;
    tb.appendChild(tr);
  });

  const pg = PD_MODAL.el.querySelector("#pd-pag");
  const parcelas = Array.isArray(s.parcelas)?s.parcelas:[]; const forma=s.forma_pagamento||"—";
  if(parcelas.length){
    const rows = parcelas.map((p,i)=>{
      const meio = p.meio_pagamento ? ` • ${p.meio_pagamento}`:"";
      return `<li>Parcela ${i+1}: <b>${pdFmtBRL(p.valor||0)}</b> — ${(p.forma_pagamento||"—")}${meio}${p.obs?` — <i>${p.obs}</i>`:""}</li>`;
    }).join("");
    pg.innerHTML = `<div><b>Forma de pagamento:</b> ${forma}</div><ul style="margin:6px 0 0 16px">${rows}</ul>`;
  }else{
    pg.innerHTML = `<div><b>Forma de pagamento:</b> ${forma}</div>`;
  }

  const t = s.totais || {};
  PD_MODAL.el.querySelector("#pd-subtotal").textContent = pdFmtBRL(Number(t.subtotalBruto ?? s.subtotalBruto ?? 0));
  PD_MODAL.el.querySelector("#pd-desc").textContent     = pdFmtBRL(Number(t.descontoTotal ?? s.descontoTotal ?? 0));
  PD_MODAL.el.querySelector("#pd-total").textContent    = pdFmtBRL(Number(t.total ?? s.total ?? 0));
}
function pdBuildOpenLink(vendorKey, numero){ const u=new URL(location.href); u.searchParams.set("open",numero); u.searchParams.set("vendor",vendorKey); return u.toString(); }
async function pdSharePedido(){ const link=pdBuildOpenLink(PD_MODAL.vendorKey, PD_MODAL.numero); try{ if(navigator.share){await navigator.share({title:"Pedido",url:link});}else{await navigator.clipboard.writeText(link); alert("Link copiado!");} }catch{ await navigator.clipboard.writeText(link); alert("Link copiado!"); } }
function pdPrintOrPdf(){ const s=PD_MODAL.data||{}; const itens=Array.isArray(s.itens)?s.itens:[]; const rows=itens.map(it=>{ const nome=it.nome||"—", qtd=Number(it.quantidade)||0, preco=Number(it.preco??it.valor_unitario)||0, desc=Number(it.descPerc||0), sub=(preco*qtd)*(1-desc/100); return `<tr><td>${nome}<br><small style="color:#6b7280">${it.sku||it.codigo||""}</small></td><td style="text-align:right">${qtd}</td><td style="text-align:right">${pdFmtBRL(preco)}</td><td style="text-align:right">${desc.toFixed(1)}%</td><td style="text-align:right">${pdFmtBRL(sub)}</td></tr>`; }).join(""); const t=s.totais||{}; const subtotal=Number(t.subtotalBruto??s.subtotalBruto??0), desconto=Number(t.descontoTotal??s.descontoTotal??0), total=Number(t.total??s.total??0); const win=window.open("","_blank"); win.document.write(`<html><head><meta charset="utf-8"><title>Pedido #${PD_MODAL.numero}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px}h1{font-size:18px;margin:0 0 10px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #e5e7eb;padding:8px}.totais{text-align:right;margin-top:10px}</style></head><body><h1>Pedido #${PD_MODAL.numero}</h1><div><b>Status:</b> ${s.status||s.situacao||"aprovado"}</div><div><b>Cliente:</b> ${(s.clienteSnapshot?.nome||s.cliente?.nome||"—")} — ${(s.clienteSnapshot?.email||s.cliente?.email||"")}</div><div><b>CPF/CNPJ:</b> ${(s.clienteSnapshot?.cpfCnpj||s.cliente?.cpfCnpj||s.cliente?.cpf_cnpj||"")} — <b>Tel:</b> ${(s.clienteSnapshot?.tel||s.cliente?.tel||s.cliente?.fone||"")}</div><table><thead><tr><th>Produto / SKU</th><th>Qtd</th><th>Preço (un)</th><th>Desc.</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody></table><div class="totais"><div>Subtotal (bruto): <b>${pdFmtBRL(subtotal)}</b></div><div>Desconto: <b>${pdFmtBRL(desconto)}</b></div><div style="font-size:18px">TOTAL: <b>${pdFmtBRL(total)}</b></div></div><script>window.onload=()=>window.print()</script></body></html>`); win.document.close(); }

// ====================== LISTA ======================
let PD_DATA = [];
let PD_VENDOR_KEY = null;
let PD_UI = {};

export function init(){
  PD_UI = {
    buscaEl: document.getElementById("pd-busca"),
    statusEl: document.getElementById("pd-status-select"),
    corpoEl: document.getElementById("pd-corpo"),
    vazioEl: document.getElementById("pd-vazio"),
    erroEl: document.getElementById("pd-erro"),
  };

  PD_UI.buscaEl?.addEventListener("input", renderList);
  PD_UI.statusEl?.addEventListener("change", renderList);

  loadAll().then(()=>{
    const open = pdQS("open"), vendor = pdQS("vendor");
    if(open && vendor){ const found=PD_DATA.find(x=>x.key===open); if(found) pdOpenModal(found, vendor, open); }
  });

  return ()=>{
    PD_UI.buscaEl?.removeEventListener("input", renderList);
    PD_UI.statusEl?.removeEventListener("change", renderList);
  };
}

async function loadAll(){
  try{
    PD_UI.erroEl.style.display="none"; PD_UI.vazioEl.style.display="none";
    PD_UI.corpoEl.innerHTML = '<div style="padding:14px;color:#6b7280;">Carregando…</div>';

    PD_VENDOR_KEY = pdBuildVendorKey(PD_VENDEDOR);
    let loaded = [];
    if (PD_VENDOR_KEY){
      const data = await pdFetchJSON(pdUrlPedidos(PD_VENDOR_KEY)); // { num: {...} }
      if (data && typeof data==="object"){
        loaded = Object.entries(data).map(([key,v]) => ({ key, ...v }));
      }
    }
    PD_DATA = (loaded||[]).sort((a,b)=>{
      const da = new Date(a.createdAt||a.data).getTime()||0;
      const db = new Date(b.createdAt||b.data).getTime()||0;
      return db-da;
    });
    renderList();
  }catch(e){
    PD_UI.corpoEl.innerHTML = "";
    PD_UI.erroEl.textContent = e?.message || "Falha ao carregar pedidos.";
    PD_UI.erroEl.style.display = "block";
    console.error("[pedidos] load error:", e);
  }
}

function renderList(){
  const q = (PD_UI.buscaEl?.value||"").trim().toLowerCase();
  const stSel = (PD_UI.statusEl?.value||"todos").toLowerCase();

  const view = PD_DATA.filter(p=>{
    const st = pdNormStatus(p.status||p.situacao||"");
    const okSt = (stSel==="todos") || (st===stSel);
    if(!okSt) return false;
    if(!q) return true;
    const c = p.clienteSnapshot || p.cliente || {};
    const blob = [
      c.nome, c.cpfCnpj || c.cpf_cnpj, c.email,
      p.vendedor?.nome, p.vendedor?.cpfKey, p.numero_pedido_ecommerce
    ].filter(Boolean).join(" ").toLowerCase();
    return blob.includes(q);
  });

  PD_UI.corpoEl.innerHTML = "";
  if(!view.length){ PD_UI.vazioEl.style.display="block"; return; }
  PD_UI.vazioEl.style.display="none";

  view.forEach(p => PD_UI.corpoEl.appendChild(mountRow(p, PD_VENDOR_KEY)));
}

function mountRow(p, vendorKey){
  const c = p.clienteSnapshot || p.cliente || {};
  const total = p?.totais?.total ?? p.total ?? 0;
  const qtd   = Array.isArray(p?.itens) ? p.itens.length : 0;
  const numero= p?.numero_pedido_ecommerce || p?.key || "—";
  const st    = pdNormStatus(p.status || p.situacao || "aprovado");

  const row = document.createElement("div");
  row.className = "pd-row";

  const colCliente = document.createElement("div");
  const nm = document.createElement("div"); nm.textContent = c?.nome || "—"; nm.style.fontWeight="600"; nm.style.color="#111827";
  const em = document.createElement("div"); em.textContent = c?.email || ""; em.style.fontSize="12px"; em.style.color="#6b7280";
  colCliente.appendChild(nm); colCliente.appendChild(em);

  const colCpf = document.createElement("div"); colCpf.textContent = c?.cpfCnpj || c?.cpf_cnpj || "—"; colCpf.style.color="#374151";
  const colData = document.createElement("div"); colData.textContent = pdFmtDate(p?.createdAt || p?.data);
  const colTotal= document.createElement("div"); colTotal.textContent=pdFmtBRL(total);
  const colItens= document.createElement("div"); colItens.textContent=String(qtd); colItens.style.textAlign="right";
  const colNum  = document.createElement("div"); colNum.textContent= numero;

  const colSitu = document.createElement("div"); colSitu.appendChild(pdBadgeEl(st));

  const colAcoes = document.createElement("div"); colAcoes.style.textAlign="right";
  const btn = document.createElement("button"); btn.textContent="Ver"; btn.className="pd-btn-sec";
  btn.addEventListener("click", ()=> pdOpenModal(p, vendorKey, numero));
  colAcoes.appendChild(btn);

  row.append(colCliente, colCpf, colData, colTotal, colItens, colNum, colSitu, colAcoes);
  return row;
}
