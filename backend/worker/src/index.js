// Turns a child's drawing into a finished picture. It exists only to hold the fal key: the app
// must never carry it, or anyone who unpacks the APK can spend our credits.
// flux-pro 는 한 장에 2분 넘게 걸려 워커 응답 한도를 넘겼다. dev 판이 같은 편집 방식이면서
// 10~20초로 끝난다 — 아이가 기다릴 수 있는 시간이 그 정도다.
const MODEL = 'fal-ai/flux-kontext/dev';
// 사물은 kontext 로 "편집"한다 — 아이 선을 그 자리에 두고 다듬는 것이 목적이다.
// 캐릭터는 지시를 잘 듣는 쪽이 필요하다. flux 는 낱말 하나에 휘둘려 "요정"에 날개를 달고
// 부정문을 못 알아들었다. nano-banana(Gemini) 는 같은 속도에 지시를 훨씬 잘 따른다.
// 대신 strength 가 없어 "그림을 얼마나 반영할지"는 프롬프트로만 정한다.
const CHARACTER_MODEL = 'fal-ai/nano-banana/edit';
// 0 이면 원본 그대로, 1 이면 아예 새로 그린다. 0.88 이면 색과 대략의 자리만 남는다.
// 너무 높이면 아이가 머리 위에 그린 것까지 사라지고, 너무 낮추면 얼굴·몸을 동물로 읽는다.
// 0.92 에서는 머리카락이 통째로 사라졌다. 0.86 이 머리 모양이 따라오기 시작하는 선이다.
const CHARACTER_STRENGTH = 0.86;

// 사물을 그렸을 때. 자동차·눈사람은 형태가 단순해서 아이 선을 다듬기만 해도 알아볼 수 있다.
const PROMPT =
  "Repaint this child's crayon drawing as a warm, colourful children's picture-book illustration. Keep the exact same composition, subject and layout: every shape stays in the same place, at the same size, in the child's own colours. Do not add new objects, characters or animals, do not remove anything, do not turn it into a mascot. Only smooth the wobbly strokes, add soft shading, gentle gradients and a light background so it looks finished and pretty. No text or watermark.";

// 캐릭터를 그렸을 때. 여기서는 "무엇을 하는가"만 말한다 — 아이 그림에서 개성을 살린
// 새 캐릭터를 만들고, 복제하지 않고, 전신을 잘리지 않게 담는다. 무엇을 만드는지는 주제가,
// 어떻게 보이는지는 시리즈 화풍이 뒤에 붙여 말한다.
// 확산 모델에 "곰이 아니다 · 주둥이 없다"라고 적으면 그 낱말이 오히려 그림을 끌어당긴다.
// 실제로 곰과 쥐를 이름 대어 막을수록 곰과 쥐가 나왔다. 원하는 것만 적는다.
const CHARACTER_PROMPT =
  "A frame from a Korean 3D animated series for preschoolers, showing a tiny chibi mascot character. Soft matte surfaces lit by gentle diffuse light with soft bounce, colours clear but very light: the body and face are one continuous pale pastel — a soft tint close to white, like the palest shade on a paint chip — the face barely lighter still, and the hair a deeper saturated tone of that same colour so it stands clearly apart. Pastel pink by default, but if the sketch shows a clear motif, the whole palette follows it — a lightning bolt makes the creature yellow, a leaf green, a water drop blue, a flame orange. The character is almost entirely head: a big round dome taking up about three quarters of the whole figure, flowing straight down with no neck into a tiny rounded belly barely peeking out below — under two heads tall in total — with two little nubs at the sides for arms and two stubby rounded feet. The belly is paler still, almost white, and centred on it sits a small golden emblem shaped like a flame or crown, the mark every one of these creatures carries. Fixed face layout, always the same: the head is a smooth egg turned upside down — widest across the top third, narrowing to a short rounded chin — and completely flat, with no muzzle. The eye line sits at sixty percent of the head height, measured from the top, so the forehead above it is a wide bare dome and the chin below is shallow. The two eyes are colossal upright ovals, each a third of the head wide and half the head tall, set only half an eye-width apart, the iris filling nearly the whole eye so only a thin sliver of white shows at the corners. Inside each iris: a large dark pupil at the centre, a warm brown ring around it that lightens toward the bottom of the iris into a bright amber glow, a thin darker rim at the very edge, one big round white catchlight at the upper left and a smaller one at the lower right. Exactly four fine lashes at the outer edge of each eye. Between and just below them sits a tiny heart-shaped nose, and directly under that a tiny open smile no wider than one iris. Two deep round pink blush circles sit outside the eyes, level with the nose. Above the eyes a wide bare forehead, and the head crowned with big sculpted 3D hair in a deeper pink — large rounded bunches growing from the sides of the head and hanging beside the cheeks with a tuft between them, generous and clearly visible, following the shape drawn above the head in the sketch. A lively happy expression and a natural animated pose, mid-gesture with the weight on one foot, facing forward, the character large and filling most of the frame from top to bottom, on a dreamy pastel background with soft clouds and floating sparkles.";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const { pathname } = new URL(request.url);
    if (pathname === '/health') return json({ ok: true });
    if (pathname !== '/generate-character') return json({ error: 'not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: '잘못된 요청이에요.' }, 400);
    }

    const image = body?.imageBase64;
    if (!image) return json({ error: '그림이 비어 있어요.' }, 400);

    const topic = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : '';
    // Each show has its own look, so the app names one. It changes how the drawing is painted,
    // never what is in it.
    const style = typeof body.style === 'string' && body.style.trim() ? body.style.trim() : '';
    // 캐릭터인지 사물인지는 앱이 말해 준다. 같은 프롬프트로 둘 다 그리면 한쪽이 망가진다.
    const isCharacter = body.character === true;
    let prompt = isCharacter ? CHARACTER_PROMPT : PROMPT;
    if (topic) {
      prompt += isCharacter
        ? ''
        : ` The child was asked to draw "${topic}". Whatever the lines look like, read them as that subject and keep them exactly where they are — do not replace the drawing with a polished character of your own, and do not add anything the child did not draw.`;
    }
    if (style) {
      prompt += isCharacter
        ? ' Pastel body colour — pink, mint or lilac.'
        : ` Paint it in this style: ${style}. The style changes only the colours, shading and finish — never the shapes the child drew.`;
    }

    const dataUri = image.startsWith('data:') ? image : `data:image/png;base64,${image}`;

    const res = await fetch(`https://fal.run/${isCharacter ? CHARACTER_MODEL : MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        ...(isCharacter ? {} : { image_url: dataUri }),
        ...(isCharacter
          ? { image_urls: [dataUri], num_images: 1 }
          : { guidance_scale: 3.5 }),
      }),
    });

    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: '변환에 실패했어요.', detail: `${res.status} ${JSON.stringify(out).slice(0, 300)}` }, 502);
    }

    const url = out?.images?.[0]?.url || out?.image?.url;
    if (!url) return json({ error: '변환 결과가 비어 있어요.' }, 502);

    // Hand the app bytes, not a fal URL: those expire, and the app already knows how to draw base64.
    const img = await fetch(url);
    const buf = await img.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);

    return json({ ok: true, mimeType: img.headers.get('content-type') || 'image/png', imageBase64: btoa(binary) });
  },
};
