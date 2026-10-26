# 分发用元数据

两个文件、两个消费者，内容一致，只有格式不同：

| 文件 | 给谁 | 怎么用 |
| --- | --- | --- |
| `awesome-dsh-plugin/dsh-mobile-bridge.yml` | [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 目录（dsh 插件市场的默认来源） | 复制到该仓库 `data/plugins/<owner>__dsh-mobile-bridge.yml`，发 PR |
| `dshmarket/plugins.json` | 自建/私有 dshmarket 目录 | 放进一个 npm 包根目录当 `plugins.json`，或托管成静态 JSON 后在市场里配置来源 |

两份都有 `OWNER` / `REPO` 占位符，发布前替换成真实 GitHub 账号与仓库名；`tarball` 指向 `tools/pack-plugin.ps1` 产物的 GitHub Release 地址，包发布到 npm 后也可以只留 `npm` 字段。

## 发布清单

1. `tools/pack-plugin.ps1` 生成 `dist/dsh-mobile-bridge-0.1.0.tgz`，脚本会校验内容清单和图标体积。
2. 把 tgz 传到 GitHub Release（tag 与版本号一致），确认 `contrib` 里的 tarball URL 可用。
3. 需要 npm 安装时 `npm publish` 仓库里的 `host/`；包名 `dsh-mobile-bridge` 未被占用才可用。
4. 提 PR 到 awesome-dsh-plugin，给仓库加 `dsh-plugin` topic。
