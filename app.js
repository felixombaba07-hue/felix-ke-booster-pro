const state = { token: localStorage.getItem("fkbp_token"), services: [], platform: "all" };

const $ = (s) => document.querySelector(s);
const modal = $("#modal");

function api(path, options={}) {
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(path,{...options,headers}).then(async r=>{
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function openModal(html){$("#modalContent").innerHTML=html;modal.classList.remove("hidden")}
function closeModal(){modal.classList.add("hidden")}
$("#closeModal").onclick=closeModal;
modal.onclick=e=>{if(e.target===modal)closeModal()};
$("#menuBtn").onclick=()=>$("#nav").classList.toggle("open");

function authModal(mode="login"){
  openModal(`
    <h2>${mode==="login"?"Welcome back":"Create your account"}</h2>
    <form id="authForm" class="form">
      ${mode==="register"?'<label>Full name<input name="fullName" required></label>':''}
      <label>Email<input type="email" name="email" required></label>
      <label>Password<input type="password" name="password" minlength="8" required></label>
      <button class="btn">${mode==="login"?"Login":"Create Account"}</button>
      <div id="authError" class="error"></div>
      <button type="button" id="switchAuth" class="btn ghost">${mode==="login"?"Create an account":"I already have an account"}</button>
    </form>`);
  $("#authForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), body=Object.fromEntries(fd.entries());
    try{
      const data=await api(`/api/auth/${mode}`,{method:"POST",body:JSON.stringify(body)});
      state.token=data.token;localStorage.setItem("fkbp_token",state.token);closeModal();renderDashboard();
    }catch(err){$("#authError").textContent=err.message}
  };
  $("#switchAuth").onclick=()=>authModal(mode==="login"?"register":"login");
}
$("#loginBtn").onclick=()=>authModal("login");
$("#heroLogin").onclick=()=>authModal("register");
$("#dashLogin").onclick=()=>authModal("login");
$("#supportLogin").onclick=()=>authModal("login");

async function loadServices(){
  state.services=await api("/api/services");
  const platforms=["all",...new Set(state.services.map(s=>s.platform))];
  $("#filters").innerHTML=platforms.map(p=>`<button class="filter ${p==="all"?"active":""}" data-p="${p}">${p==="all"?"All":p}</button>`).join("");
  document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{
    state.platform=b.dataset.p;
    document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderServices();
  });
  renderServices();
}
function renderServices(){
  const q=$("#search").value.toLowerCase();
  const list=state.services.filter(s=>(state.platform==="all"||s.platform===state.platform)&&
    `${s.name} ${s.description}`.toLowerCase().includes(q));
  $("#servicesGrid").innerHTML=list.map(s=>`
    <article class="service">
      <div class="service-top"><div class="platform">${s.platform}</div><div class="price">KSh ${Number(s.price_per_1000).toLocaleString()}<small>/1K</small></div></div>
      <h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.description)}</p>
      <div class="meta"><span class="tag">Min ${s.min_quantity}</span><span class="tag">Max ${s.max_quantity}</span><span class="tag">${escapeHtml(s.delivery_estimate)}</span></div>
      <button class="btn" onclick="orderService('${s.id}')">Order</button>
    </article>`).join("") || `<div class="notice">No services match your search.</div>`;
}
$("#search").oninput=renderServices;

window.orderService=async function(id){
  if(!state.token) return authModal("login");
  const s=state.services.find(x=>x.id===id);
  openModal(`
    <h2>Order ${escapeHtml(s.name)}</h2>
    <form id="orderForm" class="form">
      <label>Public target URL or username<input name="target" placeholder="https://..." required></label>
      <label>Quantity<input type="number" name="quantity" min="${s.min_quantity}" max="${s.max_quantity}" value="${s.min_quantity}" required></label>
      <div class="notice">Estimated total: <b id="orderTotal">KSh 0.00</b></div>
      <div id="orderError" class="error"></div>
      <button class="btn">Place Order</button>
    </form>`);
  const q=$("#orderForm [name=quantity]"), total=$("#orderTotal");
  const calc=()=>total.textContent=`KSh ${(Number(q.value||0)/1000*Number(s.price_per_1000)).toFixed(2)}`;
  q.oninput=calc;calc();
  $("#orderForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    try{
      const result=await api("/api/orders",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({
        serviceId:id,target:fd.get("target"),quantity:Number(fd.get("quantity"))
      })});
      openModal(`<h2>Order received</h2><p class="success">Order ${escapeHtml(result.id)} has status <b>${escapeHtml(result.status)}</b>.</p><p>We only request public target information. Never share your password or 2FA code.</p><button class="btn" onclick="closeModal();renderDashboard()">Done</button>`);
      renderDashboard();
    }catch(err){$("#orderError").textContent=err.message}
  };
};

async function renderDashboard(){
  if(!state.token){$("#dashContent").innerHTML='<p>Login to view your wallet and orders.</p><button id="dashLogin2" class="btn">Login</button>';$("#dashLogin2").onclick=()=>authModal("login");return}
  try{
    const [me,wallet,orders]=await Promise.all([api("/api/me"),api("/api/wallet"),api("/api/orders")]);
    $("#dashContent").innerHTML=`
      <div class="dash-grid">
        <div><div class="eyebrow">WELCOME</div><h3>${escapeHtml(me.full_name)}</h3><p>${escapeHtml(me.email)}</p></div>
        <div><div class="eyebrow">WALLET BALANCE</div><div class="balance">KSh ${Number(wallet.balance).toLocaleString()}</div><button id="deposit" class="btn">Deposit with Paystack</button> <button id="logout" class="btn ghost">Logout</button></div>
      </div>
      <hr style="border-color:#173047;border-width:1px 0 0;margin:25px 0">
      <h3>Recent orders</h3>
      ${orders.length?orders.map(o=>`<div class="order"><div><b>${escapeHtml(o.service_name)}</b><br><small>${escapeHtml(o.target)}</small></div><div><span class="status">${escapeHtml(o.status)}</span><br><b>KSh ${Number(o.total).toFixed(2)}</b></div></div>`).join(""):"<p>No orders yet.</p>"}`;
    $("#logout").onclick=()=>{state.token=null;localStorage.removeItem("fkbp_token");renderDashboard()};
    $("#deposit").onclick=depositModal;
  }catch(err){$("#dashContent").innerHTML=`<p class="error">${escapeHtml(err.message)}</p>`}
}

function depositModal(){
  openModal(`<h2>Add funds</h2><form id="depositForm" class="form"><label>Amount (KES)<input name="amount" type="number" min="50" max="1000000" value="500" required></label><p class="notice">You will be redirected to Paystack. Your wallet is credited only after server-side verification.</p><div id="depositError" class="error"></div><button class="btn">Continue to Paystack</button></form>`);
  $("#depositForm").onsubmit=async e=>{
    e.preventDefault();
    try{
      const amount=Number(new FormData(e.target).get("amount"));
      const data=await api("/api/payments/paystack/initialize",{method:"POST",body:JSON.stringify({amount})});
      location.href=data.authorizationUrl;
    }catch(err){$("#depositError").textContent=err.message}
  }
}

function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

loadServices().catch(e=>console.error(e));
renderDashboard();
