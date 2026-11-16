/* 기기 내 계정·순위·백업 서비스. 다른 기기/사용자 서버를 가장하지 않습니다. */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const bytes = value => new TextEncoder().encode(value);
  const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
  // 비보안 asset origin에서도 평문 비밀번호를 저장하지 않기 위한 SHA-256 fallback.
  function sha256(input) {
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const data=new Uint8Array(Math.ceil((input.length+9)/64)*64);data.set(input);data[input.length]=128;
    const view=new DataView(data.buffer);view.setUint32(data.length-4,input.length*8);view.setUint32(data.length-8,Math.floor(input.length/0x20000000));
    const rr=(x,n)=>(x>>>n)|(x<<(32-n)),w=new Uint32Array(64);
    for(let offset=0;offset<data.length;offset+=64){
      for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
      for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rr(x,7)^rr(x,18)^(x>>>3))+w[i-7]+(rr(y,17)^rr(y,19)^(y>>>10)))>>>0}
      let [a,b,c,d,e,f,g,h]=H;
      for(let i=0;i<64;i++){const t1=(h+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}
      [a,b,c,d,e,f,g,h].forEach((v,i)=>H[i]=(H[i]+v)>>>0);
    }
    const out=new Uint8Array(32),outView=new DataView(out.buffer);H.forEach((v,i)=>outView.setUint32(i*4,v));return out;
  }
  function hmac(key,message){if(key.length>64)key=sha256(key);const inner=new Uint8Array(64+message.length),outer=new Uint8Array(96);for(let i=0;i<64;i++){inner[i]=(key[i]||0)^0x36;outer[i]=(key[i]||0)^0x5c}inner.set(message,64);outer.set(sha256(inner),64);return sha256(outer)}
  async function passwordHash(password,salt,iterations){
    const key=bytes(password),saltBytes=bytes(salt);
    if(globalThis.crypto?.subtle){const imported=await crypto.subtle.importKey('raw',key,'PBKDF2',false,['deriveBits']);return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:saltBytes,iterations,hash:'SHA-256'},imported,256)))}
    const block=new Uint8Array(saltBytes.length+4);block.set(saltBytes);block[block.length-1]=1;
    let u=hmac(key,block),result=u.slice();for(let i=1;i<iterations;i++){u=hmac(key,u);for(let j=0;j<32;j++)result[j]^=u[j];if(i%500===0)await new Promise(r=>setTimeout(r,0))}return hex(result);
  }
  window.MajorWordsLocalService = {
    async request(path,body,method,context){
      const {state,save,newId}=context;state.localAccounts=state.localAccounts||[];state.localBackups=state.localBackups||{};
      const accounts=state.localAccounts;
      const userData=a=>({id:a.id,nickname:a.example?(a.nickname||'예시 학습자'):a.identity,email:a.identity.includes('@')?a.identity:'',major:state.profiles[a.id]?.major||null,local:true});
      if(path==='auth/register'){
        const identity=String(body.identity||'').trim(),password=String(body.password||'');
        if(!identity||! /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password))throw Error('아이디와 영문·숫자를 포함한 8자 이상 비밀번호를 입력해주세요.');
        if(accounts.some(a=>a.identity.toLowerCase()===identity.toLowerCase()))throw Error('이미 이 기기에 등록된 아이디입니다.');
        const salt=newId(),iterations=globalThis.crypto?.subtle?120000:12000,hash=await passwordHash(password,salt,iterations);
        const a={id:'local-'+newId(),identity,salt,hash,iterations};accounts.push(a);save();return {user:userData(a)};
      }
      if(path==='auth/login'){
        const a=accounts.find(a=>a.identity.toLowerCase()===String(body.identity||'').trim().toLowerCase());
        if(!a||await passwordHash(body.password,a.salt,a.iterations)!==a.hash)throw Error('아이디 또는 비밀번호를 확인해주세요.');
        return {user:userData(a)};
      }
      if(path==='auth/logout')return {};
      const a=accounts.find(a=>a.id===state.session?.user?.id);if(!a)throw Error('이 기기의 로컬 계정으로 로그인해주세요.');
      if(path==='account/major'){a.major=body.major;save();return {}}
      if(path==='learning'&&method==='DELETE'){delete state.localBackups[a.id];save();return {}}
      if(path==='sync'){
        state.localBackups[a.id]={profile:clone(body.profile),savedAt:new Date().toISOString()};save();return {profile:clone(body.profile)};
      }
      if(path==='rankings'){
        const users=accounts.map(a=>({id:a.id,nickname:a.example?(a.nickname||'예시 학습자'):a.identity,score:(state.rankingProfiles?.[a.id]?.history||[]).reduce((sum,r)=>sum+r.score,0)})).sort((a,b)=>b.score-a.score||a.nickname.localeCompare(b.nickname));
        users.forEach((u,i)=>u.rank=i&&u.score===users[i-1].score?users[i-1].rank:i+1);
        return {users,me:users.find(u=>u.id===a.id)};
      }
      throw Error('지원하지 않는 로컬 요청입니다.');
    }
  };
})();
