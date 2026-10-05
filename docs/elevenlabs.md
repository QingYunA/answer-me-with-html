# Narration with ElevenLabs

[简体中文](elevenlabs.zh-CN.md)

`am video` can read the narration with [ElevenLabs](https://elevenlabs.io). Without a key it uses the system voice, so this setup is optional.

## Set up

1. In the ElevenLabs dashboard, create an API key. A key limited to **Text to Speech** is enough; `am` calls nothing else.
2. Export the key, then render.

   ```bash
   export ELEVENLABS_API_KEY="sk_..."     # add this line to ~/.zshrc to keep it
   am video draft.md                      # uses ElevenLabs when the key is set
   am video draft.md --voice elevenlabs   # stops with an error if the key is missing
   ```

An agent only sees the key if it was set before you started the agent. To always use ElevenLabs instead of letting `am` pick, run `am config set voice elevenlabs`.

## Choose a voice and a model (optional)

Voices and models suit different languages and tastes, so pick your own:

| Variable | What it sets | If you do not set it |
| :--- | :--- | :--- |
| `ELEVENLABS_VOICE_ID` | The voice. Copy the ID from your ElevenLabs voices page | `bIHbv24MWmeRgasZH58o` (Will, a premade voice) |
| `ELEVENLABS_MODEL_ID` | The model, such as `eleven_v4_turbo`, `eleven_flash_v2_5` or `eleven_multilingual_v2` | `eleven_v4_turbo` |

The defaults work on the free plan with English and Chinese text. Will is an English voice; ElevenLabs lists Chinese as a verified language for it only under `eleven_multilingual_v2`. For Chinese that sounds native, choose a Chinese voice yourself. See the [model list](https://elevenlabs.io/docs/overview/models) for what each model supports.

A voice from the public voice library needs a paid plan. On the free plan the API answers `402 paid_plan_required`.

## Cost and cache

ElevenLabs bills per character. Each narration line is generated once and cached in `~/.answer-me-with-html/cache/tts/` by voice, model and text. You pay again only for the lines you change, or when you change the voice or the model.

## Errors

The CLI prints its messages in Chinese. These are the ones you may meet:

| Message | Cause |
| :--- | :--- |
| `ElevenLabs 返回 401` or `missing_permissions` | The key is wrong, or it lacks the Text to Speech permission |
| `ElevenLabs 返回 402` with `paid_plan_required` | The voice is a library voice and your plan is free; use a premade voice or upgrade |
| `无法连接 ElevenLabs` | No response in 60 seconds, or no network; add `--voice off` for captions only |
