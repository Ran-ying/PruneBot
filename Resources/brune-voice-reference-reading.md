# 布伦妮声音复刻参考片段

- 文件：`brune-voice-reference-reading.mp3`
- 时长：18.84 秒
- 格式：MP3、24 kHz、单声道、128 kbps
- 场景：关于布伦妮自己·读书
- 来源页面：https://wiki.biligame.com/ys/%E5%B8%83%E4%BC%A6%E5%A6%AE%E8%AF%AD%E9%9F%B3
- 原始音频：https://patchwiki.biligame.com/images/ys/f/f2/17wg6cve61fql7i0u534uuw0kqieoza.mp3

选择理由：单人中文语音、背景干净、音量稳定，以平静认真语气为主，包含自然的短暂停顿和少量情绪变化；相比宣战、战斗、怕雷或害羞语音，更适合提取日常聊天的主要音色。

截取范围为原始音频前 18.84 秒。大致对应：

> 大人们都挺没耐心的。问他们问题，得到的永远是“小孩子不需要知道那么多”或者“等你长大就明白了”……嘁，无所谓。我自己也能找答案。

用于 Qwen-Audio-TTS/CosyVoice 复刻时，建议设置：

- `language_hints`: `["zh"]`
- `max_prompt_audio_length`: `18.8`
- `enable_preprocess`: `false`

Qwen-Audio-TTS/CosyVoice 的声音注册接口要求参考音频 URL 可公网直接访问，因此实际注册可使用上面的原始音频 URL，并通过 `max_prompt_audio_length` 只取前 18.8 秒；本地裁剪文件用于试听、归档和其他支持直接上传文件的服务。

## Qwen-Audio-TTS Flash 实测

- 模型：`qwen-audio-3.0-tts-flash`
- 已注册音色：`qwen-audio-3.0-tts-flash-brune-aa7a2a8f73b74a469eab4abde7b6c2ee`
- 测试输出：`brune-voice-qwen-audio-flash-test.mp3`
- 测试台词：`你知道吗？把问题拆开以后，答案通常就没那么吓人了。嗯，至少大多数时候是这样。`
- 表达指令：`年轻、清亮的女孩声线，平静自然，语速稍快，认真中带一点得意；不要夸张，不要播音腔。`
- 输出时长：10.464 秒
- API 返回计费用量：71 字符
- 按 1 元/万字符估算本次成本：0.0071 元，约 0.00068 元/秒
- ASR 回验：完整还原测试台词，无吞字或明显发音错误

## 情感表现对比

为避免把“模型能力”和“表达指令过于平静”混在一起，使用同一句包含三段情绪变化的台词，对三种方案进行了对比：

> 你、你怎么突然这么说？我当然高兴，只是有点没反应过来而已。嗯……总之，谢谢你。

Qwen-Audio 的文本在合成时额外加入了官方支持的分段控制标签：

```text
[amazed]你、你怎么突然这么说？[reluctantly]我当然高兴，只是有点没反应过来而已。[empathetic]嗯……总之，谢谢你。
```

表达指令：

> 像熟悉的朋友面对面说话。开头被突然夸奖后有一点意外和害羞，第二句嘴硬但藏不住高兴，结尾坦率温柔并稍微放慢。句子轻重分明，不要播音腔，不要字字等重。

CosyVoice 不使用上述方括号标签，改用较短的自然语言指令：

> 面对朋友说话；先意外害羞，再嘴硬但高兴，结尾温柔放慢。不要播音腔。

### 生成结果

| 方案 | 已注册音色 | 输出文件 | 时长 | API 计费字符 | 估算费用 |
| --- | --- | --- | ---: | ---: | ---: |
| Qwen-Audio 3.0 TTS Flash | `qwen-audio-3.0-tts-flash-brune-aa7a2a8f73b74a469eab4abde7b6c2ee` | `brune-voice-qwen-audio-flash-emotional.mp3` | 11.568 秒 | 103 | ¥0.0103 |
| Qwen-Audio 3.0 TTS Plus | `qwen-audio-3.0-tts-plus-bruneplus-71c464520be94bfa912d4643f1e1a5c7` | `brune-voice-qwen-audio-plus-emotional.mp3` | 12.144 秒 | 103 | ¥0.01442 |
| CosyVoice 3.5 Plus | `cosyvoice-v3.5-plus-brunecosy-0f69bdb76cfb48a8bc1a3553ec97c7f7` | `brune-voice-cosyvoice-v35-plus-emotional.mp3` | 10.440 秒 | 70 | ¥0.0105 |

费用分别按 Qwen-Audio Flash ¥1/万字符、Qwen-Audio Plus ¥1.4/万字符、CosyVoice 3.5 Plus ¥1.5/万字符估算。Qwen-Audio 的情绪标签会进入 API 返回的计费字符数，因此表中优先采用 API 实际返回用量。

可复现脚本：`scripts/compare-tts-emotion.js`。

试听时建议先只比较情绪是否自然，再比较音色相似度和发音清晰度；三者通常不是同一模型同时最优。若 Qwen-Audio Plus 仍显得像朗读，下一步应优先更换包含明显情绪变化的参考音频，而不是继续堆叠更夸张的提示词。
