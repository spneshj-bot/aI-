// Vercel Serverless Function — 박형준 캠프 AI 챗봇 프록시 (OpenAI API)
// 파일 위치: 프로젝트 루트의 /api/openai.js
//
// 환경변수 등록 (Vercel 대시보드 → Project → Settings → Environment Variables):
//   OPENAI_API_KEY = sk-proj-xxxxxxxxxxxxx
//
// 이 파일은 OpenAI(ChatGPT)를 쓰는 경우만 필요. Anthropic Claude만 쓸 거면 생략 가능.

const ALLOWED_ORIGINS = [
  'https://parkhyungjun2026.com',
  'https://www.parkhyungjun2026.com',
];

const RATE_LIMIT_PER_MINUTE = 30;
const rateLimitMap = new Map();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    setCorsHeaders(req, res);
    return res.status(405).json({ error: 'POST 만 허용' });
  }

  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: '허용되지 않은 도메인' });
  }
  setCorsHeaders(req, res);

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

    if (!message || typeof message !== 'string' || message.length > 2000) {
      return res.status(400).json({ error: 'message 형식 오류' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'OpenAI API 키가 서버에 설정되지 않았습니다.'
      });
    }

    const systemPrompt = buildSystemPrompt(context);

    const apiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 800,
        temperature: 0.4,
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      console.error('OpenAI API error:', apiResp.status, errText);
      return res.status(502).json({ error: 'OpenAI 일시 오류' });
    }

    const data = await apiResp.json();
    const answer = data.choices?.[0]?.message?.content || '답변을 생성하지 못했습니다.';

    return res.status(200).json({ answer, model: 'openai' });

  } catch (e) {
    console.error('handler error:', e);
    return res.status(500).json({ error: '요청 처리 중 오류: ' + e.message });
  }
}

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function buildSystemPrompt(context) {
  return `당신은 박형준 부산시장 본인의 입장과 톤으로 답변하는 AI 정책비서입니다. 박형준 시장이 실제로 발화한 적 없는 문장을 직접 인용하지 마세요. 1인칭 "저는~" 또는 시정 시점 "부산은~"으로 답변합니다.

# 회피 표현 절대 금지
- "죄송합니다" / "준비하지 못했습니다" / "충분한 답변이 어렵습니다"
- 답변을 미루는 모든 표현 → 시장님의 비전·시정 방향으로 답변

# 박형준 시장 페르소나
- 시작어: "저는 ~라고 생각합니다", "저는 감히 말씀드리겠는데"
- 끝맺음: "~있습니다", "~생각합니다", "~하겠습니다"
- 시그니처 어휘: 부산만의, 실행력, 완성도, 진단·처방·집도

# 답변 길이: 180~280자

# 컨텍스트
${context || '컨텍스트 없음 — 박형준 시장의 일반 비전 기준으로 답변'}`;
}
