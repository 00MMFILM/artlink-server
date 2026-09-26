-- 서버 코드보다 먼저 적용한다. 운영 적용은 별도 승인/검증 대상이며 이 파일 생성만으로 실행되지 않는다.
-- 선행: schema-mileage.sql, 2026-09-23-profile-visibility.sql 및 기존 artist_profiles 기본 스키마.
-- 모든 profile-sync/profile-delete 쓰기가 이 함수로 전환된 뒤에만 동시 저장 보호가 완성된다.
-- 함수가 없거나 스키마가 다르면 새 API는 503으로 중단하며 기존 upsert로 우회하지 않는다.
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_artist_profile_atomic(
  p_user_id text,
  p_mode text,
  p_profile jsonb DEFAULT '{}'::jsonb,
  p_requested_public boolean DEFAULT NULL,
  p_requested_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key public.artist_profiles%ROWTYPE;
  v_old public.artist_profiles%ROWTYPE;
  v_new public.artist_profiles%ROWTYPE;
  v_exists boolean;
  v_public boolean := p_requested_public;
  v_at timestamptz := p_requested_at;
  v_stale boolean;
  v_data jsonb;
  v_result jsonb;
  v_tombstone constant jsonb := '{
    "name":"익명","email":null,"user_type":null,"fields":[],"gender":null,
    "birth_date":null,"height":null,"weight":null,"height_private":false,"weight_private":false,
    "specialties":[],"school":null,"location":null,"agency":null,"career":[],"bio":null,
    "role_models":[],"interests":[],"photo_url":null,"photos":[],"notes_count":0,"streak_days":0
  }'::jsonb;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_mode NOT IN ('full', 'visibility', 'photos', 'delete') OR p_mode IS NULL THEN
    RAISE EXCEPTION 'invalid profile request' USING ERRCODE = '22023';
  END IF;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
    RAISE EXCEPTION 'profile must be object' USING ERRCODE = '22023';
  END IF;
  IF p_requested_at IS NOT NULL AND NOT isfinite(p_requested_at) THEN
    RAISE EXCEPTION 'invalid visibility timestamp' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'visibility' AND p_requested_public IS NULL THEN
    RAISE EXCEPTION 'profilePublic required' USING ERRCODE = '22023';
  END IF;

  -- 기존 user_id 컬럼의 타입으로 먼저 정규화한다. UUID 표현 차이도 같은 잠금을 사용한다.
  v_key := jsonb_populate_record(NULL::public.artist_profiles, jsonb_build_object('user_id', p_user_id));
  -- 행이 없어도 직렬화해야 한다. FOR UPDATE만 사용하면 새 OFF와 새 ON이 모두 "없음"을 볼 수 있다.
  PERFORM pg_advisory_xact_lock(hashtextextended('artlink-profile:' || v_key.user_id::text, 0));
  SELECT * INTO v_old FROM public.artist_profiles WHERE user_id = v_key.user_id FOR UPDATE;
  v_exists := FOUND;
  v_result := jsonb_build_object('ok', true);
  IF v_exists THEN
    v_result := v_result || jsonb_build_object(
      'profilePublic', v_old.profile_public,
      'visibilityUpdatedAt', v_old.visibility_updated_at,
      'score', v_old.score, 'mileage', v_old.mileage, 'level', v_old.level
    );
  END IF;

  IF p_mode = 'delete' THEN
    v_public := false;
    -- 구버전에는 클라이언트 시각이 없다. 잠금 안에서 현재 시각/저장 시각보다 새로운 OFF를 만든다.
    v_at := greatest(date_trunc('milliseconds', clock_timestamp()),
      date_trunc('milliseconds', v_old.visibility_updated_at) + interval '1 millisecond');
  ELSIF v_public = false AND v_at IS NULL THEN
    v_at := greatest(date_trunc('milliseconds', clock_timestamp()),
      date_trunc('milliseconds', v_old.visibility_updated_at) + interval '1 millisecond');
  END IF;
  v_stale := v_at IS NOT NULL AND v_old.visibility_updated_at IS NOT NULL AND v_at <= v_old.visibility_updated_at;

  IF p_mode = 'photos' THEN
    IF NOT v_exists THEN RETURN v_result || jsonb_build_object('ignored', 'no_profile'); END IF;
    -- 사진 경로는 최신 ON을 동반해도 공개 상태를 바꾸지 않는다.
    IF v_old.profile_public = false OR v_public = false OR
       (v_at IS NOT NULL AND v_old.visibility_updated_at IS NOT NULL AND v_at < v_old.visibility_updated_at) THEN
      RETURN v_result || jsonb_build_object('ignored', 'stale_visibility');
    END IF;
    v_new := jsonb_populate_record(v_old, jsonb_build_object('photos', COALESCE(p_profile->'photos', '[]'::jsonb), 'photo_url', p_profile->'photo_url'));
    UPDATE public.artist_profiles SET photos = v_new.photos, photo_url = v_new.photo_url, updated_at = clock_timestamp()
      WHERE user_id = v_key.user_id;
    RETURN v_result;
  END IF;

  -- 비공개에서 나오는 유일한 경로는 "더 새로운 시각의 명시적 ON"이다.
  -- 시각만 새로 보낸 구버전/전체 업로드는 내용을 되살릴 수 없다.
  IF v_exists AND v_old.profile_public = false AND
     (v_public IS DISTINCT FROM true OR v_at IS NULL OR v_stale) AND v_public IS DISTINCT FROM false THEN
    RETURN v_result || jsonb_build_object('ignored', 'stale_visibility');
  END IF;
  IF v_stale AND (v_public = false OR v_old.profile_public = false OR v_at < v_old.visibility_updated_at) THEN
    RETURN v_result || jsonb_build_object('ignored', 'stale_visibility');
  END IF;
  -- ON에는 의도 시각이 필요하다. 시각 없는 요청은 현재 공개 행의 내용만 수정할 수 있다.
  IF p_mode = 'visibility' AND v_public = true AND v_at IS NULL THEN
    RETURN v_result || jsonb_build_object('ignored', 'no_visibility_stamp');
  END IF;
  IF p_mode = 'visibility' AND v_public = true AND NOT v_exists THEN
    -- 기존 API 계약: 내용 없는 ON만으로 공개행을 생성하지 않는다. 이후 전체 업로드가 생성한다.
    RETURN v_result || jsonb_build_object('ignored', 'no_profile');
  END IF;

  v_data := CASE WHEN v_exists THEN to_jsonb(v_old)
    ELSE v_tombstone || jsonb_build_object('score', 0, 'mileage', 0, 'level', 1, 'profile_public', true)
  END;
  IF v_public = false THEN
    v_data := v_data || v_tombstone || jsonb_build_object('profile_public', false, 'visibility_updated_at', v_at);
  ELSE
    IF p_mode = 'full' THEN v_data := v_data || p_profile; END IF;
    -- ID/공개 상태/시각은 프로필 본문의 임의 필드로 바꾸지 못한다.
    v_data := v_data || jsonb_build_object(
      'profile_public', CASE WHEN v_public = true AND v_at IS NOT NULL THEN true ELSE COALESCE(v_old.profile_public, true) END,
      'visibility_updated_at', CASE WHEN v_public = true AND v_at IS NOT NULL THEN v_at ELSE v_old.visibility_updated_at END
    );
  END IF;
  v_data := v_data || jsonb_build_object('user_id', v_key.user_id, 'updated_at', clock_timestamp());
  v_new := jsonb_populate_record(NULL::public.artist_profiles, v_data);
  -- 서버 사전 계산 뒤 다른 요청이 올린 정본 값도 잠금 안에서 다시 비교한다.
  v_new.score := greatest(COALESCE(v_old.score, 0), COALESCE(v_new.score, 0));
  v_new.mileage := greatest(COALESCE(v_old.mileage, 0), COALESCE(v_new.mileage, 0));
  IF p_mode = 'full' AND v_public IS DISTINCT FROM false AND p_profile ? 'mileage' THEN
    v_new.level := greatest(1, floor((sqrt(1 + 4 * v_new.mileage::numeric / 25) - 1) / 2)::integer);
  ELSE
    v_new.level := COALESCE(v_old.level, 1);
  END IF;

  IF v_exists THEN
    UPDATE public.artist_profiles SET
      name=v_new.name, email=v_new.email, user_type=v_new.user_type, fields=v_new.fields,
      gender=v_new.gender, birth_date=v_new.birth_date, height=v_new.height, weight=v_new.weight,
      height_private=v_new.height_private, weight_private=v_new.weight_private,
      specialties=v_new.specialties, school=v_new.school, location=v_new.location, agency=v_new.agency,
      career=v_new.career, bio=v_new.bio, role_models=v_new.role_models, interests=v_new.interests,
      photo_url=v_new.photo_url, photos=v_new.photos, notes_count=v_new.notes_count, streak_days=v_new.streak_days,
      score=v_new.score, mileage=v_new.mileage, level=v_new.level,
      profile_public=v_new.profile_public, visibility_updated_at=v_new.visibility_updated_at, updated_at=v_new.updated_at
    WHERE user_id = v_key.user_id;
  ELSE
    -- id/created_at 등 기존 테이블 기본값은 명시 삽입하지 않아 보존한다.
    INSERT INTO public.artist_profiles (
      user_id, name, email, user_type, fields, gender, birth_date, height, weight, height_private, weight_private,
      specialties, school, location, agency, career, bio, role_models, interests, photo_url, photos,
      notes_count, streak_days, score, mileage, level, profile_public, visibility_updated_at, updated_at
    ) VALUES (
      v_new.user_id, v_new.name, v_new.email, v_new.user_type, v_new.fields, v_new.gender, v_new.birth_date,
      v_new.height, v_new.weight, v_new.height_private, v_new.weight_private, v_new.specialties, v_new.school,
      v_new.location, v_new.agency, v_new.career, v_new.bio, v_new.role_models, v_new.interests,
      v_new.photo_url, v_new.photos, v_new.notes_count, v_new.streak_days, v_new.score, v_new.mileage, v_new.level,
      v_new.profile_public, v_new.visibility_updated_at, v_new.updated_at
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'profilePublic', v_new.profile_public,
    'visibilityUpdatedAt', v_new.visibility_updated_at, 'score', v_new.score, 'mileage', v_new.mileage, 'level', v_new.level);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_artist_profile_atomic(text, text, jsonb, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_artist_profile_atomic(text, text, jsonb, boolean, timestamptz) TO service_role;
COMMENT ON FUNCTION public.sync_artist_profile_atomic(text, text, jsonb, boolean, timestamptz)
  IS 'ArtLink server-only atomic profile visibility/content sync. HMAC ownership verified by API before calling.';
NOTIFY pgrst, 'reload schema';
COMMIT;
