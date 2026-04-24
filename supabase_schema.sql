-- =============================================================
-- 부산 AI 시민정책 비서 — Supabase DB 스키마
-- =============================================================
-- 사용법: Supabase 프로젝트의 SQL Editor에서 전체 복사 → Run
-- =============================================================

-- 시민 의견 테이블
CREATE TABLE IF NOT EXISTS citizen_inputs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  district TEXT,
  original_text TEXT NOT NULL,
  type TEXT CHECK (type IN ('질문', '제안', '질문+제안')),
  category TEXT,
  matched_policy TEXT,
  ai_summary TEXT,
  confidence TEXT,
  novelty_score INTEGER DEFAULT 0,
  impact_score INTEGER DEFAULT 0,
  feasibility_score INTEGER DEFAULT 0,
  total_score INTEGER DEFAULT 0,
  status TEXT DEFAULT '신규 접수',
  admin_memo TEXT,
  ai_answer TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 자동 updated_at 업데이트 트리거
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_citizen_inputs ON citizen_inputs;
CREATE TRIGGER trigger_update_citizen_inputs
  BEFORE UPDATE ON citizen_inputs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 인덱스 (검색 성능)
CREATE INDEX IF NOT EXISTS idx_citizen_inputs_created_at ON citizen_inputs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citizen_inputs_district ON citizen_inputs(district);
CREATE INDEX IF NOT EXISTS idx_citizen_inputs_category ON citizen_inputs(category);
CREATE INDEX IF NOT EXISTS idx_citizen_inputs_status ON citizen_inputs(status);
CREATE INDEX IF NOT EXISTS idx_citizen_inputs_type ON citizen_inputs(type);

-- =============================================================
-- 오류 신고 테이블
-- =============================================================
CREATE TABLE IF NOT EXISTS error_reports (
  id BIGSERIAL PRIMARY KEY,
  citizen_input_id BIGINT REFERENCES citizen_inputs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT CHECK (reason IN ('사실관계 오류', '공약 내용 오류', '부적절한 표현', '답변 누락', '기타')),
  detail TEXT,
  status TEXT DEFAULT '접수'
);

CREATE INDEX IF NOT EXISTS idx_error_reports_status ON error_reports(status);

-- =============================================================
-- Row Level Security (RLS) 설정
-- =============================================================
-- 익명 사용자는 INSERT만 가능, 읽기·수정은 인증된 사용자만

ALTER TABLE citizen_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY;

-- 익명 사용자: 시민 의견 접수 허용
DROP POLICY IF EXISTS "anon can insert citizen inputs" ON citizen_inputs;
CREATE POLICY "anon can insert citizen inputs" ON citizen_inputs
  FOR INSERT TO anon WITH CHECK (true);

-- 익명 사용자: 오류 신고 접수 허용
DROP POLICY IF EXISTS "anon can insert error reports" ON error_reports;
CREATE POLICY "anon can insert error reports" ON error_reports
  FOR INSERT TO anon WITH CHECK (true);

-- 익명 사용자: 자기가 올린 의견 읽기 (초기 데모용 — 보안 강화 시 제거 가능)
DROP POLICY IF EXISTS "anon can read citizen inputs" ON citizen_inputs;
CREATE POLICY "anon can read citizen inputs" ON citizen_inputs
  FOR SELECT TO anon USING (true);

-- 익명 사용자: 상태 업데이트 허용 (데모용 — 운영시에는 반드시 제거하고 service_role로만)
-- 운영 시 이 정책은 삭제하고, 캠프 대시보드에서는 service_role 키로 접근하세요
DROP POLICY IF EXISTS "anon can update status (demo only)" ON citizen_inputs;
CREATE POLICY "anon can update status (demo only)" ON citizen_inputs
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- =============================================================
-- 통계 뷰 (대시보드용)
-- =============================================================
CREATE OR REPLACE VIEW v_district_stats AS
SELECT
  district,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE type = '질문') AS q_count,
  COUNT(*) FILTER (WHERE type = '제안') AS s_count,
  COUNT(*) FILTER (WHERE type = '질문+제안') AS qs_count,
  COUNT(*) FILTER (WHERE status = '공약 반영 후보') AS adopted
FROM citizen_inputs
WHERE district IS NOT NULL
GROUP BY district
ORDER BY total DESC;

CREATE OR REPLACE VIEW v_category_stats AS
SELECT
  category,
  COUNT(*) AS total,
  AVG(total_score) AS avg_score
FROM citizen_inputs
WHERE category IS NOT NULL
GROUP BY category
ORDER BY total DESC;

-- =============================================================
-- 샘플 데이터 (테스트용, 선택)
-- =============================================================
-- INSERT INTO citizen_inputs (district, original_text, type, category, status)
-- VALUES
--   ('해운대구', '광안대교 야간 경관 조명을 더 다양하게 해주세요', '제안', '관광매력', '공약 반영 후보'),
--   ('강서구', '가덕신공항 언제 개항하나요?', '질문', '교통편리', '답변 완료'),
--   ('북구', '화명금곡 재건축 속도를 높여주세요', '제안', '도심개조', '전문가 검토');
