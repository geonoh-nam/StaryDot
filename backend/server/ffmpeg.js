// ffmpeg/ffprobe 를 부르는 자리. 영상을 등록하는 도구가 둘 이상이라 여기 모은다.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * 영상 길이(초). 편성 예산이 여기서 나오므로 추측하지 않는다 —
 * 길이를 모르면 부모가 정한 총량이 그냥 틀린 숫자가 된다.
 */
export function probeDuration(file, fallback) {
  if (fallback != null) {
    const n = Number(fallback);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`duration 은 양수여야 합니다: ${fallback}`);
    return Math.round(n);
  }
  let out;
  try {
    out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                   '-of', 'default=noprint_wrappers=1:nokey=1', file]).toString().trim();
  } catch {
    throw new Error('ffprobe 실패 — ffmpeg 를 설치하거나 --duration <초> 를 주세요');
  }
  const dur = Number(out);
  if (!Number.isFinite(dur) || dur <= 0) throw new Error(`길이를 읽지 못했습니다: ${out}`);
  return Math.round(dur);
}

/** 썸네일 한 장. 없어도 앱은 돈다 — 실패는 false 로 돌려주고 부르는 쪽이 정한다. */
export function grabThumb(videoFile, atSec, outPath) {
  try {
    execFileSync('ffmpeg', ['-y', '-ss', String(atSec), '-i', videoFile, '-frames:v', '1',
                            '-vf', 'scale=480:-1', outPath], { stdio: 'ignore' });
    if (fs.statSync(outPath).size > 0) return true;
    fs.unlinkSync(outPath);
    return false;
  } catch {
    return false;
  }
}
