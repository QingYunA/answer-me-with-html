# 用 ElevenLabs 配音

[English](elevenlabs.md)

`am video` 可以用 [ElevenLabs](https://elevenlabs.io) 朗读旁白。没有 key 时用系统语音，所以这一步是可选的。

## 配置

1. 在 ElevenLabs 后台创建 API key。只勾选 **Text to Speech**（语音合成）权限就够了，`am` 不调用别的接口。
2. 设置环境变量，再渲染。

   ```bash
   export ELEVENLABS_API_KEY="sk_..."     # 想长期生效，就把这行写进 ~/.zshrc
   am video draft.md                      # 有 key 就自动用 ElevenLabs
   am video draft.md --voice elevenlabs   # 没有 key 时直接报错
   ```

Agent 只能读到启动它之前已经设好的变量。想把 ElevenLabs 固定为默认配音，运行 `am config set voice elevenlabs`。

## 选声音和模型（可选）

声音和模型适合的语言、风格因人而异，请按自己的需求选：

| 变量 | 作用 | 不设时 |
| :--- | :--- | :--- |
| `ELEVENLABS_VOICE_ID` | 声音。在 ElevenLabs 的声音页复制 ID | `bIHbv24MWmeRgasZH58o`（Will，官方声音） |
| `ELEVENLABS_MODEL_ID` | 模型，如 `eleven_v4_turbo`、`eleven_flash_v2_5`、`eleven_multilingual_v2` | `eleven_v4_turbo` |

默认值在免费套餐下可用，中英文稿件都能念。Will 母语是英语，ElevenLabs 只在 `eleven_multilingual_v2` 下把中文列为它的已验证语言。想要听起来是母语的中文，请自己选中文声音。各模型支持的语言见[模型列表](https://elevenlabs.io/docs/overview/models)。

公共声音库里的声音需要付费套餐，免费套餐调用时 API 会返回 `402 paid_plan_required`。

## 费用与缓存

ElevenLabs 按字符计费。每句旁白只合成一次，按声音、模型和文本缓存在 `~/.answer-me-with-html/cache/tts/`。只有改过的句子，或换了声音、模型，才会重新计费。

## 报错

命令行的提示是英文的：

| 报错 | 原因 |
| :--- | :--- |
| `ElevenLabs returned 401` 或 `missing_permissions` | key 不对，或没有语音合成权限 |
| `ElevenLabs returned 402`，含 `paid_plan_required` | 用了声音库里的声音，而你是免费套餐；换官方声音或升级套餐 |
| `Cannot connect to ElevenLabs` | 60 秒内没有响应，或没有网络；加 `--voice off` 只出字幕 |
