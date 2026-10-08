# Explainer videos (am video, 3Blue1Brown style)

Read this when SKILL.md section 7 sends you here. `am` means the full `node ".../scripts/am.mjs"` command from SKILL.md section 2; write the path out in full, because `${CLAUDE_SKILL_DIR}` is not replaced in this file.

A video draft has the same format as a page draft, with one extra rule: lines starting with `>` are narration, one beat per line.

````bash
am video - --no-open <<'AM_EOF'
---
title: The TCP three-way handshake
subtitle: Why three
---
> Opening narration (optional).

## Both ends are waiting
```sequence
Client -> Server: SYN
Server -> Client: SYN-ACK
Client -> Server: ACK
```
> First the client sends SYN to ask for a connection.
> [Server] answers with SYN-ACK.
> The client replies with ACK, and the connection is open.
AM_EOF
````

- One `## ` is one scene. Put one component (or one table, one list) in a scene as the picture, and write 2–5 narration lines below it.
- When the Nth narration line plays, the picture shows step N. In flow / sequence / tree every source line is one step; timeline, limits, table rows and list items step by entry. So the line order of the component is the order of the explanation. When there are more narration lines than steps, the extra first lines serve as an opening and show nothing new.
- Write `[name]` in narration: the camera zooms in on the node or actor with that name and highlights it. The name must match how it is written in the component.
- Nodes with the same name in adjacent scenes move smoothly to their new position. To keep the viewer following one object, reuse the same name in the next scene.
- 3–6 scenes per video, one or two sentences per narration line.
- Narration is read aloud, so write it as speech, as if explaining to someone face to face: transitions like `你看`, `那问题来了`, `我们换个角度看` are fine, and characters' "lines" go in quotes. Do not write it like a manual (`客户端发送 SYN 报文以请求建立连接`). Sentence length is still subject to the STE check.
- The look follows the theme in the settings by default (usually the blueprint drawing style). When the user wants "that dark 3b1b style", write `theme: 3b1b` in the frontmatter.
- Narration voice: the default is `--voice auto`: ElevenLabs when `ELEVENLABS_API_KEY` is set, otherwise system TTS (macOS say), and subtitles only when neither is available. When the user says "no sound", add `--voice off`. When the user runs a local OpenAI-compatible speech service and has set `AM_TTS_URL`, use `--voice local`.
- The output is a single-file player page under `~/.answer-me-with-html/videos/` (audio embedded). The player carries a chapter strip above the controls (a chip jumps into that scene) and a speed button (0.5× to 2×). When the user wants a video file, add `--mp4`: an MP4 through ffmpeg when it is installed, otherwise a WebM (VP9 + Opus) that the page encodes itself — Chrome and Node.js 22+ are then enough. Export takes about 1.3 times the video length.
- Full syntax: `am help video`. In the terminal, reply with one sentence plus the player page link (and the MP4 link), written as in step 5 of section 2 of SKILL.md.
