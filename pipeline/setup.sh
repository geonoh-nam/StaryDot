#!/usr/bin/env bash
# 스토리닷 파이프라인 — 개발 환경 준비
#
# 외부 파이썬 패키지가 없다. 표준 라이브러리 + 두 개의 네이티브 바이너리만 쓴다.
#   ffmpeg       영상/오디오 처리
#   whisper-cli  로컬 STT (whisper.cpp). API 키가 필요 없고 종량 과금도 없다.
#
# 모델은 약 2GB 다. 최초 1회만 받는다.
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1; }

echo "── 바이너리 확인 ──"
MISSING=()
need ffmpeg      || MISSING+=(ffmpeg)
need ffprobe     || MISSING+=(ffmpeg)
need whisper-cli || MISSING+=(whisper-cpp)

if [ ${#MISSING[@]} -gt 0 ]; then
  if need brew; then
    echo "설치: ${MISSING[*]}"
    brew install "${MISSING[@]}"
  else
    echo "다음을 설치해야 한다: ${MISSING[*]}" >&2
    echo "  macOS : brew install ffmpeg whisper-cpp" >&2
    echo "  Linux : apt install ffmpeg  +  whisper.cpp 를 소스로 빌드" >&2
    exit 1
  fi
else
  echo "  ffmpeg · ffprobe · whisper-cli 모두 확인됨"
fi

echo
echo "── 모델 내려받기 ──"
mkdir -p models
HF=https://huggingface.co/ggerganov/whisper.cpp/resolve/main
VAD=https://huggingface.co/ggml-org/whisper-vad/resolve/main

fetch() {  # fetch <url> <파일명> <설명>
  if [ -s "models/$2" ]; then
    echo "  이미 있음  $2"
  else
    echo "  받는 중    $2  ($3)"
    curl -fL --progress-bar -o "models/$2" "$1/$2"
  fi
}

# 기준 타임라인. 실측에서 large-v3-turbo 보다 환각이 2.6배 적었다.
fetch "$HF"  ggml-small.bin            "465MB · 기준 패스"
# 정밀도 앵커. 환각 0% 지만 재현율이 낮아 단독으로는 못 쓴다.
fetch "$HF"  ggml-large-v3-turbo.bin   "1.5GB · 교차검증 앵커"
# VAD. 앵커 패스의 환각을 0으로 만드는 핵심 부품.
fetch "$VAD" ggml-silero-v5.1.2.bin    "864KB · 음성 구간 검출"

echo
echo "── 자체검사 ──"
python3 - <<'PY'
import subprocess, sys, pathlib
ok = True
for m in ("ggml-small.bin", "ggml-large-v3-turbo.bin", "ggml-silero-v5.1.2.bin"):
    p = pathlib.Path("models") / m
    size = p.stat().st_size if p.exists() else 0
    print(f"  {'✓' if size > 100_000 else '✗'} {m}  {size/1e6:.0f}MB")
    ok &= size > 100_000
v = subprocess.run(["python3", "-c", "import sys; print(sys.version_info[:2])"],
                   capture_output=True, text=True).stdout.strip()
print(f"  python {v}")
sys.exit(0 if ok else 1)
PY

echo
echo "준비 완료. 실행:"
echo "  python3 storydot.py ~/Downloads/뽀로로1화.mp4"
echo "  python3 storydot.py --fast <영상>      # 앵커 패스 생략 (빠름, 정확도 낮음)"
