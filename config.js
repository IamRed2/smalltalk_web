// 기본값은 서버 없이 실행되는 기기 내 로컬 모드입니다.
window.MAJOR_WORDS_CONFIG = {
  serviceMode: 'local', // 실제 서버 연결 시 'server'로 변경
  exampleAccount: true, // 예시 계정 최초 생성
  apiBaseUrl: '', // 예: https://api.example.com/v1/ (실제 주소 연결 전에는 비워둠)
  apiAuthMode: 'cookie', // 'cookie' 또는 'bearer'。bearer token 은 메모리/Flutter에서 관리
  apiTimeoutMs: 10000,
  speakingRepetitions: 3,
  pointsPerCorrect: 10,
  fallingDuration: 60, // 단어 카운트다운 게임 기본 시간(초), 최소 15초
  nativeSpeech: false
};
