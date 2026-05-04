// Vercel Serverless Function — 박형준 캠프 AI 챗봇 프록시 (Claude API)
// 파일 위치: 프로젝트 루트의 /api/claude.js
//
// 환경변수 등록 (Vercel 대시보드 → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY = sk-ant-api03-xxxxxxxxxxxxx
//
// 배포: Vercel 대시보드에서 자동 배포 (GitHub push 또는 직접 업로드)

// 캠프 도메인 — 실제 도메인으로 변경. 배포 후 Vercel이 자동 발급한 도메인도 추가.
const ALLOWED_ORIGINS = [
  'https://parkhyungjun2026.com',  // 캠프 실제 도메인 (있을 경우)
  'https://www.parkhyungjun2026.com',
  // Vercel이 발급해주는 도메인. 배포 후 실제 발급된 도메인으로 변경.
  // 예: 'https://park-bs-campaign.vercel.app'
];

// 빈도 제한
const RATE_LIMIT_PER_MINUTE = 30;
const rateLimitMap = new Map();

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    setCorsHeaders(req, res);
    return res.status(405).json({ error: 'POST 만 허용' });
  }

  // CORS 검증 — 같은 도메인 호출(Origin 없음)도 허용 (Vercel에서 함께 호스팅 시)
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: '허용되지 않은 도메인' });
  }
  setCorsHeaders(req, res);

  // 빈도 제한
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
  const reqs = rateLimitMap.get(ip).filter(t => now - t < 60000);
  reqs.push(now);
  rateLimitMap.set(ip, reqs);
  if (reqs.length > RATE_LIMIT_PER_MINUTE) {
    return res.status(429).json({
      error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    });
  }

  try {
    const { message, context } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message가 필요합니다' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'message가 너무 깁니다 (최대 2000자)' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'API 키가 서버에 설정되지 않았습니다. 관리자에게 문의해 주세요.'
      });
    }

    const systemPrompt = buildSystemPrompt(context);

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      console.error('Anthropic API error:', apiResp.status, errText);
      return res.status(502).json({ error: 'AI 서비스 일시 오류' });
    }

    const data = await apiResp.json();
    const answer = data.content?.[0]?.text || '답변을 생성하지 못했습니다.';

    return res.status(200).json({ answer, model: 'claude' });

  } catch (e) {
    console.error('handler error:', e);
    return res.status(500).json({ error: '요청 처리 중 오류: ' + e.message });
  }
}

// ─── 헬퍼 함수 ────────────────────────────────
function isAllowedOrigin(origin) {
  // 정확 매칭
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // *.vercel.app 자동 허용 (배포 직후 도메인을 모를 때)
  if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // 같은 도메인 요청(Vercel에서 함께 호스팅 시)은 Origin 헤더 없음 — 별도 처리 불필요
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function buildSystemPrompt(context) {
  return `당신은 박형준 부산시장 본인의 입장과 톤으로 답변하는 AI 정책비서입니다. 박형준 시장이 실제로 발화한 적 없는 문장을 직접 인용하지 마세요. 1인칭 "저는~" 또는 시정 시점 "부산은~"으로 답변합니다.

# 회피 표현 절대 금지
- "죄송합니다" / "준비하지 못했습니다" / "충분한 답변이 어렵습니다"
- "정확한 정보가 없습니다" / "다음에 답변드리겠습니다"
- 답변을 미루는 모든 표현
- 대신 시장님의 비전·시정 방향·관련 공약으로 답변

# 박형준 시장 페르소나 (시그니처)
- 자주 쓰는 시작어: "저는 ~라고 생각합니다", "저는 감히 말씀드리겠는데", "5년 전 부산과 지금의 부산은"
- 끝맺음: "~있습니다", "~생각합니다", "~입니다", "~하겠습니다"
- 시그니처 어휘: 부산만의, 실행력, 완성도, 연속성, 진단·처방·집도, 시민이 체감
- 시그니처 비유 (적절한 자리 1개만): "부산이라는 큰 배의 엔진을 정비하고 뱃머리를 세계도시로 전환", "주춧돌을 놓고 기둥을 세웠다면 이제 그림을 완성", "안개 낀 바다에서 등대만 바라볼 시간이 없습니다"

# 답변 길이
- 정책·비전 질문: 180~280자 (가장 흔한 길이)
- 일상 질문: 60~120자

# 컨텍스트
${context || '컨텍스트 없음 — 박형준 시장의 일반 비전·5대 핵심 공약 기준으로 답변'}`;
}
