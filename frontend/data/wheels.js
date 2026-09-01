// 바퀴 끼우기에 쓰는 판과, 거기서 오려낸 조각.
//
// 손으로 적지 않는다 — backend/server/tools/wheel-cutout.py 가 영상에서 화면을 꺼내
// 타이어 픽셀만 골라 조각 PNG 를 굽고, 판에는 그 자리를 파낸 뒤 이 항목을 찍어 준다.
//
//   python3 backend/server/tools/wheel-cutout.py <영상> 380 tayo-wheels \\
//     "crop=700:394:1130:540,unsharp=5:5:1.2" 363,382,32,32 555,368,30,30
//
// 좌표는 940×529 자다. WheelFit 이 그 크기로 그린 뒤 화면에 맞춰 통째로 줄인다.
import { POT_SHAPES } from './pot-shapes';
import { TOON_SHAPES } from './toon-shapes';
import { DUO_FRAME_AT, DUO_SHAPES } from './duo-shapes';

export const WHEEL_FRAMES = {
  // Episode 5: two full characters, with no frame crop or cast shadows in the pieces.
  'teenieping-duo': {
    at: DUO_FRAME_AT,
    reserveDock: true,
    image: require('../assets/puzzles/teenieping-duo-original.png'),
    holes: DUO_SHAPES,
  },
  // 타요스페셜3화 6분 20초. 버스가 옆으로 지나가 바퀴 두 짝이 통째로 드러난다 — 펜더에
  // 반쯤 가린 컷에서는 아치 안쪽 그늘이 타이어와 한 덩어리라 누끼가 무너진다.
  'tayo-bus': {
    at: 380,
    image: require('../assets/puzzles/tayo-wheels.jpg'),
    holes: [
      { id: 'front', image: require('../assets/puzzles/tayo-wheels-0.png'), x: 331, y: 354, w: 65, h: 61 },
      { id: 'rear', image: require('../assets/puzzles/tayo-wheels-1.png'), x: 526, y: 343, w: 60, h: 56 },
    ],
  },
  // 캐치 티니핑 9화 4분 45.77초 — 파이프라인이 고른 개입지점(사건: 엄마가 시든 꽃을 걱정한다).
  // 원본 프레임을 유지하고 POT_SHAPES의 같은 윤곽으로 조각과 빈자리를 그린다.
  // 색상 임계값으로 만든 작은 PNG는 사용하지 않는다.
  'teenieping-pots': {
    at: 285.77,
    image: require('../assets/puzzles/teenieping-pots-original.png'),
    holes: POT_SHAPES,
  },

  // 캐치 티니핑 10화 5분 18초. 원본 위에 동일한 곡선으로 빈자리와 조각을 표시한다.
  'teenieping-faces': {
    at: 318,
    image: require('../assets/puzzles/teenieping-toon-original.png'),
    holes: TOON_SHAPES,
  },
};
