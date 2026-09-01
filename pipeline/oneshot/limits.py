"""API가 강제하는 한계. 추측하지 말고 실측한 값만 적는다."""

# 요청당 이미지 개수 상한.
# 2026-08-19 (미실측): 이 머신에는 ANTHROPIC_API_KEY와 `ant` CLI가 없어
# count_tokens 실측을 못 했다. 100은 실측이 아니라 문서화된 기본값이다.
# 실제 값은 Task 8의 실제 API 호출에서 확인/정정된다.
# 갱신하려면 /tmp/probe_image_limit.py 를 다시 돌린다 (구현 계획 Task 2).
MAX_IMAGES_PER_REQUEST = 100
