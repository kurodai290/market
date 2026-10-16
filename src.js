import bcrypt from "bcryptjs";

const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", ...headers }
});
const fail = (message, status=400) => json({error:message}, status);
const cookieValue = (request, name) => {
  const raw = request.headers.get("Cookie") || "";
  const part = raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));
  return part ? decodeURIComponent(part.slice(name.length+1)) : null;
};
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64 = value => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4)), c=>c.charCodeAt(0));
async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
async function makeSession(userId, secret) {
  const payload = b64(new TextEncoder().encode(JSON.stringify({id:userId, exp:Date.now()+7*86400000})));
  return payload+"."+await sign(payload,secret);
}
async function readSession(request, secret) {
  try {
    const token=cookieValue(request,"market.sid"); if(!token) return null;
    const [payload,sig]=token.split("."); if(!payload||!sig||await sign(payload,secret)!==sig) return null;
    const data=JSON.parse(new TextDecoder().decode(unb64(payload)));
    return data.exp>Date.now()?data.id:null;
  } catch { return null; }
}
const setCookie = token => `market.sid=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
const clearCookie = "market.sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
async function body(req){try{return await req.json()}catch{return {}}}
async function user(db,id){return db.prepare("SELECT id, username, coins FROM users WHERE id=?").bind(id).first()}
async function stocks(db){
  const meta=await db.prepare("SELECT value FROM settings WHERE key='stock_tick'").first();
  const now=Date.now();
  if(!meta || now-Number(meta.value)>=60000){
    const rows=await db.prepare("SELECT id,price FROM stocks").all();
    const stmts=rows.results.map(s=>{
      const price=Math.max(1,Math.min(100000,s.price+Math.floor(Math.random()*7)-3));
      return db.prepare("UPDATE stocks SET previous_price=?,price=? WHERE id=?").bind(s.price,price,s.id);
    });
    stmts.push(db.prepare("INSERT INTO settings(key,value) VALUES('stock_tick',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(now)));
    await db.batch(stmts);
  }
  return (await db.prepare("SELECT id,symbol,name,price,previous_price FROM stocks ORDER BY id").all()).results;
}
export default {
 async fetch(request, env) {
  const url=new URL(request.url), path=url.pathname, method=request.method;
  if(path.startsWith("/api/")) {
   const db=env.DB, secret=env.SESSION_SECRET;
   if(!db) return fail("D1データベースが設定されていません。",500);
   if(!secret) return fail("SESSION_SECRET が設定されていません。",500);
   const uid=await readSession(request,secret);
   try {
    if(path==="/api/health"&&method==="GET") return json({ok:true,service:"coin-market-game-cloudflare"});
    if(path==="/api/register"&&method==="POST"){
      const d=await body(request), username=String(d.username||"").trim(), password=String(d.password||"");
      if(!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) return fail("ユーザー名は3〜24文字、文字・数字・_・-が使えます。");
      if(password.length<8||password.length>72) return fail("パスワードは8〜72文字にしてください。");
      const hash=await bcrypt.hash(password,12);
      try {
        const r=await db.prepare("INSERT INTO users(username,password_hash,coins) VALUES(?,?,100)").bind(username,hash).run();
        const id=r.meta.last_row_id, token=await makeSession(id,secret);
        return json({user:await user(db,id)},200,{"Set-Cookie":setCookie(token)});
      } catch(e) { if(String(e).toLowerCase().includes("unique")) return fail("そのユーザー名はすでに使われています。",409); throw e; }
    }
    if(path==="/api/login"&&method==="POST"){
      const d=await body(request), username=String(d.username||"").trim(), password=String(d.password||"");
      const u=await db.prepare("SELECT id,username,password_hash,coins FROM users WHERE username=?").bind(username).first();
      if(!u||!(await bcrypt.compare(password,u.password_hash))) return fail("ユーザー名またはパスワードが違います。",401);
      return json({user:{id:u.id,username:u.username,coins:u.coins}},200,{"Set-Cookie":setCookie(await makeSession(u.id,secret))});
    }
    if(path==="/api/logout"&&method==="POST") return json({ok:true},200,{"Set-Cookie":clearCookie});
    if(path==="/api/me"&&method==="GET") return json({user:uid?await user(db,uid):null});
    if(path==="/api/products"&&method==="GET"){
      const r=await db.prepare("SELECT p.id,p.name,p.description,p.price,p.seller_id,u.username seller FROM products p JOIN users u ON u.id=p.seller_id WHERE p.sold=0 ORDER BY p.id DESC LIMIT 100").all();
      return json({products:r.results});
    }
    if(path==="/api/stocks"&&method==="GET") return json({stocks:await stocks(db)});
    if(path==="/api/earn"&&method==="POST"){
      if(!uid)return fail("先にログインしてください。",401);
      await db.batch([
        db.prepare("UPDATE users SET coins=coins+1 WHERE id=?").bind(uid),
        db.prepare("INSERT INTO transactions(user_id,kind,detail,amount) VALUES(?,'earn','クリックで1コイン獲得',1)").bind(uid)
      ]);
      return json({user:await user(db,uid)});
    }
    if(path==="/api/products"&&method==="POST"){
      if(!uid)return fail("先にログインしてください。",401);
      const d=await body(request),name=String(d.name||"").trim(),description=String(d.description||"").trim(),price=Number(d.price);
      if(!name||name.length>80)return fail("商品名は1〜80文字です。");
      if(description.length>500)return fail("説明は500文字以内です。");
      if(!Number.isSafeInteger(price)||price<1||price>100000000)return fail("価格は1〜100,000,000コインで入力してください。");
      const r=await db.prepare("INSERT INTO products(seller_id,name,description,price) VALUES(?,?,?,?)").bind(uid,name,description,price).run();
      return json({product:{id:r.meta.last_row_id,name,description,price,seller_id:uid}});
    }
    const buyMatch=path.match(/^\/api\/products\/(\d+)\/buy$/);
    if(buyMatch&&method==="POST"){
      if(!uid)return fail("先にログインしてください。",401);
      const p=await db.prepare("SELECT * FROM products WHERE id=? AND sold=0").bind(Number(buyMatch[1])).first();
      if(!p)return fail("商品は売り切れています。",404);
      if(p.seller_id===uid)return fail("自分の商品は購入できません。");
      const buyer=await user(db,uid);
      if(!buyer||buyer.coins<p.price)return fail("コインが足りません。");
      // Conditional updates prevent purchases with an insufficient balance or already-sold listing.
      const result=await db.batch([
        db.prepare("UPDATE users SET coins=coins-? WHERE id=? AND coins>=?").bind(p.price,uid,p.price),
        db.prepare("UPDATE users SET coins=coins+? WHERE id=? AND EXISTS(SELECT 1 FROM products WHERE id=? AND sold=0)").bind(p.price,p.seller_id,p.id),
        db.prepare("UPDATE products SET sold=1 WHERE id=? AND sold=0").bind(p.id),
        db.prepare("INSERT INTO transactions(user_id,kind,detail,amount) VALUES(?,'buy',?,?)").bind(uid,"商品購入："+p.name,-p.price),
        db.prepare("INSERT INTO transactions(user_id,kind,detail,amount) VALUES(?,'sale',?,?)").bind(p.seller_id,"商品売却："+p.name,p.price)
      ]);
      if(!result[0].meta.changes || !result[2].meta.changes) return fail("購入処理が競合しました。ページを更新してください。",409);
      return json({user:await user(db,uid)});
    }
    if(path==="/api/mine"&&method==="GET"){
      if(!uid)return fail("先にログインしてください。",401);
      const [p,h]=await Promise.all([
        db.prepare("SELECT id,name,description,price,sold FROM products WHERE seller_id=? ORDER BY id DESC").bind(uid).all(),
        db.prepare("SELECT kind,detail,amount,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 20").bind(uid).all()
      ]);
      return json({products:p.results,history:h.results});
    }
    if(path==="/api/holdings"&&method==="GET"){
      if(!uid)return fail("先にログインしてください。",401);
      const h=await db.prepare("SELECT s.id,s.symbol,s.name,s.price,h.quantity FROM holdings h JOIN stocks s ON s.id=h.stock_id WHERE h.user_id=? ORDER BY s.id").bind(uid).all();
      return json({holdings:h.results});
    }
    if(path==="/api/stocks/trade"&&method==="POST"){
      if(!uid)return fail("先にログインしてください。",401);
      const d=await body(request),stockId=Number(d.stockId),quantity=Number(d.quantity),side=d.side;
      if(!Number.isInteger(stockId)||!Number.isInteger(quantity)||quantity<1||quantity>10000||!["buy","sell"].includes(side))return fail("取引内容が正しくありません。");
      const s=await db.prepare("SELECT * FROM stocks WHERE id=?").bind(stockId).first();
      if(!s)return fail("株が見つかりません。",404);
      const total=s.price*quantity, h=await db.prepare("SELECT quantity FROM holdings WHERE user_id=? AND stock_id=?").bind(uid,stockId).first();
      const held=h?.quantity||0, u=await user(db,uid);
      if(side==="buy"&&u.coins<total)return fail("コインが足りません。");
      if(side==="sell"&&held<quantity)return fail("保有株数が足りません。");
      await db.batch([
        db.prepare("INSERT INTO holdings(user_id,stock_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,stock_id) DO UPDATE SET quantity=holdings.quantity+excluded.quantity").bind(uid,stockId,side==="buy"?quantity:-quantity),
        db.prepare("UPDATE users SET coins=coins+? WHERE id=?").bind(side==="buy"?-total:total,uid),
        db.prepare("INSERT INTO transactions(user_id,kind,detail,amount) VALUES(?,?,?,?)").bind(uid,"stock_"+side,`${s.name} ${side==="buy"?"購入":"売却"} ${quantity}株`,side==="buy"?-total:total)
      ]);
      return json({user:await user(db,uid)});
    }
    return fail("APIが見つかりません。",404);
   } catch(e) { console.error("API error",e); return fail("サーバーでエラーが発生しました。",500); }
  }
  return env.ASSETS.fetch(request);
 }
};
