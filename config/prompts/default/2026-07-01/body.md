# 默认 Prompt Pack

本 pack 的 body 为空。`inject_into_prompt` 看到空 body 会直接返回原 hardcoded prompt,
不做任何增量拼接。

启用方式:`config.yaml` 中:

```yaml
prompt_packs:
  active:
    refine: "default:2026-07-01"
    # 其它 target 同样可填
```

pin 存在 ≠ 增量存在。空 body 注入等价于无注入。
