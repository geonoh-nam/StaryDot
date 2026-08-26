import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.srt': 'text/plain; charset=utf-8',
};

// Returns null for "no Range header", 'invalid' for a range outside the file, else {start, end}.
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return 'invalid';
  let start;
  let end;
  if (rawStart === '') {
    start = size - Number(rawEnd);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (start < 0) start = 0;
  if (end > size - 1) end = size - 1;
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

// Stream a file, honouring Range so expo-video can seek.
export function serveFile(req, res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = parseRange(req.headers.range, stat.size);

  if (range === 'invalid') {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
    return;
  }
  if (range === null) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error(`Stream error for ${filePath}:`, err.message);
      res.destroy();
    });
    stream.pipe(res);
    return;
  }
  res.writeHead(206, {
    'Content-Type': type,
    'Content-Length': range.end - range.start + 1,
    'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
  });
  const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
  stream.on('error', (err) => {
    console.error(`Stream error for ${filePath}:`, err.message);
    res.destroy();
  });
  stream.pipe(res);
}
