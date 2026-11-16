(function(){
 'use strict';
 class ApiError extends Error{constructor(message,status=0,code='NETWORK_ERROR'){super(message);this.name='ApiError';this.status=status;this.code=code}}
 function create(config,{fetchImpl=globalThis.fetch,getToken=()=>null,isOnline=()=>navigator.onLine}={}){
  async function request(path,body,method,options={}){
   if(!isOnline())throw new ApiError('인터넷 연결을 확인해주세요.',0,'OFFLINE');
   const base=String(config.apiBaseUrl||'').replace(/\/$/,'');if(!base)throw new ApiError('API 서버 주소가 설정되지 않았습니다.',0,'NOT_CONFIGURED');
   const endpoint=new URL(base+'/',globalThis.location?.href);if(!['http:','https:'].includes(endpoint.protocol))throw new ApiError('HTTP 또는 HTTPS API 주소가 필요합니다.',0,'INVALID_URL');
   if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw new ApiError('서버 연결에는 HTTPS 주소가 필요합니다.',0,'INSECURE_URL');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(config.apiTimeoutMs)||10000),verb=method||(body?'POST':'GET');
   try{const token=await getToken(),headers={Accept:'application/json','X-Major-Words-API-Version':'1'};if(body!==undefined)headers['Content-Type']='application/json';if(config.apiAuthMode==='bearer'){if(token)headers.Authorization='Bearer '+token;else if(!path.startsWith('auth/'))throw new ApiError('로그인이 필요합니다.',401,'AUTH_REQUIRED')}
    if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
    const res=await fetchImpl(new URL(path,endpoint).href,{method:verb,credentials:config.apiAuthMode==='bearer'?'omit':'include',headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    if(res.status===204)return {};let data;try{data=await res.json()}catch{throw new ApiError('서버 응답 형식이 올바르지 않습니다.',res.status,'INVALID_RESPONSE')}
    if(!res.ok){const messages={401:'로그인이 만료되었거나 계정 정보가 올바르지 않습니다.',403:'요청 권한이 없습니다.',409:'기록이 변경되었습니다. 다시 동기화해주세요.',429:'요청이 많습니다. 잠시 후 다시 시도해주세요.'};throw new ApiError(messages[res.status]||'서버 요청을 완료하지 못했습니다.',res.status,data?.error?.code||'HTTP_ERROR')}
    return data;
   }catch(e){if(e instanceof ApiError)throw e;if(e.name==='AbortError')throw new ApiError('서버 응답 시간이 초과되었습니다.',0,'TIMEOUT');throw new ApiError('서버에 연결하지 못했습니다. 기록은 기기에 유지됩니다.',0,'NETWORK_ERROR')}finally{clearTimeout(timer)}
  }
  return {request};
 }
 globalThis.MajorWordsServerClient={create,ApiError};
})();
