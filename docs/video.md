# Explainer video details

[简体中文](video.zh-CN.md)

Everything `am video` does. The README lists only the most common points.

What `am video` does:

- **Built step by step.** When the Nth line of narration plays, the Nth step of the diagram appears. Arrows draw themselves. If there are more lines than steps, the extra lines at the start act as an intro.
- **Spoken narration.** The agent writes narration the way a person explains things out loud, not like a manual.
- **Camera focus.** `[Server]` in the narration pushes the camera toward that node and highlights it. The diagram never leaves the frame.
- **Objects carry over.** A node with the same name in the next scene glides to its new place instead of cutting.
- **Narration.** It uses ElevenLabs if `ELEVENLABS_API_KEY` is set (optional; [setup guide](elevenlabs.md)), the system voice otherwise (macOS `say`: Tingting for Chinese, Samantha for English, Kyoko for Japanese), and captions only if neither exists. Each beat lasts as long as its audio, so picture and voice stay in sync.
- **Local voice.** `--voice local` uses an OpenAI-compatible `POST /v1/audio/speech` server you run yourself that returns 16-bit PCM WAV, such as [mlx-audio](https://github.com/Blaizzy/mlx-audio) with Qwen3-TTS. Set `AM_TTS_URL` to the server root; set `AM_TTS_MODEL` and `AM_TTS_VOICE` unless the server has defaults, and `AM_TTS_API_KEY` if it requires a key. `AM_TTS_EXTRA` is a JSON object of model-specific options merged into each request; `AM_TTS_MODEL` and `AM_TTS_VOICE` override the same fields in it, and `am` always sets `input`, `response_format` and `stream`. A clip much shorter or longer than its text suggests is generated again, up to `AM_TTS_ATTEMPTS` tries (default 3; 1 turns the check off). `am patch` keeps the voice a video was made with. Example: `AM_TTS_URL=http://127.0.0.1:8000 AM_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit AM_TTS_VOICE=vivian am video draft.md --voice local`.
- **Same look as the pages.** Videos use the blueprint drawing style by default: a ruled frame and lettered sheet heads. Write `theme: 3b1b` for the dark 3Blue1Brown look. `theme: shadcn` and `mode: dark` also work.
- **Chapters and speed.** A chapter strip sits above the player controls: one chip per scene, the current chapter highlighted, and a click jumps into that scene and keeps playing. The ticks on the progress bar jump too. The speed button cycles 0.5× to 2×; the narration stretches with the picture.
- **One file.** The page has the audio inside and plays offline. The player's export button (⤓) encodes the same video in the browser and downloads it — no terminal, no ffmpeg — and shows its progress, and a click on the cover stops it. It needs a secure context (a local file or `localhost`): WebCodecs is not available to a page served over plain HTTP. Add `--mp4` for a 1080p file next to the page: an MP4 (H.264 + AAC) when ffmpeg is installed, otherwise the same WebM (VP9 + Opus) the page encodes itself, so Chrome and Node.js 22+ are enough. The MP4 takes about 1.3 times the video length. The browser-encoded WebM depends on how much of the page moves: measured here, 28 s for an 11-second draft and 13.5 minutes for the 2:27 explainer with five scenes (1080p30 on a laptop CPU).

The draft for the example video ([examples/video-tcp.en.md](../examples/video-tcp.en.md), about 45 seconds) is 1.3 KB, a few hundred output tokens. Rendering takes under a second without voice and about 4 seconds with the system voice. The agent only makes videos when you ask; always-on mode still makes pages. Full syntax: `am help video`.
