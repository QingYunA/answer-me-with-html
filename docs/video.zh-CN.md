# 解释视频的细节

[English](video.md)

`am video` 的完整行为。首页只列了最常用的几条。

`am video` 做了这些事：

- **逐步构建**：第 N 句旁白播出时，图上出现第 N 步，箭头会一笔画出来。旁白比步数多时，多出的前几句当开场白。
- **口语旁白**：旁白是要念出来的，Agent 会写成当面讲解的口吻，而不是说明书腔。
- **镜头聚焦**：旁白里写 `[Server]`，镜头推向这个节点并高亮。整张图始终留在画面里，不会被裁掉。
- **跨场景变形**：下一个场景里同名的节点，会从旧位置平滑移到新位置，而不是硬切。
- **配音**：设置了 `ELEVENLABS_API_KEY` 就用 ElevenLabs（可选，[配置指南](elevenlabs.zh-CN.md)），否则用系统语音，都没有就只出字幕。系统语音按每句旁白的语言在本机已装的语音里挑：macOS `say` 用这门语言已装的语音，繁体中文优先用台湾语音（`zh_TW`）；Linux 用 espeak-ng 对应的语音。某句的语言本机没有装语音时，这句只保留字幕不配音，运行时会说明是哪种语言——绝不会用别的语言的语音去念。每一拍的时长等于这句音频的长度，所以音画同步。
- **本地配音**：`--voice local` 调用你自己部署的 OpenAI 兼容 `POST /v1/audio/speech` 服务，要求返回 16 位 PCM WAV，比如用 [mlx-audio](https://github.com/Blaizzy/mlx-audio) 运行 Qwen3-TTS。`AM_TTS_URL` 填服务根地址；服务没有默认值时还要设 `AM_TTS_MODEL` 和 `AM_TTS_VOICE`，服务要求密钥时设 `AM_TTS_API_KEY`。`AM_TTS_EXTRA` 是模型专用参数（JSON 对象），并入每个请求；`AM_TTS_MODEL`、`AM_TTS_VOICE` 覆盖其中的同名字段，`input`、`response_format`、`stream` 总由 `am` 决定。某句音频比文字应有的时长短得多或长得多时，重新生成，每句最多 `AM_TTS_ATTEMPTS` 次（默认 3，设为 1 关闭检查）。`am patch` 沿用视频原来的配音方式。例：`AM_TTS_URL=http://127.0.0.1:8000 AM_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit AM_TTS_VOICE=vivian am video draft.md --voice local`。
- **和页面同一套外观**：默认是 blueprint 图纸风，带刻度外框和字母编号的图纸标题栏。稿件里写 `theme: 3b1b` 换成深色的 3Blue1Brown 风格；也支持 `theme: shadcn` 和 `mode: dark`。
- **章节与倍速**：控制条上方有一条章节栏，每个场景一个标签，当前章节高亮，点一下跳到那一幕并继续播放；进度条上的刻度也能点。倍速按钮在 0.5× 到 2× 之间循环，旁白和画面一起变快。
- **单个文件**：音频内嵌在页面里，离线也能播。播放器带一个导出按钮（⤓）：同一个视频由浏览器自己编码并下载，不用终端、不用 ffmpeg，按钮上显示进度，点遮罩可停止。它需要安全上下文（本地文件或 `localhost`）—— 走普通 HTTP 的页面拿不到 WebCodecs。加 `--mp4` 在页面旁边另存 1080p 的 MP4（H.264 + AAC），需要 ffmpeg，导出时间约为视频时长的 1.3 倍。加 `--webm` 另存同一个视频的 WebM（VP9 + Opus），由页面自己编码，不需要 ffmpeg，耗时取决于页面动的多少：本机实测 11 秒稿 28 秒、2:27 五幕片 13.5 分钟（笔记本电脑 CPU、1080p30）。两者都需要 Chrome 和 Node.js 22+，可以同时加。

示例视频（[examples/video-tcp.md](../examples/video-tcp.md)）时长约 80 秒，稿件只有 835 个字符，也就是几百个输出 token。不配音时渲染不到 1 秒，用系统语音配音约 3 秒。只有你要视频时 Agent 才会做视频；高频模式仍然只出页面。完整语法：`am help video`。
