import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// One-shot UI sound effects. Swap the files in assets/sounds/ to change them — keys stay the same.
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});

const players = {
  success: createAudioPlayer(require('./assets/sounds/success.mp3')),
  wrong: createAudioPlayer(require('./assets/sounds/wrong.mp3')),
  fanfare: createAudioPlayer(require('./assets/sounds/fanfare.mp3')),
  pop: createAudioPlayer(require('./assets/sounds/pop.mp3')),
  // The tune that greets the main screen, and the noise the star makes when poked.
  main: createAudioPlayer(require('./assets/sounds/main.mp3')),
  star: createAudioPlayer(require('./assets/sounds/fanfare.mp3')),
};

// Spoken lines. Fixed prompts ship as files; question audio arrives as a URL from the content DB,
// so nothing is synthesised on the tablet.
const voices = {
  quiz: createAudioPlayer(require('./assets/voice/quiz.m4a')),
  trace: createAudioPlayer(require('./assets/voice/trace.m4a')),
  puzzle: createAudioPlayer(require('./assets/voice/puzzle.m4a')),
  color: createAudioPlayer(require('./assets/voice/color.m4a')),
  correct: createAudioPlayer(require('./assets/voice/correct.m4a')),
  retry: createAudioPlayer(require('./assets/voice/retry.m4a')),
  'draw-topic': createAudioPlayer(require('./assets/voice/draw-topic.m4a')),
  traceword: createAudioPlayer(require('./assets/voice/traceword.m4a')),
};

let urlPlayer = null;
// One slot per speaker, so two characters talking at once are heard at once. A second line from
// the same character still cuts its own first one — nobody talks over themselves.
const linePlayers = {};

export function speak(name) {
  const p = voices[name];
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch (e) {
    // ignore playback races
  }
}

// One line of question audio, streamed straight from wherever the DB says it lives.
export function speakUrl(uri) {
  if (!uri) return;
  try {
    if (urlPlayer) urlPlayer.remove();
    urlPlayer = createAudioPlayer({ uri });
    urlPlayer.play();
  } catch (e) {
    // ignore playback races
  }
}

// A voice line that arrives as a bundled module rather than a fixed name. Players are made on
// demand and thrown away. `speaker` is who is talking: lines from different speakers overlap,
// lines from the same one replace each other. Separate from urlPlayer, so a reaction line never
// cuts off question audio mid-word.
export function playVoice(mod, speaker = 'line') {
  if (!mod) return;
  try {
    if (linePlayers[speaker]) linePlayers[speaker].remove();
    linePlayers[speaker] = createAudioPlayer(mod);
    linePlayers[speaker].play();
  } catch (e) {
    // ignore playback races
  }
}

export function stopSpeaking() {
  try {
    if (urlPlayer) urlPlayer.pause();
    Object.values(linePlayers).forEach((p) => p.pause());
    Object.values(voices).forEach((p) => p.pause());
  } catch (e) {
    // ignore
  }
}

export function playSound(name) {
  const p = players[name];
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch (e) {
    // ignore playback races
  }
}
