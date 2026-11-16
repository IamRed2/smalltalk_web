const FRIEND_PROTOCOL = 1;
let friend = null;
let friendBluetoothAvailable = false;

function openFriendLobby() {
  closeFriendConnection();
  friend = { status: 'idle', devices: [], message: '' };
}

function friendCommand(action, data = {}) {
  return nativePost({ type: 'friendBluetooth', action, ...data });
}

function closeFriendConnection() {
  if (!friend) return;
  clearInterval(friend.timer);
  if (friend.status !== 'idle') friendCommand('stop');
  friend = null;
}

function friendView() {
  const state = friend || { status: 'idle', devices: [], message: '' };
  const match = state.match;
  const playable = state.status === 'playing' && match?.question;
  const done = state.status === 'done';
  const ready = state.status === 'connected' && state.role === 'host';
  const local = state.role === 'host' ? 0 : 1;
  const scores = match?.scores || [0, 0];
  return `<section class="duel-page duel-lobby">
    <header class="detail-page-heading">
      <button class="detail-back" data-nav="battle-hub" aria-label="대결 메뉴로 돌아가기">←</button>
      <div><h1>친구와 대결</h1><p class="muted">블루투스 · 동시 정답 대결</p></div>
    </header>
    ${playable || done ? `<div class="duel-scoreboard">
      <div><small>나</small><b>${scores[local]}점</b></div>
      <div><small>친구</small><b>${scores[1-local]}점</b></div>
    </div>` : ''}
    ${playable ? `<div class="duel-clock"><span>남은 시간</span><b id="friend-time"></b></div>
      <div class="quiz-expression"><small>${match.round+1}번째 문제</small><h2>${esc(match.question.prompt)}</h2></div>
      <div class="choices">${match.question.options.map(option=>`<button data-friend-answer="${esc(option.id)}" ${state.pending||match.blocked[local]?'disabled':''}>${esc(option.text)}</button>`).join('')}</div>` : ''}
    ${done ? `<h2>${scores[local]===scores[1-local]?'무승부':scores[local]>scores[1-local]?'승리':'패배'}</h2>` : ''}
    <p class="muted" role="status">${esc(state.message)}</p>
    ${state.status === 'idle' ? `<p>두 Android 기기를 블루투스 설정에서 먼저 페어링하세요.</p>
      ${friendBluetoothAvailable?'':'<p class="muted">블루투스 연결을 지원하는 Android 앱에서 이용할 수 있습니다.</p>'}
      <div class="actions"><button id="friend-host" ${friendBluetoothAvailable?'':'disabled'}>방 만들기</button>
      <button id="friend-devices" ${friendBluetoothAvailable?'':'disabled'}>페어링된 친구 찾기</button></div>
      <div class="stack">${state.devices.map(device=>`<button data-friend-device="${esc(device.id)}">${esc(device.name)}</button>`).join('')}</div>` : ''}
    ${ready ? `<label class="field">제한시간<select id="friend-duration"><option value="20000">20초</option><option value="30000">30초</option><option value="60000">1분</option></select></label>
      <button class="primary wide" id="friend-start">대결 시작</button>` : ''}
    ${state.status !== 'idle' && !playable ? '<button class="wide" id="friend-stop">연결 종료</button>' : ''}
  </section>`;
}

function bindFriend() {
  on('#friend-host','click',()=>friendConnect('host'));
  on('#friend-devices','click',()=>friendCommand('devices'));
  on('#friend-start','click',startFriendMatch);
  on('#friend-stop','click',()=>{openFriendLobby();render()});
  document.querySelectorAll('[data-friend-device]').forEach(button=>{
    button.onclick=()=>friendConnect('join',button.dataset.friendDevice);
  });
  document.querySelectorAll('[data-friend-answer]').forEach(button=>{
    button.onclick=()=>submitFriendAnswer(button.dataset.friendAnswer);
  });
  paintFriendTime();
}

function friendConnect(role, deviceId) {
  if (!friend || friend.status !== 'idle' || !friendBluetoothAvailable) return;
  friend.role = role;
  friend.status = 'connecting';
  friend.message = role === 'host' ? '친구가 참가하기를 기다리는 중입니다.' : '친구 기기에 연결하는 중입니다.';
  friendCommand(role,{deviceId});
  render();
}

function startFriendMatch() {
  if (friend?.status !== 'connected' || friend.role !== 'host') return;
  const major = profile().major;
  const pool = expressions.filter(word=>word.major===major);
  if (!pool.length) return;
  const duration = Number($('#friend-duration')?.value);
  const limit = [20000,30000,60000].includes(duration) ? duration : 20000;
  friend.questions = duelQuestions(pool,'words');
  friend.pool = pool;
  friend.deadline = Date.now()+limit;
  friend.locks = [0,0];
  friend.ack = 0;
  friend.match = {id:uid(),major,duration:limit,round:0,scores:[0,0],blocked:[false,false]};
  friend.status = 'playing';
  friend.timer = setInterval(friendTick,100);
  publishFriendState();
}

function publishFriendState() {
  const state = friend;
  const match = state.match;
  const now = Date.now();
  match.remaining = Math.max(0,state.deadline-now);
  match.question = state.questions[match.round]
    ? {prompt:state.questions[match.round].prompt,options:state.questions[match.round].options}
    : null;
  match.blocked = state.locks.map(until=>until>now);
  if (!match.remaining) state.status = 'done';
  friendCommand('send',{packet:{protocol:FRIEND_PROTOCOL,type:'state',match,ack:state.ack,done:state.status==='done',message:state.message}});
  state.updated = now;
  state.lastSent = now;
  if (state.status === 'done') saveFriendResult();
  render();
}

function friendTick() {
  const state = friend;
  if (state?.status !== 'playing') return;
  const now = Date.now();
  if (state.role==='host' && (now>=state.deadline || now-state.lastSent>=500 ||
      state.match.blocked.some((blocked,index)=>blocked && state.locks[index]<=now))) {
    publishFriendState();
  } else if (state.role==='join' && now-state.updated>8000) {
    friendCommand('stop');
    resetFriendConnection('친구 기기의 응답이 끊겼습니다.');
  }
  paintFriendTime();
}

function paintFriendTime() {
  const el = $('#friend-time');
  if (!el || friend?.status!=='playing') return;
  el.textContent=(Math.max(0,friend.match.remaining-(Date.now()-friend.updated))/1000).toFixed(1)+'초';
}

function submitFriendAnswer(id) {
  if (friend?.status!=='playing') return;
  if (friend.role==='host') gradeFriendAnswer(0,friend.match.round,id);
  else if (!friend.pending && !friend.match.blocked[1]) {
    friend.sequence = (friend.sequence || 0)+1;
    friend.pending = friend.sequence;
    friendCommand('send',{packet:{protocol:FRIEND_PROTOCOL,type:'answer',matchId:friend.match.id,round:friend.match.round,id,sequence:friend.sequence}});
    render();
  }
}

function gradeFriendAnswer(player, round, id) {
  const state = friend;
  if (state?.status!=='playing' || state.role!=='host') return;
  const match = state.match;
  if (Date.now()>=state.deadline) {publishFriendState();return}
  if (round!==match.round || Date.now()<state.locks[player]) {publishFriendState();return}
  const question = state.questions[round];
  if (!question.options.some(option=>option.id===id)) return;
  if (id===question.word.id) {
    match.scores[player]++;
    match.round++;
    if (match.round>=state.questions.length) state.questions.push(...duelQuestions(state.pool,'words'));
    state.locks=[0,0];
    state.message='정답이 나와 다음 문제로 이동했습니다.';
  } else {
    state.locks[player]=Date.now()+2000;
    state.message='오답을 고른 쪽은 2초 뒤 다시 답할 수 있습니다.';
  }
  publishFriendState();
}

function saveFriendResult() {
  clearInterval(friend.timer);
  const match = friend.match;
  const profileData = profile();
  profileData.friendBattles ||= [];
  if (profileData.friendBattles.some(result=>result.id===match.id)) return;
  const local = friend.role==='host'?0:1;
  profileData.friendBattles.push({id:match.id,date:today(),major:match.major,duration:match.duration,score:match.scores[local],opponentScore:match.scores[1-local]});
  save();
}

function resetFriendConnection(message) {
  clearInterval(friend?.timer);
  friend={status:'idle',devices:[],message};
  render();
}

function receiveFriendPacket(packet) {
  if (packet?.protocol!==FRIEND_PROTOCOL) return;
  if (friend.role==='host') {
    if (packet.type==='answer' && packet.matchId===friend.match?.id &&
        Number.isSafeInteger(packet.sequence) && packet.sequence>friend.ack) {
      friend.ack=packet.sequence;
      gradeFriendAnswer(1,packet.round,packet.id);
    }
    return;
  }
  const match = packet.match;
  if (packet.type!=='state' || !['connected','playing'].includes(friend.status) || !match ||
      typeof match.id!=='string' || (friend.match && friend.match.id!==match.id) ||
      ![20000,30000,60000].includes(match.duration) || !Number.isFinite(match.remaining) ||
      match.remaining<0 || match.remaining>match.duration || !Number.isInteger(match.round) ||
      !Array.isArray(match.scores) || match.scores.length!==2 ||
      !match.scores.every(score=>Number.isInteger(score)&&score>=0) ||
      !Array.isArray(match.blocked) || match.blocked.length!==2 ||
      typeof match.question?.prompt!=='string' || !Array.isArray(match.question.options) ||
      !match.question.options.every(option=>typeof option?.id==='string'&&typeof option.text==='string')) return;
  if (friend.match?.round!==match.round || packet.ack>=friend.pending) friend.pending=false;
  friend.match=match;
  friend.updated=Date.now();
  friend.message=typeof packet.message==='string'?packet.message:'';
  friend.status=packet.done?'done':'playing';
  if (packet.done) saveFriendResult();
  else if (!friend.timer) friend.timer=setInterval(friendTick,100);
  render();
}

window.MajorWordsFriend = {
  receive(event) {
    if (event?.type==='availability') {
      friendBluetoothAvailable=event.available===true;
      if(friend)render();
      return;
    }
    if (!friend || page!=='duel' || duel?.mode!=='friends') return;
    if (event?.type==='devices' && friend.status==='idle') {
      friend.devices=(event.devices||[]).filter(device=>typeof device?.id==='string'&&typeof device.name==='string');
      friend.message=friend.devices.length?'방을 만든 친구 기기를 선택하세요.':'페어링된 기기가 없습니다.';
      render();
    } else if (event?.type==='connected' && friend.status==='connecting') {
      friend.status='connected';
      friend.message=friend.role==='host'?'친구가 참가했습니다.':'연결됐습니다. 방장이 시작할 때까지 기다려 주세요.';
      render();
    } else if (event?.type==='packet') receiveFriendPacket(event.packet);
    else if ((event?.type==='error'||event?.type==='disconnected') && friend.status!=='done') {
      friendCommand('stop');
      resetFriendConnection(event.message||'블루투스 연결이 종료됐습니다.');
    }
  }
};
