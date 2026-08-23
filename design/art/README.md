# 원본 아트

앱이 읽는 파일이 아니다. 앱은 `frontend/assets/`만 참조하고, 여기 있는 것은
그 파일들의 원본이다.

새 그림을 넣을 때:

1. 원본을 이 폴더에 그대로 둔다 (이름도 그대로)
2. `frontend/assets/` 아래 알맞은 곳으로 복사하면서 **쓰임이 드러나는 이름**을 붙인다
   — `우주.png` → `assets/scenes/space.png`, `dino2.png` → `assets/characters/stage2-dino.png`
3. `App.js`에서 `require`로 연결한다

42개 중 32개는 이미 `frontend/assets/`에 그대로 들어가 있다. 나머지 10개
(`43.png`, `1.png`, `star.png`, `rabbit2.png`, `thumb1~6.png`)는 아직 쓰이지
않는 후보들이다.
