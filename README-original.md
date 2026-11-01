# 慧眼 · 盲人识物 App

专为盲人 / 视障人士设计的智能识物应用。核心解决 **出行时找不到房间号 / 门牌号** 的痛点:
把手机摄像头对准门牌,点击屏幕,即可 **逐位语音朗读** 房间号。

## 为盲人做的无障碍设计

- **整屏即按钮**:屏幕任意位置点击就识别,无需精准定位。
- **全程语音引导**:每一步(启动、识别中、结果、出错)都有中文语音播报。
- **门牌号逐位朗读**:如 `1203` 读作「一、二、零、三 号房间」,避免连读听错。
- **震动反馈**:识别开始 / 成功 / 失败 有不同震动节奏,嘈杂环境也能感知。
- **高对比大字界面**:黑底 + 黄字、超大字号,弱视者也可辅助辨认。
- **兼容读屏**:所有按钮带 `aria-label`,与 TalkBack / VoiceOver 协同。
- **重读键**:随时重听上一次结果。

## 技术栈

| 能力 | 方案 |
|------|------|
| 文字识别 OCR | [Tesseract.js](https://tesseract.projectnaptha.com/) 中文简体 + 英文,浏览器内离线运行 |
| 语音播报 | Web Speech API(系统中文 TTS) |
| 摄像头 | `getUserMedia`,默认后置摄像头 |
| 离线 / 安装 | PWA(manifest + Service Worker),可"添加到主屏幕" |

## 目录结构

```
index.html      入口页面 / 界面结构
styles.css      高对比无障碍样式
app.js          核心逻辑:摄像头、OCR、语音、震动、门牌号解析
manifest.json   PWA 清单
sw.js           Service Worker(离线缓存)
server.js       本地测试服务器(自动 HTTP/HTTPS)
make-icons.js   生成应用图标
icons/          应用图标(已生成)
cert.pem/key.pem 自签 HTTPS 证书(已生成,供手机测试)
```

## 快速运行(手机测试)

> 摄像头 API 要求 **HTTPS**(或 localhost)。已生成自签证书,直接跑即可。

1. 电脑启动服务器:
   ```bash
   node server.js
   ```
2. 手机与电脑连 **同一 WiFi**,用手机 Chrome 打开终端里打印的
   `https://<电脑IP>:8443` 地址。
3. 首次会提示证书不安全 → 选择「高级 / 继续访问」(自签证书正常现象)。
4. 授予 **摄像头** 权限,对准门牌,点击屏幕识别。
5. 可选「添加到主屏幕」,像原生 App 一样全屏使用。

### 更稳的公网访问(推荐演示用)

```bash
npx ngrok http 8443        # 得到一个可信 https 域名,手机直接打开
```
或部署到 **Netlify / Vercel / GitHub Pages**(自带 HTTPS,把这些静态文件上传即可)。

## 打包成真正的 APK

当前机器缺少 Android SDK,无法直接编译。以下任一方式可把本 PWA 变成 `.apk`:

### 方式 A:Bubblewrap(Google 官方,最接近原生)

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://你的域名/manifest.json
bubblewrap build          # 产出 app-release-signed.apk
```
> 需要先把网站部署到一个 HTTPS 公网地址(Netlify 等)。

### 方式 B:PWABuilder(网页操作,零命令行)

1. 打开 https://www.pwabuilder.com
2. 输入你部署好的网站地址 → 生成 → 下载 Android 包(含 `.apk` / `.aab`)。

### 方式 C:Capacitor(需要 Android Studio)

```bash
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init 慧眼 com.huiyan.app --web-dir=.
npx cap add android
npx cap open android      # 在 Android Studio 里 Build > Build APK
```

## 已知限制 / 下一步

- 首次识别需联网下载 Tesseract 中文语言包(约几 MB),之后浏览器缓存,离线可用。
  若要**完全离线打包**,把语言包与 `tesseract.min.js` 下载到本地,改 `index.html` 与 `app.js` 里的路径。
- 门牌号解析用正则启发式,复杂排版可切到「全部文字」模式(底部"模式"键)。
- 可扩展:接入物体识别(TensorFlow.js COCO-SSD)、离线大模型 OCR、多语言。
