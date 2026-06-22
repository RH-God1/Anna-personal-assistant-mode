# Anna i18n QA Harness

对静态 App bundle 执行可重复的国际化检查：

- locale catalog 键集合一致性；
- `{placeholder}` 一致性；
- HTML `data-i18n` 引用有效性；
- `html, body { overflow: hidden }` 且没有短窗口滚动 fallback 的风险；
- 生成扩张约 30% 且保留占位符的 pseudo-locale。

## 使用

```bash
npm run check
npm test
node src/cli.js --bundle path/to/app/bundle --base en --write-pseudo
```

命令在存在 error 时返回非零退出码，适合接入 CI。
