# 像素补丁（Pixel Patch）

当前版本：**v0.20.1**

Windows 本地图像区域替换、贴图定位、蒙版融合、Lab 校色及分层 PSD 导出工具。

## 启动

双击 `启动-区域换图工具-v0.20.1.cmd`。启动脚本会打开软件，并启动仅监听 `127.0.0.1` 的本地代理。

## 自动更新

软件每次启动后都会通过本地代理读取公开仓库中的静态 `version.json`，不再调用有次数限制的 GitHub REST API。软件优先读取 GitHub Raw，失败时使用 jsDelivr 镜像。发现更高版本时，左上角版本号旁会显示 `NEW`；点击版本号或 `NEW` 后打开更新窗口，只有用户点击“下载并安装”才会更新。

安装流程会：

1. 下载名为 `AI区域换图工具-v版本号.zip` 的 Release 资源。
2. 使用同名 `.sha256` 文件验证压缩包。
3. 将当前程序文件备份到 `.updates`。
4. 安装新版并重启本地代理，然后重新载入页面。
5. 如果替换失败，自动恢复安装前文件。

公开仓库检查不使用 GitHub Token，因此不会再遇到 GitHub API 每小时请求额度耗尽的问题。AI 平台的 API Key 也不会被用于 GitHub 更新。

## 发布新版本

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\发布新版本.ps1 -Version 0.20.2
```

确认文件内容后提交并推送版本标签：

```powershell
git add .
git commit -m "Release v0.20.2"
git tag v0.20.2
git push origin HEAD --tags
```

`.github/workflows/release.yml` 会自动创建 GitHub Release，并上传 ZIP 与 SHA-256 校验文件。不要只上传普通 ZIP 到仓库文件列表；更新器读取的是 Releases。
