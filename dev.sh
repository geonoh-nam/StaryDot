#!/bin/sh
# 갤럭시탭(USB)으로 앱을 띄운다. Metro + 콘텐츠 서버 + adb 포트 포워딩.
#   sh dev.sh
set -e
cd "$(dirname "$0")"
export PATH=/opt/homebrew/bin:$PATH

pkill -f "backend/server/index.js" 2>/dev/null || true
pkill -f "expo start" 2>/dev/null || true

nohup node backend/server/index.js > /tmp/storydot-server.log 2>&1 &
(cd frontend && nohup npx expo start --dev-client --lan > /tmp/storydot-metro.log 2>&1 &)
sleep 15

# adb reverse 라 태블릿에서는 두 서버 모두 localhost 다. 방화벽도 Wi-Fi 도 안 탄다.
adb reverse tcp:8081 tcp:8081
adb reverse tcp:5056 tcp:5056

adb shell am force-stop com.flyai.patti
adb shell am start -n com.flyai.patti/.MainActivity > /dev/null
echo "앱 실행됨. dev-client 에서 http://localhost:8081 로 Connect."
echo "화면 확인: adb exec-out screencap -p > /tmp/tab.png"
