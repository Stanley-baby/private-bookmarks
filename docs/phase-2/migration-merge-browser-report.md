# 阶段 2：非空资料库迁移演练

日期：2026-08-22  
构建：`npm run build:extension` 生成的 `.output/chrome-mv3`

## 不同 extension ID

在隔离 Chromium profile 中同时加载旧版参考 bundle 与当前 WXT 构建：

| 环境 | extension ID |
| --- | --- |
| 旧版参考 bundle | `nhbkgiojamfpipdnlicjfpncbgoaccke` |
| React/WXT 构建 | `pemniljabdcecinhfamhmlkookciepkp` |

两者通过迁移包交接，未读取对方的 IndexedDB 或 `chrome.storage.local`。

## 流程结果

- 旧版写入 1 条书签、2 个收藏夹、cursor、删除记录和持久浏览器设置；`privateBookmarksUnlocked` 未进入迁移包。
- WXT 页面预览显示来源 ID/版本、SHA-256 校验和、1 条书签、2 个收藏夹、2 个设置类别、0 个待同步项、0 个冲突和 2 个 tombstone。
- 点击“取消”返回 `迁移结果：已取消`，当前资料库保持不变。
- 再次上传后点击“合并”返回 `迁移结果：已合并，生成 3 个恢复副本`。
- 合并后保留两边书签 ID：`legacy-browser-bookmark`、`target-browser-bookmark`；cursor 被置空（两边游标不连续）。
- 合并后 `migrationRecovery=1`，持久设置键包含 `legacyUiSetting`、`seededAt`、`targetUiSetting`；会话解锁键不存在。
- 浏览器控制台和页面错误：0。

## 可复核命令

```sh
npm run build:extension
node /tmp/pb-issue14-migration-smoke.mjs
```

脚本使用临时 profile 和临时截图目录，不写入真实用户数据；最终核对通过后 profile 与截图被丢弃，以上结果保留在本报告中。
