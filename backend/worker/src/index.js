// Turns a child's drawing into a finished picture. It exists only to hold the fal key: the app
// must never carry it, or anyone who unpacks the APK can spend our credits.
const MODEL = 'fal-ai/flux-pro/kontext';

const PROMPT =
  "Repaint this child's crayon drawing as a warm, colourful children's picture-book illustration. Keep the exact same composition, subject and layout: every shape stays in the same place, at the same size, in the child's own colours. Do not add new objects, characters or animals, do not remove anything, do not turn it into a mascot. Only smooth the wobbly strokes, add soft shading, gentle gradients and a light background so it looks finished and pretty. No text or watermark.";

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
    const prompt = topic
      ? `${PROMPT} The child was asked to draw "${topic}". Whatever the lines look like, read them as that subject and keep them exactly where they are — do not replace the drawing with a polished character of your own, and do not add anything the child did not draw.`
      : PROMPT;

    const dataUri = image.startsWith('data:') ? image : `data:image/png;base64,${image}`;

    const res = await fetch(`https://fal.run/${MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_url: dataUri }),
    });

    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: '변환에 실패했어요.', detail: String(res.status) }, 502);

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
