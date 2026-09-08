(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {};
  [
    "editorCanvas", "canvasContainer", "emptyState", "sourceInput", "replacementInput", "projectInput",
    "sourceDrop", "replacementDrop", "sourceInfo", "replacementInfo", "sourceCard", "selectCard", "replaceCard",
    "selectToolBtn", "moveToolBtn", "selectionRatio", "brushCursor", "selX", "selY", "selW", "selH", "offsetX", "offsetY",
    "scaleRange", "opacityRange", "rotationRange", "featherRange", "scaleOutput", "opacityOutput",
    "rotationOutput", "featherOutput", "resetPlacementBtn", "exportCropBtn", "copyCropBtn",
    "exportFinalBtn", "exportPsdBtn", "newProjectBtn", "loadProjectBtn", "saveProjectBtn",
    "emptyOpenBtn", "zoomOutBtn", "zoomInBtn", "fitBtn", "zoomLabel", "imageSizeLabel", "cursorLabel",
    "statusText", "showOutlineCheck", "fitModeGroup", "toast", "resetMaskBtn", "brushModeGroup", "brushEdgeGroup",
    "brushSizeRange", "brushOpacityRange", "brushSizeOutput", "brushOpacityOutput", "holdOriginalBtn", "toggleOutlineBtn",
    "workspace", "rightPanel", "panelTabs", "undoBtn"
    ,"resetColorBtn", "autoMatchColorBtn", "localColorStatus", "colorStrengthRange", "colorStrengthOutput"
    ,"colorLRange", "colorLOutput", "colorARange", "colorAOutput", "colorBRange", "colorBOutput"
    ,"colorSaturationRange", "colorSaturationOutput", "colorTemperatureRange", "colorTemperatureOutput"
    ,"apiProvider", "providerHint", "providerUrlFields", "targetPublicUrl", "referencePublicUrl", "localProxyState"
    ,"apiEndpoint", "apiModel", "apiKey", "generatePromptBtn", "aiColorPrompt", "autoPromptCheck", "aiColorBtn"
    ,"aiProgress", "aiProgressText", "aiProgressPercent", "aiProgressBar", "aiResultState", "aiCompareLabel", "aiCompareToggle"
    ,"updateStatusBtn", "updateNewBadge", "updateDialog", "closeUpdateBtn", "currentVersionLabel", "latestVersionLabel"
    ,"updateMessage", "updateProgress", "releaseNotesWrap", "releaseNotes", "checkUpdateBtn", "installUpdateBtn"
  ].forEach((id) => { els[id] = $(id); });

  const APP_VERSION = "0.20.1";
  const UPDATE_REPOSITORY = "936412035/Pixel-Patch";
  const ctx = els.editorCanvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  const requestedProxyPort = Number(new URLSearchParams(location.search).get("proxyPort"));
  const proxyPort = Number.isInteger(requestedProxyPort) && requestedProxyPort > 0 && requestedProxyPort < 65536 ? requestedProxyPort : 17837;
  const localProxyBase = `http://127.0.0.1:${proxyPort}`;
  const providerPresets = {
    openai: {
      endpoint: "https://api.openai.com/v1/images/edits",
      model: "gpt-image-2",
      adapter: "openai",
      hint: "OpenAI 图片编辑接口：直接发送待校色图与原选区参考图。"
    },
    qwen: {
      endpoint: "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      model: "qwen-image-2.0-pro",
      adapter: "qwen",
      hint: "阿里云百炼工作空间接口：请把地址中的 {WorkspaceId} 替换为控制台里的工作空间 ID；图片会转换为 Base64 后发送。"
    },
    minimax: {
      endpoint: "https://api.minimaxi.com/v1/image_generation",
      model: "image-01",
      adapter: "minimax",
      needsPublicUrls: true,
      hint: "MiniMax / 海螺图像参考生成接口：官方当前要求公网图片 URL，且属于参考生成，不保证像素级只改颜色。"
    },
    lovart: {
      endpoint: "",
      model: "",
      adapter: "openai",
      hint: "Lovart 尚未公开统一稳定的图像编辑请求格式。请从你的 Lovart 工作区复制接口地址与模型；本选项按 OpenAI 兼容的 multipart 格式发送。"
    },
    custom: {
      endpoint: "",
      model: "",
      adapter: "openai",
      hint: "适用于支持 OpenAI Images Edits multipart 字段的兼容服务；接口地址与模型可自行填写。"
    }
  };
  const state = {
    source: null,
    sourcePreview: null,
    sourceFile: null,
    replacement: null,
    replacementFile: null,
    selection: null,
    mask: null,
    tool: "select",
    placement: { fit: "cover", scale: 1, opacity: 1, rotation: 0, feather: 0, offsetX: 0, offsetY: 0 },
    brush: { mode: "erase", edge: "soft", size: 80, opacity: .5 },
    previewOriginal: false,
    brushPreviewActive: false,
    activePanel: "placement",
    history: [],
    maskVersion: 0,
    color: {
      strength: 1, l: 0, a: 0, b: 0, saturation: 0, temperature: 0,
      auto: { lShift: 0, aShift: 0, bShift: 0, lScale: 1, aScale: 1, bScale: 1 },
      matched: false
    },
    colorCache: null,
    colorCacheKey: "",
    aiBefore: null,
    aiCompareBefore: false,
    aiBusy: false,
    proxyReady: false,
    proxyChecking: false,
    updateChecked: false,
    updateBusy: false,
    availableUpdate: null,
    psdBusy: false,
    aiProgressTimer: null,
    cursorPoint: null,
    view: { zoom: 1, panX: 0, panY: 0 },
    interaction: null,
    spaceDown: false,
    pendingProject: null,
    sourceKey: null,
    canvasCssW: 1,
    canvasCssH: 1,
    dpr: 1,
    drawQueued: false
  };

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function openUpdateDialog() {
    if (typeof els.updateDialog.showModal === "function") {
      if (!els.updateDialog.open) els.updateDialog.showModal();
    } else {
      els.updateDialog.setAttribute("open", "");
    }
  }

  function setUpdateBusy(busy, message = "") {
    state.updateBusy = busy;
    els.updateProgress.hidden = !busy;
    els.closeUpdateBtn.disabled = busy;
    els.checkUpdateBtn.disabled = busy;
    els.installUpdateBtn.disabled = busy || !state.availableUpdate?.installable;
    if (message) els.updateMessage.textContent = message;
  }

  function updateReleaseUi(info, manual) {
    state.availableUpdate = info.updateAvailable ? info : null;
    els.currentVersionLabel.textContent = `v${info.currentVersion || APP_VERSION}`;
    els.latestVersionLabel.textContent = info.latestVersion ? `v${info.latestVersion}` : "暂无正式版本";
    els.releaseNotes.textContent = (info.releaseNotes || "本次发布未填写版本说明。").trim();
    els.releaseNotesWrap.hidden = !info.releaseNotes;
    els.updateStatusBtn.classList.toggle("update-ready", !!info.updateAvailable);
    els.updateNewBadge.hidden = !info.updateAvailable;
    if (info.updateAvailable) {
      els.updateStatusBtn.textContent = `v${APP_VERSION}`;
      if (!info.assetAvailable) els.updateMessage.textContent = `发现 v${info.latestVersion}，但 Release 中缺少 ${info.expectedAssetName}。`;
      else if (!info.checksumAvailable) els.updateMessage.textContent = `发现 v${info.latestVersion}，但发布包缺少 SHA-256 校验文件，已阻止安装。`;
      else els.updateMessage.textContent = `发现新版本 v${info.latestVersion}。确认后将下载、校验、备份并安装。`;
      els.installUpdateBtn.disabled = !info.installable;
      if (manual) openUpdateDialog();
    } else {
      els.updateStatusBtn.textContent = `v${APP_VERSION}`;
      els.updateMessage.textContent = info.latestVersion ? `当前已经是最新版本 v${APP_VERSION}。` : "GitHub 仓库尚未发布正式 Release。";
      els.installUpdateBtn.disabled = true;
      if (manual) openUpdateDialog();
    }
  }

  async function checkForUpdates(manual = false) {
    if (state.updateBusy) return;
    if (!state.proxyReady) {
      if (manual) {
        els.latestVersionLabel.textContent = "无法检查";
        els.updateMessage.textContent = "本地代理未连接。请关闭软件并重新运行启动脚本。";
        openUpdateDialog();
      }
      return;
    }
    if (manual) openUpdateDialog();
    setUpdateBusy(true, `正在检查 ${UPDATE_REPOSITORY} 的最新 Release…`);
    els.latestVersionLabel.textContent = "检查中…";
    try {
      const response = await fetch(`${localProxyBase}/api/update/check`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || `检查失败（HTTP ${response.status}）`);
      state.updateChecked = true;
      updateReleaseUi(payload, manual);
    } catch (error) {
      state.availableUpdate = null;
      els.updateNewBadge.hidden = true;
      els.latestVersionLabel.textContent = "检查失败";
      els.updateMessage.textContent = `无法检查更新：${error.message}`;
      els.installUpdateBtn.disabled = true;
      if (manual) openUpdateDialog();
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installAvailableUpdate() {
    const info = state.availableUpdate;
    if (!info?.installable || state.updateBusy) return;
    setUpdateBusy(true, `正在下载并校验 v${info.latestVersion}，请勿关闭软件…`);
    els.installUpdateBtn.textContent = "正在安装…";
    try {
      const response = await fetch(`${localProxyBase}/api/update/install`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Pixel-Patch": "1" },
        body: JSON.stringify({ version: info.latestVersion })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || `安装失败（HTTP ${response.status}）`);
      els.latestVersionLabel.textContent = `v${payload.installedVersion || info.latestVersion}`;
      els.updateNewBadge.hidden = true;
      els.updateMessage.textContent = "更新安装完成，本地代理正在重启，即将载入新版本…";
      els.releaseNotesWrap.hidden = true;
      els.installUpdateBtn.disabled = true;
      els.checkUpdateBtn.disabled = true;
      setTimeout(() => location.reload(), 3200);
    } catch (error) {
      els.updateMessage.textContent = `更新失败：${error.message}。当前版本未被破坏，可稍后重试。`;
      els.installUpdateBtn.textContent = "重试安装";
      setUpdateBusy(false);
    }
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function round2(value) { return Math.round(value * 100) / 100; }
  function basename(name) { return (name || "图片").replace(/\.[^.]+$/, ""); }
  function safeName(name) { return name.replace(/[\\/:*?"<>|]/g, "_"); }
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function setCardState() {
    els.sourceCard.classList.toggle("active", !state.source);
    els.selectCard.classList.toggle("disabled", !state.source);
    els.selectCard.classList.toggle("active", !!state.source && !state.selection);
    els.replaceCard.classList.toggle("disabled", !state.selection);
    els.replaceCard.classList.toggle("active", !!state.selection && !state.replacement);

    const hasSel = !!state.selection;
    const hasReplacement = !!state.replacement && hasSel;
    els.workspace.classList.toggle("ai-loaded", hasReplacement);
    els.rightPanel.classList.toggle("locked", !hasReplacement);
    [els.selX, els.selY, els.selW, els.selH, els.exportCropBtn, els.copyCropBtn].forEach((el) => { el.disabled = !hasSel; });
    els.selectionRatio.disabled = !state.source;
    [els.offsetX, els.offsetY, els.scaleRange, els.opacityRange, els.rotationRange, els.featherRange,
      els.scaleOutput, els.opacityOutput, els.rotationOutput, els.featherOutput, els.resetPlacementBtn]
      .forEach((el) => { el.disabled = !hasReplacement; });
    [els.brushSizeRange, els.brushOpacityRange, els.resetMaskBtn, els.holdOriginalBtn]
      .forEach((el) => { el.disabled = !hasReplacement; });
    els.toggleOutlineBtn.disabled = !hasSel;
    [els.resetColorBtn, els.autoMatchColorBtn, els.colorStrengthRange, els.colorStrengthOutput,
      els.colorLRange, els.colorLOutput, els.colorARange, els.colorAOutput, els.colorBRange, els.colorBOutput,
      els.colorSaturationRange, els.colorSaturationOutput, els.colorTemperatureRange, els.colorTemperatureOutput]
      .forEach((el) => { el.disabled = !hasReplacement; });
    els.aiColorBtn.disabled = !hasReplacement || state.aiBusy || !state.proxyReady;
    document.querySelectorAll(".nudge-pad button").forEach((el) => { el.disabled = !hasReplacement; });
    const canExport = !!state.source && (!state.selection || !!state.replacement);
    els.exportFinalBtn.disabled = !canExport || state.psdBusy;
    els.exportPsdBtn.disabled = !hasReplacement || state.psdBusy;
    els.saveProjectBtn.disabled = !state.source;
    els.undoBtn.disabled = !hasReplacement || state.history.length === 0;
    els.undoBtn.textContent = state.history.length ? `↶ 回退 (${state.history.length})` : "↶ 回退";

    if (!state.source) {
      els.statusText.textContent = "等待载入原图";
      document.querySelector(".status-dot").classList.remove("ready");
    } else if (!state.selection) {
      els.statusText.textContent = "请框选需要替换的区域";
      document.querySelector(".status-dot").classList.add("ready");
    } else if (!state.replacement) {
      els.statusText.textContent = "选区已记住 · 等待 AI 图片";
      document.querySelector(".status-dot").classList.add("ready");
    } else {
      els.statusText.textContent = "正在预览最终合成";
      document.querySelector(".status-dot").classList.add("ready");
    }
  }

  function updateForm() {
    const s = state.selection;
    els.selX.value = s ? Math.round(s.x) : "";
    els.selY.value = s ? Math.round(s.y) : "";
    els.selW.value = s ? Math.round(s.w) : "";
    els.selH.value = s ? Math.round(s.h) : "";
    els.offsetX.value = round2(state.placement.offsetX);
    els.offsetY.value = round2(state.placement.offsetY);
    els.scaleRange.value = Math.round(state.placement.scale * 100);
    els.opacityRange.value = Math.round(state.placement.opacity * 100);
    els.rotationRange.value = state.placement.rotation;
    els.featherRange.value = state.placement.feather;
    els.scaleOutput.value = Math.round(state.placement.scale * 100);
    els.opacityOutput.value = Math.round(state.placement.opacity * 100);
    els.rotationOutput.value = round2(state.placement.rotation);
    els.featherOutput.value = Math.round(state.placement.feather);
    els.brushSizeRange.value = Math.round(state.brush.size);
    els.brushOpacityRange.value = Math.round(state.brush.opacity * 100);
    els.brushSizeOutput.value = `${Math.round(state.brush.size)} px`;
    els.brushOpacityOutput.value = `${Math.round(state.brush.opacity * 100)}%`;
    els.colorStrengthRange.value = Math.round(state.color.strength * 100);
    els.colorStrengthOutput.value = Math.round(state.color.strength * 100);
    els.colorLRange.value = state.color.l;
    els.colorLOutput.value = round2(state.color.l);
    els.colorARange.value = state.color.a;
    els.colorAOutput.value = round2(state.color.a);
    els.colorBRange.value = state.color.b;
    els.colorBOutput.value = round2(state.color.b);
    els.colorSaturationRange.value = state.color.saturation;
    els.colorSaturationOutput.value = Math.round(state.color.saturation);
    els.colorTemperatureRange.value = state.color.temperature;
    els.colorTemperatureOutput.value = Math.round(state.color.temperature);
    els.fitModeGroup.querySelectorAll("button").forEach((b) => b.classList.toggle("selected", b.dataset.fit === state.placement.fit));
    els.brushModeGroup.querySelectorAll("button").forEach((b) => b.classList.toggle("selected", b.dataset.brushMode === state.brush.mode));
    els.brushEdgeGroup.querySelectorAll("button").forEach((b) => b.classList.toggle("selected", b.dataset.brushEdge === state.brush.edge));
    els.toggleOutlineBtn.classList.toggle("selected", els.showOutlineCheck.checked);
    els.toggleOutlineBtn.textContent = els.showOutlineCheck.checked ? "隐藏绿色方框" : "显示绿色方框";
    setCardState();
  }

  function imagePoint(clientX, clientY) {
    const r = els.editorCanvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - state.view.panX) / state.view.zoom,
      y: (clientY - r.top - state.view.panY) / state.view.zoom
    };
  }

  function screenPoint(x, y) {
    return { x: x * state.view.zoom + state.view.panX, y: y * state.view.zoom + state.view.panY };
  }

  function fitView() {
    if (!state.source) return;
    const pad = 44;
    const availableW = Math.max(1, state.canvasCssW - pad * 2);
    const availableH = Math.max(1, state.canvasCssH - pad * 2);
    state.view.zoom = clamp(Math.min(availableW / state.source.width, availableH / state.source.height), 0.00001, 32);
    state.view.panX = (state.canvasCssW - state.source.width * state.view.zoom) / 2;
    state.view.panY = (state.canvasCssH - state.source.height * state.view.zoom) / 2;
    updateZoomLabel();
    requestDraw();
  }

  function updateZoomLabel() {
    const percent = state.view.zoom * 100;
    els.zoomLabel.textContent = `${percent >= 10 ? Math.round(percent) : (percent >= 1 ? percent.toFixed(1) : percent.toFixed(2))}%`;
  }

  function zoomAt(factor, centerX = state.canvasCssW / 2, centerY = state.canvasCssH / 2) {
    if (!state.source) return;
    const old = state.view.zoom;
    const next = clamp(old * factor, 0.00001, 32);
    const imageX = (centerX - state.view.panX) / old;
    const imageY = (centerY - state.view.panY) / old;
    state.view.zoom = next;
    state.view.panX = centerX - imageX * next;
    state.view.panY = centerY - imageY * next;
    updateZoomLabel();
    requestDraw();
  }

  function srgbToLinear(value) {
    value /= 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }

  function linearToSrgb(value) {
    value = clamp(value, 0, 1);
    return 255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055);
  }

  function rgbToLab(r, g, b) {
    r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
    let x = (r * .4124564 + g * .3575761 + b * .1804375) / .95047;
    let y = (r * .2126729 + g * .7151522 + b * .0721750);
    let z = (r * .0193339 + g * .1191920 + b * .9503041) / 1.08883;
    const f = (v) => v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
    x = f(x); y = f(y); z = f(z);
    return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
  }

  function labToRgb(l, a, b) {
    let y = (l + 16) / 116;
    let x = a / 500 + y;
    let z = y - b / 200;
    const f = (v) => v ** 3 > .008856 ? v ** 3 : (v - 16 / 116) / 7.787;
    x = .95047 * f(x); y = f(y); z = 1.08883 * f(z);
    return {
      r: linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -.4985314),
      g: linearToSrgb(x * -.9692660 + y * 1.8760108 + z * .0415560),
      b: linearToSrgb(x * .0556434 + y * -.2040259 + z * 1.0572252)
    };
  }

  function imageLabStats(image, crop = null) {
    const sample = document.createElement("canvas");
    sample.width = 112; sample.height = 112;
    const sctx = sample.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (crop) sctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, sample.width, sample.height);
    else sctx.drawImage(image, 0, 0, sample.width, sample.height);
    const data = sctx.getImageData(0, 0, sample.width, sample.height).data;
    const channels = { l: [], a: [], b: [] };
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      if (lab.l < 3 || lab.l > 97) continue;
      channels.l.push(lab.l); channels.a.push(lab.a); channels.b.push(lab.b);
    }
    const robust = (values) => {
      values.sort((a, b) => a - b);
      const start = Math.floor(values.length * .06);
      const end = Math.max(start + 1, Math.ceil(values.length * .94));
      const trimmed = values.slice(start, end);
      const mean = trimmed.reduce((sum, value) => sum + value, 0) / Math.max(1, trimmed.length);
      const variance = trimmed.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, trimmed.length);
      return { mean, std: Math.sqrt(variance) || 1 };
    };
    return { l: robust(channels.l), a: robust(channels.a), b: robust(channels.b) };
  }

  function measureColorMatch() {
    if (!state.source || !state.selection || !state.replacement) return null;
    const ref = imageLabStats(state.source, state.selection);
    const ai = imageLabStats(state.replacement);
    return {
      lShift: ref.l.mean - ai.l.mean,
      aShift: ref.a.mean - ai.a.mean,
      bShift: ref.b.mean - ai.b.mean,
      lScale: clamp(ref.l.std / ai.l.std, .65, 1.45),
      aScale: clamp(ref.a.std / ai.a.std, .65, 1.45),
      bScale: clamp(ref.b.std / ai.b.std, .65, 1.45),
      meanL: ai.l.mean,
      meanA: ai.a.mean,
      meanB: ai.b.mean
    };
  }

  function colorCacheSignature() {
    const c = state.color;
    return JSON.stringify([c.strength, c.l, c.a, c.b, c.saturation, c.temperature, c.auto, c.matched, state.replacement?.src]);
  }

  function getColorAdjustedImage() {
    if (!state.replacement) return null;
    if (state.aiCompareBefore && state.aiBefore) return state.aiBefore;
    const c = state.color;
    const noManual = c.l === 0 && c.a === 0 && c.b === 0 && c.saturation === 0 && c.temperature === 0;
    if (!c.matched && noManual) return state.replacement;
    const signature = colorCacheSignature();
    if (state.colorCache && state.colorCacheKey === signature) return state.colorCache;
    const canvas = document.createElement("canvas");
    canvas.width = state.replacement.width;
    canvas.height = state.replacement.height;
    const cctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    cctx.drawImage(state.replacement, 0, 0);
    const imageData = cctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const auto = c.auto;
    const strength = c.matched ? c.strength : 0;
    const saturation = 1 + c.saturation / 100;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      let l = lab.l + strength * ((lab.l - (auto.meanL ?? 50)) * (auto.lScale - 1) + auto.lShift) + c.l;
      let a = lab.a + strength * ((lab.a - (auto.meanA ?? 0)) * (auto.aScale - 1) + auto.aShift) + c.a;
      let b = lab.b + strength * ((lab.b - (auto.meanB ?? 0)) * (auto.bScale - 1) + auto.bShift) + c.b;
      a = a * saturation + c.temperature * .035;
      b = b * saturation + c.temperature * .14;
      const rgb = labToRgb(clamp(l, 0, 100), clamp(a, -128, 127), clamp(b, -128, 127));
      data[i] = Math.round(rgb.r); data[i + 1] = Math.round(rgb.g); data[i + 2] = Math.round(rgb.b);
    }
    cctx.putImageData(imageData, 0, 0);
    state.colorCache = canvas;
    state.colorCacheKey = signature;
    return canvas;
  }

  function requestDraw() {
    if (state.drawQueued) return;
    state.drawQueued = true;
    requestAnimationFrame(() => { state.drawQueued = false; draw(); updateBrushCursor(); });
  }

  function resizeCanvas() {
    const r = els.canvasContainer.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const first = state.canvasCssW <= 1 || state.canvasCssH <= 1;
    state.canvasCssW = w;
    state.canvasCssH = h;
    state.dpr = dpr;
    els.editorCanvas.width = Math.round(w * dpr);
    els.editorCanvas.height = Math.round(h * dpr);
    els.editorCanvas.style.width = `${w}px`;
    els.editorCanvas.style.height = `${h}px`;
    if (first && state.source) fitView(); else requestDraw();
  }

  function replacementBaseScale() {
    if (!state.selection || !state.replacement) return 1;
    const source = state.aiCompareBefore && state.aiBefore ? state.aiBefore : state.replacement;
    const sx = state.selection.w / source.width;
    const sy = state.selection.h / source.height;
    return state.placement.fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  }

  function makeReplacementPatch(pixelRatioX = 1, pixelRatioY = pixelRatioX) {
    if (!state.selection || !state.replacement) return null;
    const s = state.selection;
    const patch = document.createElement("canvas");
    patch.width = Math.max(1, Math.ceil(s.w * pixelRatioX));
    patch.height = Math.max(1, Math.ceil(s.h * pixelRatioY));
    const pctx = patch.getContext("2d", { alpha: true, colorSpace: "srgb" });
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = "high";
    const base = replacementBaseScale();
    const replacementSource = getColorAdjustedImage();
    const drawW = replacementSource.width * base * state.placement.scale * pixelRatioX;
    const drawH = replacementSource.height * base * state.placement.scale * pixelRatioY;
    const cx = patch.width / 2 + state.placement.offsetX * pixelRatioX;
    const cy = patch.height / 2 + state.placement.offsetY * pixelRatioY;
    pctx.save();
    pctx.globalAlpha = state.placement.opacity;
    pctx.translate(cx, cy);
    pctx.rotate(state.placement.rotation * Math.PI / 180);
    pctx.drawImage(replacementSource, -drawW / 2, -drawH / 2, drawW, drawH);
    pctx.restore();

    const featherX = Math.min(state.placement.feather * pixelRatioX, patch.width / 2);
    const featherY = Math.min(state.placement.feather * pixelRatioY, patch.height / 2);
    if (featherX > 0 || featherY > 0) {
      pctx.globalCompositeOperation = "destination-in";
      if (featherX > 0) {
        const gx = pctx.createLinearGradient(0, 0, patch.width, 0);
        gx.addColorStop(0, "rgba(0,0,0,0)");
        gx.addColorStop(featherX / patch.width, "rgba(0,0,0,1)");
        gx.addColorStop(1 - featherX / patch.width, "rgba(0,0,0,1)");
        gx.addColorStop(1, "rgba(0,0,0,0)");
        pctx.fillStyle = gx;
        pctx.fillRect(0, 0, patch.width, patch.height);
      }
      if (featherY > 0) {
        const gy = pctx.createLinearGradient(0, 0, 0, patch.height);
        gy.addColorStop(0, "rgba(0,0,0,0)");
        gy.addColorStop(featherY / patch.height, "rgba(0,0,0,1)");
        gy.addColorStop(1 - featherY / patch.height, "rgba(0,0,0,1)");
        gy.addColorStop(1, "rgba(0,0,0,0)");
        pctx.fillStyle = gy;
        pctx.fillRect(0, 0, patch.width, patch.height);
      }
    }
    if (state.mask) {
      pctx.globalCompositeOperation = "destination-in";
      pctx.globalAlpha = 1;
      pctx.drawImage(state.mask, 0, 0, patch.width, patch.height);
    }
    return patch;
  }

  function draw() {
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.canvasCssW, state.canvasCssH);
    if (!state.source) return;
    const imageLeft = state.view.panX;
    const imageTop = state.view.panY;
    const imageW = state.source.width * state.view.zoom;
    const imageH = state.source.height * state.view.zoom;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.6)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 5;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.sourcePreview || state.source, imageLeft, imageTop, imageW, imageH);
    ctx.restore();

    if (state.selection && state.replacement && !state.previewOriginal) {
      const s = state.selection;
      const p = screenPoint(s.x, s.y);
      const patch = makeReplacementPatch(state.view.zoom, state.view.zoom);
      if (patch) ctx.drawImage(patch, p.x, p.y, s.w * state.view.zoom, s.h * state.view.zoom);
    }

    if (state.selection && els.showOutlineCheck.checked) {
      const s = state.selection;
      const p = screenPoint(s.x, s.y);
      const w = s.w * state.view.zoom;
      const h = s.h * state.view.zoom;
      ctx.save();
      ctx.beginPath();
      ctx.rect(imageLeft, imageTop, imageW, imageH);
      ctx.rect(p.x, p.y, w, h);
      ctx.fillStyle = "rgba(0,0,0,.24)";
      ctx.fill("evenodd");
      ctx.strokeStyle = "#d8ff48";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(p.x + .5, p.y + .5, w, h);
      ctx.setLineDash([]);
      const handle = 6;
      ctx.fillStyle = "#d8ff48";
      [[p.x, p.y], [p.x + w, p.y], [p.x, p.y + h], [p.x + w, p.y + h]].forEach(([x, y]) => {
        ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
      });
      const label = `${Math.round(s.w)} × ${Math.round(s.h)} px`;
      ctx.font = "11px Segoe UI, sans-serif";
      const tw = ctx.measureText(label).width + 14;
      const ly = p.y > 26 ? p.y - 25 : p.y + 8;
      ctx.fillStyle = "#d8ff48";
      ctx.fillRect(p.x, ly, tw, 19);
      ctx.fillStyle = "#171b0a";
      ctx.fillText(label, p.x + 7, ly + 13);
      ctx.restore();
    }

    if (state.brushPreviewActive && state.replacement) {
      const cx = state.canvasCssW / 2;
      const cy = state.canvasCssH / 2;
      const radius = Math.max(2, state.brush.size * state.view.zoom / 2);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (state.brush.edge === "soft") {
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(255,255,255,${state.brush.opacity})`);
        gradient.addColorStop(.55, `rgba(255,255,255,${state.brush.opacity * .82})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = `rgba(255,255,255,${state.brush.opacity})`;
      }
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const label = `${Math.round(state.brush.size)} px · ${Math.round(state.brush.opacity * 100)}%`;
      ctx.font = "11px Segoe UI, sans-serif";
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = "rgba(17,19,21,.88)";
      ctx.fillRect(cx - tw / 2, cy + radius + 9, tw, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, cx - tw / 2 + 7, cy + radius + 23);
      ctx.restore();
    }
  }

  function setTool(tool) {
    if (tool === "brush" && !state.replacement) return;
    state.tool = tool;
    els.selectToolBtn.classList.toggle("selected", tool === "select");
    els.moveToolBtn.classList.toggle("selected", tool === "move");
    els.editorCanvas.style.cursor = tool === "select" ? "crosshair" : (tool === "move" ? "move" : "none");
    updateBrushCursor();
  }

  function updateBrushCursor() {
    const point = state.cursorPoint;
    const visible = state.tool === "brush" && !!state.replacement && !!point && !!state.source &&
      point.x >= 0 && point.y >= 0 && point.x <= state.source.width && point.y <= state.source.height;
    els.brushCursor.classList.toggle("visible", visible);
    if (!visible) return;
    const screen = screenPoint(point.x, point.y);
    const size = Math.max(4, state.brush.size * state.view.zoom);
    els.brushCursor.style.left = `${screen.x}px`;
    els.brushCursor.style.top = `${screen.y}px`;
    els.brushCursor.style.width = `${size}px`;
    els.brushCursor.style.height = `${size}px`;
    els.brushCursor.classList.toggle("soft", state.brush.edge === "soft");
    els.brushCursor.style.opacity = String(Math.max(.25, state.brush.opacity));
  }

  function selectedRatio() {
    return els.selectionRatio.value === "free" ? null : Number(els.selectionRatio.value);
  }

  function constrainCorner(anchor, point, sx, sy, ratio) {
    let w = Math.min(Math.abs(point.x - anchor.x), sx > 0 ? state.source.width - anchor.x : anchor.x);
    let h = Math.min(Math.abs(point.y - anchor.y), sy > 0 ? state.source.height - anchor.y : anchor.y);
    if (ratio) {
      if (w / Math.max(h, .0001) > ratio) h = w / ratio;
      else w = h * ratio;
      const maxW = sx > 0 ? state.source.width - anchor.x : anchor.x;
      const maxH = sy > 0 ? state.source.height - anchor.y : anchor.y;
      if (w > maxW) { w = maxW; h = w / ratio; }
      if (h > maxH) { h = maxH; w = h * ratio; }
    }
    return {
      x: Math.round(sx > 0 ? anchor.x : anchor.x - w),
      y: Math.round(sy > 0 ? anchor.y : anchor.y - h),
      w: Math.max(1, Math.round(w)),
      h: Math.max(1, Math.round(h))
    };
  }

  function normalizeSelection(a, b, ratio = null) {
    if (!state.source) return null;
    if (ratio) return constrainCorner(a, b, b.x < a.x ? -1 : 1, b.y < a.y ? -1 : 1, ratio);
    const x1 = clamp(Math.min(a.x, b.x), 0, state.source.width);
    const y1 = clamp(Math.min(a.y, b.y), 0, state.source.height);
    const x2 = clamp(Math.max(a.x, b.x), 0, state.source.width);
    const y2 = clamp(Math.max(a.y, b.y), 0, state.source.height);
    return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
  }

  function selectionHit(point) {
    const s = state.selection;
    if (!s) return null;
    const tolerance = 11 / state.view.zoom;
    const corners = [
      { name: "nw", x: s.x, y: s.y }, { name: "ne", x: s.x + s.w, y: s.y },
      { name: "sw", x: s.x, y: s.y + s.h }, { name: "se", x: s.x + s.w, y: s.y + s.h }
    ];
    const corner = corners.find((c) => Math.abs(point.x - c.x) <= tolerance && Math.abs(point.y - c.y) <= tolerance);
    if (corner) return corner.name;
    if (point.x >= s.x - tolerance && point.x <= s.x + s.w + tolerance && point.y >= s.y - tolerance && point.y <= s.y + s.h + tolerance) return "move-selection";
    return null;
  }

  function selectionCursor(hit) {
    if (hit === "nw" || hit === "se") return "nwse-resize";
    if (hit === "ne" || hit === "sw") return "nesw-resize";
    if (hit === "move-selection") return "move";
    return "crosshair";
  }

  function validSelection(s) { return s && s.w >= 2 && s.h >= 2; }

  function rememberSelection() {
    if (!state.sourceKey || !state.selection) return;
    try { localStorage.setItem(state.sourceKey, JSON.stringify(state.selection)); } catch (_) { /* Storage can be disabled. */ }
  }

  function restoreSelection() {
    if (!state.sourceKey) return false;
    try {
      const parsed = JSON.parse(localStorage.getItem(state.sourceKey));
      if (validSelection(parsed)) {
        state.selection = sanitizeSelection(parsed);
        return true;
      }
    } catch (_) { /* Ignore invalid saved data. */ }
    return false;
  }

  function sanitizeSelection(s) {
    if (!state.source) return null;
    const x = clamp(Math.round(Number(s.x) || 0), 0, state.source.width - 1);
    const y = clamp(Math.round(Number(s.y) || 0), 0, state.source.height - 1);
    const w = clamp(Math.round(Number(s.w) || 1), 1, state.source.width - x);
    const h = clamp(Math.round(Number(s.h) || 1), 1, state.source.height - y);
    return { x, y, w, h };
  }

  function defaultPlacement() {
    state.placement = { fit: "contain", scale: 1, opacity: 1, rotation: 0, feather: 0, offsetX: 0, offsetY: 0 };
  }

  function defaultColor() {
    state.color = {
      strength: 1, l: 0, a: 0, b: 0, saturation: 0, temperature: 0,
      auto: { lShift: 0, aShift: 0, bShift: 0, lScale: 1, aScale: 1, bScale: 1 },
      matched: false
    };
    invalidateColorCache();
  }

  function cloneColor(color) {
    return { ...color, auto: { ...color.auto } };
  }

  function invalidateColorCache() {
    state.colorCache = null;
    state.colorCacheKey = "";
  }

  function createMask(fill = true) {
    if (!state.selection) { state.mask = null; state.maskVersion += 1; return; }
    const mask = document.createElement("canvas");
    mask.width = Math.max(1, Math.round(state.selection.w));
    mask.height = Math.max(1, Math.round(state.selection.h));
    if (fill) {
      const mctx = mask.getContext("2d");
      mctx.fillStyle = "#fff";
      mctx.fillRect(0, 0, mask.width, mask.height);
    }
    state.mask = mask;
    state.maskVersion += 1;
  }

  function cloneCanvas(source) {
    if (!source) return null;
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d").drawImage(source, 0, 0);
    return copy;
  }

  function pushHistory(label) {
    if (!state.replacement) return;
    const previous = state.history[state.history.length - 1];
    const savedMask = previous && previous.maskVersion === state.maskVersion ? previous.mask : cloneCanvas(state.mask);
    state.history.push({
      label,
      placement: { ...state.placement },
      brush: { ...state.brush },
      color: cloneColor(state.color),
      replacement: state.replacement,
      replacementFile: state.replacementFile,
      aiBefore: state.aiBefore,
      aiCompareBefore: state.aiCompareBefore,
      mask: savedMask,
      maskVersion: state.maskVersion
    });
    if (state.history.length > 20) state.history.shift();
    setCardState();
  }

  function undo() {
    const snapshot = state.history.pop();
    if (!snapshot) return;
    state.placement = { ...snapshot.placement };
    state.brush = { ...snapshot.brush };
    state.color = cloneColor(snapshot.color || state.color);
    state.replacement = snapshot.replacement || state.replacement;
    state.replacementFile = snapshot.replacementFile || state.replacementFile;
    state.aiBefore = snapshot.aiBefore || null;
    state.aiCompareBefore = !!snapshot.aiCompareBefore;
    invalidateColorCache();
    state.mask = cloneCanvas(snapshot.mask);
    state.maskVersion = snapshot.maskVersion;
    updateForm();
    updateAiCompareUI();
    requestDraw();
    toast(`已回退：${snapshot.label}`);
  }

  function clearHistory() {
    state.history = [];
    if (els.undoBtn) els.undoBtn.disabled = true;
  }

  function ensureMask() {
    if (!state.selection) return;
    if (!state.mask || state.mask.width !== Math.round(state.selection.w) || state.mask.height !== Math.round(state.selection.h)) createMask(true);
  }

  function paintMaskDab(point) {
    if (!state.mask || !state.selection) return;
    const x = point.x - state.selection.x;
    const y = point.y - state.selection.y;
    const radius = state.brush.size / 2;
    const mctx = state.mask.getContext("2d");
    mctx.save();
    mctx.globalCompositeOperation = state.brush.mode === "erase" ? "destination-out" : "source-over";
    mctx.beginPath();
    mctx.arc(x, y, radius, 0, Math.PI * 2);
    if (state.brush.edge === "soft") {
      const gradient = mctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255,255,255,${state.brush.opacity})`);
      gradient.addColorStop(.55, `rgba(255,255,255,${state.brush.opacity * .82})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = gradient;
    } else {
      mctx.fillStyle = `rgba(255,255,255,${state.brush.opacity})`;
    }
    mctx.fill();
    mctx.restore();
  }

  function paintMaskLine(from, to) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const spacing = Math.max(1, state.brush.size * .12);
    const count = Math.max(1, Math.ceil(distance / spacing));
    for (let i = 1; i <= count; i += 1) {
      const t = i / count;
      paintMaskDab({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }

  function restoreMaskData(dataUrl) {
    if (!dataUrl || !state.selection) return;
    const image = new Image();
    image.onload = () => {
      createMask(false);
      state.mask.getContext("2d").drawImage(image, 0, 0, state.mask.width, state.mask.height);
      requestDraw();
      toast("项目中的蒙版已恢复");
    };
    image.src = dataUrl;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) return reject(new Error("请选择图片文件"));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片无法读取或格式不受支持")); };
      img.src = url;
    });
  }

  async function createSourcePreview(image) {
    const maxEdge = 4096;
    const maxPixels = 10000000;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height), Math.sqrt(maxPixels / (image.width * image.height)));
    if (scale >= .999) return image;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const preview = document.createElement("canvas");
    preview.width = Math.max(1, Math.round(image.width * scale));
    preview.height = Math.max(1, Math.round(image.height * scale));
    const pctx = preview.getContext("2d", { alpha: true, colorSpace: "srgb" });
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(image, 0, 0, preview.width, preview.height);
    return preview;
  }

  async function openSource(file) {
    try {
      els.statusText.textContent = "正在载入并优化大图预览…";
      const img = await loadImage(file);
      const sourcePreview = await createSourcePreview(img);
      state.source = img;
      state.sourcePreview = sourcePreview;
      state.sourceFile = file;
      state.replacement = null;
      state.replacementFile = null;
      state.mask = null;
      state.aiBefore = null;
      state.aiCompareBefore = false;
      state.sourceKey = `pixelpatch:v1:${file.name}:${file.size}:${file.lastModified}:${img.width}x${img.height}`;
      state.selection = null;
      clearHistory();
      defaultPlacement();
      defaultColor();
      const remembered = restoreSelection();
      if (state.pendingProject) applyPendingProject();
      els.emptyState.classList.add("hidden");
      els.sourceInfo.classList.remove("hidden");
      els.sourceInfo.innerHTML = `<strong>${escapeHtml(file.name)}</strong><br>${img.width} × ${img.height} px · ${formatBytes(file.size)}`;
      els.replacementInfo.classList.add("hidden");
      els.imageSizeLabel.textContent = `原图：${img.width} × ${img.height} px`;
      updateForm();
      updateAiCompareUI();
      fitView();
      toast(remembered ? "已恢复这张图片上次的选区" : "原图已载入，请框选替换区域");
    } catch (error) { toast(error.message); }
  }

  async function openReplacement(file) {
    if (!state.selection) return toast("请先框选替换区域");
    try {
      const img = await loadImage(file);
      state.replacement = img;
      state.replacementFile = file;
      state.aiBefore = null;
      state.aiCompareBefore = false;
      defaultColor();
      ensureMask();
      clearHistory();
      els.replacementInfo.classList.remove("hidden");
      els.replacementInfo.innerHTML = `<strong>${escapeHtml(file.name || "剪贴板图片")}</strong><br>${img.width} × ${img.height} px · 自动等比例对齐`;
      if (state.pendingProject) applyPendingProject();
      setTool("move");
      switchPanel("placement");
      updateForm();
      updateAiCompareUI();
      requestDraw();
      toast("AI 图片已放入选区，可直接拖动调整");
    } catch (error) { toast(error.message); }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function applyPendingProject() {
    const project = state.pendingProject;
    if (!project || !state.source) return;
    if (project.source && project.source.width && (project.source.width !== state.source.width || project.source.height !== state.source.height)) {
      toast("项目尺寸与当前原图不同，已保留当前图片");
      return;
    }
    if (project.selection) state.selection = sanitizeSelection(project.selection);
    if (project.selectionRatio != null) els.selectionRatio.value = String(project.selectionRatio);
    if (project.placement) {
      state.placement = {
        fit: project.placement.fit === "contain" ? "contain" : "cover",
        scale: clamp(Number(project.placement.scale) || 1, .1, 4),
        opacity: clamp(Number(project.placement.opacity) || 0, 0, 1),
        rotation: clamp(Number(project.placement.rotation) || 0, -180, 180),
        feather: clamp(Number(project.placement.feather) || 0, 0, 100),
        offsetX: Number(project.placement.offsetX) || 0,
        offsetY: Number(project.placement.offsetY) || 0
      };
    }
    if (project.brush) {
      const savedBrushOpacity = Number(project.brush.opacity);
      state.brush = {
        mode: project.brush.mode === "paint" ? "paint" : "erase",
        edge: project.brush.edge === "hard" ? "hard" : "soft",
        size: clamp(Number(project.brush.size) || 80, 1, 500),
        opacity: clamp(Number.isFinite(savedBrushOpacity) ? savedBrushOpacity : .5, 0, 1)
      };
    }
    if (project.color) {
      state.color = {
        strength: clamp(Number(project.color.strength) || 0, 0, 1),
        l: clamp(Number(project.color.l) || 0, -30, 30),
        a: clamp(Number(project.color.a) || 0, -30, 30),
        b: clamp(Number(project.color.b) || 0, -30, 30),
        saturation: clamp(Number(project.color.saturation) || 0, -100, 100),
        temperature: clamp(Number(project.color.temperature) || 0, -100, 100),
        auto: { ...state.color.auto, ...(project.color.auto || {}) },
        matched: !!project.color.matched
      };
      invalidateColorCache();
    }
    if (project.mask && state.replacement) restoreMaskData(project.mask);
    rememberSelection();
    if (state.replacement || !project.replacement) state.pendingProject = null;
    updateForm();
    requestDraw();
  }

  function setSelectionFromForm() {
    if (!state.source || !state.selection) return;
    const oldW = state.selection.w;
    const oldH = state.selection.h;
    state.selection = sanitizeSelection({ x: els.selX.value, y: els.selY.value, w: els.selW.value, h: els.selH.value });
    if (state.replacement && (oldW !== state.selection.w || oldH !== state.selection.h)) createMask(true);
    rememberSelection();
    updateForm();
    requestDraw();
  }

  function applySelectionRatio() {
    const ratio = selectedRatio();
    if (!ratio || !state.selection || !state.source) return;
    const old = state.selection;
    const cx = old.x + old.w / 2;
    const cy = old.y + old.h / 2;
    let w = old.w;
    let h = w / ratio;
    if (h > state.source.height) { h = state.source.height; w = h * ratio; }
    if (w > state.source.width) { w = state.source.width; h = w / ratio; }
    const next = sanitizeSelection({
      x: clamp(cx - w / 2, 0, state.source.width - w),
      y: clamp(cy - h / 2, 0, state.source.height - h),
      w,
      h
    });
    const sizeChanged = next.w !== old.w || next.h !== old.h;
    state.selection = next;
    if (state.replacement && sizeChanged) createMask(true);
    rememberSelection();
    updateForm();
    requestDraw();
  }

  function setPlacementValue(key, value) {
    state.placement[key] = value;
    updateForm();
    requestDraw();
  }

  function nudge(dx, dy, amount = 1, record = true) {
    if (!state.replacement) return;
    if (record) pushHistory("贴图位置");
    state.placement.offsetX = round2(state.placement.offsetX + dx * amount);
    state.placement.offsetY = round2(state.placement.offsetY + dy * amount);
    updateForm();
    requestDraw();
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片导出失败")), "image/png"));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName(filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportCrop(copy = false) {
    if (!state.source || !state.selection) return;
    const s = state.selection;
    const out = document.createElement("canvas");
    out.width = s.w;
    out.height = s.h;
    const octx = out.getContext("2d", { alpha: true, colorSpace: "srgb" });
    octx.drawImage(state.source, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    try {
      const blob = await canvasToBlob(out);
      if (copy) {
        if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("当前浏览器不允许直接复制图片，请使用“导出选区 PNG”");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("选区图片已复制到剪贴板");
      } else {
        downloadBlob(blob, `${basename(state.sourceFile.name)}_AI选区_${s.w}x${s.h}.png`);
        toast("选区 PNG 已导出");
      }
    } catch (error) { toast(error.message); }
  }

  async function exportFinal() {
    if (!state.source) return;
    if (state.selection && !state.replacement) return toast("选区尚未放入 AI 图片");
    els.statusText.textContent = "正在按原始分辨率导出…";
    try {
      const out = document.createElement("canvas");
      out.width = state.source.width;
      out.height = state.source.height;
      const octx = out.getContext("2d", { alpha: true, colorSpace: "srgb" });
      octx.drawImage(state.source, 0, 0);
      if (state.selection && state.replacement) {
        const patch = makeReplacementPatch(1, 1);
        octx.drawImage(patch, state.selection.x, state.selection.y, state.selection.w, state.selection.h);
      }
      const blob = await canvasToBlob(out);
      downloadBlob(blob, `${basename(state.sourceFile.name)}_AI区域替换.png`);
      toast(`已导出 ${out.width} × ${out.height} px PNG`);
    } catch (error) { toast(error.message); }
    setCardState();
  }

  class PsdWriter {
    constructor() { this.parts = []; this.length = 0; }
    bytes(value) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      this.parts.push(bytes); this.length += bytes.byteLength; return this;
    }
    number(value, size, signed = false) {
      const bytes = new Uint8Array(size);
      const view = new DataView(bytes.buffer);
      if (size === 1) view.setUint8(0, value);
      else if (size === 2) signed ? view.setInt16(0, value, false) : view.setUint16(0, value, false);
      else signed ? view.setInt32(0, value, false) : view.setUint32(0, value, false);
      return this.bytes(bytes);
    }
    u8(value) { return this.number(value, 1); }
    u16(value) { return this.number(value, 2); }
    i16(value) { return this.number(value, 2, true); }
    u32(value) {
      if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) throw new Error("PSD 数据块超过标准 PSD 的 4 GB 限制");
      return this.number(value, 4);
    }
    i32(value) { return this.number(value, 4, true); }
    ascii(text) { return this.bytes(new TextEncoder().encode(text)); }
    append(writer) { this.parts.push(...writer.parts); this.length += writer.length; return this; }
  }

  function concatByteParts(parts, total) {
    const output = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => { output.set(part, offset); offset += part.length; });
    return output;
  }

  function packBitsChannelRow(rgba, start, width, channelOffset) {
    const output = [];
    const valueAt = (index) => rgba[start + index * 4 + channelOffset];
    let index = 0;
    while (index < width) {
      let run = 1;
      while (index + run < width && run < 128 && valueAt(index + run) === valueAt(index)) run += 1;
      if (run >= 3) {
        output.push(257 - run, valueAt(index));
        index += run;
        continue;
      }
      const literalStart = index;
      index += run;
      while (index < width && index - literalStart < 128) {
        let nextRun = 1;
        while (index + nextRun < width && nextRun < 128 && valueAt(index + nextRun) === valueAt(index)) nextRun += 1;
        if (nextRun >= 3) break;
        index += Math.min(nextRun, 128 - (index - literalStart));
      }
      const literalLength = index - literalStart;
      output.push(literalLength - 1);
      for (let i = literalStart; i < index; i += 1) output.push(valueAt(i));
    }
    return Uint8Array.from(output);
  }

  async function encodeRasterRle(width, height, channelOffsets, renderStrip, onProgress) {
    const strip = document.createElement("canvas");
    strip.width = width;
    const rowsPerStrip = Math.max(1, Math.min(64, Math.floor(4000000 / Math.max(1, width))));
    const channels = channelOffsets.map(() => ({ counts: new Uint8Array(height * 2), dataParts: [], dataLength: 0 }));
    for (let y = 0; y < height; y += rowsPerStrip) {
      const rows = Math.min(rowsPerStrip, height - y);
      strip.height = rows;
      const sctx = strip.getContext("2d", { alpha: true, willReadFrequently: true, colorSpace: "srgb" });
      sctx.clearRect(0, 0, width, rows);
      renderStrip(sctx, y, rows);
      const rgba = sctx.getImageData(0, 0, width, rows).data;
      for (let channelIndex = 0; channelIndex < channelOffsets.length; channelIndex += 1) {
        const rowParts = [];
        let stripLength = 0;
        const countsView = new DataView(channels[channelIndex].counts.buffer);
        for (let row = 0; row < rows; row += 1) {
          const encoded = packBitsChannelRow(rgba, row * width * 4, width, channelOffsets[channelIndex]);
          if (encoded.length > 65535) throw new Error("图像行数据超过 PSD RLE 限制，请缩小图像宽度");
          countsView.setUint16((y + row) * 2, encoded.length, false);
          rowParts.push(encoded); stripLength += encoded.length;
        }
        channels[channelIndex].dataParts.push(concatByteParts(rowParts, stripLength));
        channels[channelIndex].dataLength += stripLength;
      }
      onProgress?.((y + rows) / height);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return { width, height, channels };
  }

  function layerChannel(raster, channelIndex) {
    const channel = raster.channels[channelIndex];
    const writer = new PsdWriter();
    writer.u16(1).bytes(channel.counts);
    channel.dataParts.forEach((part) => writer.bytes(part));
    return writer;
  }

  function psdLayerExtra(name) {
    const writer = new PsdWriter();
    writer.u32(0).u32(0);
    const nameBytes = new TextEncoder().encode(name.slice(0, 255));
    writer.u8(nameBytes.length).bytes(nameBytes);
    while (writer.length % 4) writer.u8(0);
    return writer;
  }

  function writePsdLayerRecord(writer, bounds, channelIds, channelWriters, name) {
    writer.i32(bounds.top).i32(bounds.left).i32(bounds.bottom).i32(bounds.right).u16(channelIds.length);
    channelIds.forEach((id, index) => writer.i16(id).u32(channelWriters[index].length));
    writer.ascii("8BIM").ascii("norm").u8(255).u8(0).u8(0).u8(0);
    const extra = psdLayerExtra(name);
    writer.u32(extra.length).append(extra);
  }

  async function createLayeredPsd() {
    const width = state.source.width;
    const height = state.source.height;
    if (width > 30000 || height > 30000) throw new Error("标准 PSD 最大边长为 30000 px；更大的图片需要 PSB 格式");
    const s = state.selection;
    const patch = makeReplacementPatch(1, 1);
    const channelIds = [-1, 0, 1, 2];
    const layerOffsets = [3, 0, 1, 2];
    const compositeOffsets = [0, 1, 2, 3];
    const progress = (start, span, label) => (value) => {
      els.statusText.textContent = `${label} ${Math.round((start + value * span) * 100)}%`;
    };

    const originalRaster = await encodeRasterRle(width, height, layerOffsets, (rctx, y, rows) => {
      rctx.drawImage(state.source, 0, y, width, rows, 0, 0, width, rows);
    }, progress(0, .38, "正在编码 PSD 原图层"));
    const aiRaster = await encodeRasterRle(patch.width, patch.height, layerOffsets, (rctx, y, rows) => {
      rctx.drawImage(patch, 0, y, patch.width, rows, 0, 0, patch.width, rows);
    }, progress(.38, .20, "正在编码 PSD AI 图层"));
    const compositeRaster = await encodeRasterRle(width, height, compositeOffsets, (rctx, y, rows) => {
      rctx.drawImage(state.source, 0, y, width, rows, 0, 0, width, rows);
      rctx.drawImage(patch, s.x, s.y - y);
    }, progress(.58, .42, "正在生成 PSD 合成预览"));

    const aiChannels = channelIds.map((_, index) => layerChannel(aiRaster, index));
    const originalChannels = channelIds.map((_, index) => layerChannel(originalRaster, index));
    const records = new PsdWriter();
    writePsdLayerRecord(records, { top: 0, left: 0, bottom: height, right: width }, channelIds, originalChannels, "Original");
    writePsdLayerRecord(records, { top: s.y, left: s.x, bottom: s.y + patch.height, right: s.x + patch.width }, channelIds, aiChannels, "AI Result");

    const layerInfo = new PsdWriter();
    layerInfo.i16(2).append(records);
    originalChannels.forEach((channel) => layerInfo.append(channel));
    aiChannels.forEach((channel) => layerInfo.append(channel));
    if (layerInfo.length % 2) layerInfo.u8(0);
    const layerMaskBody = new PsdWriter();
    layerMaskBody.u32(layerInfo.length).append(layerInfo).u32(0);

    const header = new PsdWriter();
    header.ascii("8BPS").u16(1).bytes(new Uint8Array(6)).u16(4).u32(height).u32(width).u16(8).u16(3);
    header.u32(0).u32(0).u32(layerMaskBody.length).append(layerMaskBody);
    header.u16(1);
    compositeRaster.channels.forEach((channel) => header.bytes(channel.counts));
    compositeRaster.channels.forEach((channel) => channel.dataParts.forEach((part) => header.bytes(part)));
    if (header.length > 2147483647) throw new Error("生成的 PSD 超过 2 GB，请缩小图片或选区后再导出");
    return new Blob(header.parts, { type: "image/vnd.adobe.photoshop" });
  }

  async function exportPsd() {
    if (!state.source || !state.selection || !state.replacement || state.psdBusy) return;
    state.psdBusy = true;
    setCardState();
    try {
      const blob = await createLayeredPsd();
      downloadBlob(blob, `${basename(state.sourceFile.name)}_AI分层.psd`);
      toast("PSD 已导出：原图与 AI 结果共两个图层");
    } catch (error) {
      toast(error.message);
    } finally {
      state.psdBusy = false;
      setCardState();
    }
  }

  function setColorValue(key, value) {
    state.color[key] = value;
    invalidateColorCache();
    updateForm();
    requestDraw();
  }

  function autoMatchColor() {
    const match = measureColorMatch();
    if (!match) return toast("请先载入原图、框选区域并放入 AI 图片");
    pushHistory("本地自动校色");
    state.color.auto = match;
    state.color.matched = true;
    state.color.strength = 1;
    invalidateColorCache();
    const redText = match.aShift < 0 ? `减少红色 ${Math.abs(match.aShift).toFixed(1)}` : `增加红色 ${match.aShift.toFixed(1)}`;
    els.localColorStatus.textContent = `匹配完成：亮度 ${match.lShift >= 0 ? "+" : ""}${match.lShift.toFixed(1)}，${redText}，黄蓝 ${match.bShift >= 0 ? "+" : ""}${match.bShift.toFixed(1)}`;
    updateForm();
    requestDraw();
    toast("已按原选区完成本地 Lab 匹色");
  }

  function resetColorAdjustments() {
    pushHistory("重置颜色");
    defaultColor();
    els.localColorStatus.textContent = "颜色调整已重置。以原选区为参考，在本机计算。";
    updateForm();
    requestDraw();
  }

  function generateColorPrompt() {
    const match = measureColorMatch();
    if (!match) return "";
    const redDiagnosis = match.aShift < -1 ? "目标图存在明显偏红/偏洋红，需要降低 Lab a*。" :
      (match.aShift > 1 ? "目标图偏绿，需要适度增加 Lab a*。" : "目标图的红绿平衡接近参考。 ");
    const yellowDiagnosis = match.bShift < -1 ? "目标图偏黄，需要降低 Lab b*。" :
      (match.bShift > 1 ? "目标图偏蓝，需要增加 Lab b*。" : "目标图的黄蓝平衡接近参考。 ");
    const prompt = `请只对第一张图片进行专业色彩校正，第二张图片是原图选区的色彩与光线参考。\n\n严格保持第一张图片中的人物身份、五官、表情、发型、构图、纹理、轮廓、背景结构和所有像素级细节；不要新增、删除、移动或重绘任何物体。只允许调整白平衡、曝光、对比度、Lab 色彩和饱和度。\n\n色差分析：参考区域与待校色图相比，需要将亮度 L* 调整 ${match.lShift >= 0 ? "+" : ""}${match.lShift.toFixed(1)}，a* 调整 ${match.aShift >= 0 ? "+" : ""}${match.aShift.toFixed(1)}，b* 调整 ${match.bShift >= 0 ? "+" : ""}${match.bShift.toFixed(1)}。${redDiagnosis}${yellowDiagnosis}\n\n让肤色、阴影、中间调、高光色温和整体饱和度自然匹配第二张参考图，重点消除不自然的红色偏色。输出与第一张图片内容和构图完全相同的高质量 PNG，仅颜色发生必要变化。`;
    els.aiColorPrompt.value = prompt;
    return prompt;
  }

  function setAiProgress(percent, text) {
    els.aiProgress.classList.remove("hidden");
    els.aiProgressBar.style.width = `${clamp(percent, 0, 100)}%`;
    els.aiProgressPercent.textContent = `${Math.round(percent)}%`;
    els.aiProgressText.textContent = text;
  }

  function startAiProgress() {
    clearInterval(state.aiProgressTimer);
    let value = 18;
    setAiProgress(value, "已上传 · AI 正在校色…");
    state.aiProgressTimer = setInterval(() => {
      value = Math.min(92, value + Math.max(1, (92 - value) * .08));
      setAiProgress(value, value < 55 ? "分析原图色彩参考…" : (value < 82 ? "校正白平衡与 Lab 色彩…" : "生成高质量结果…"));
    }, 900);
  }

  function stopAiProgress() {
    clearInterval(state.aiProgressTimer);
    state.aiProgressTimer = null;
  }

  function canvasForImage(image) {
    if (image instanceof HTMLCanvasElement) return image;
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext("2d", { colorSpace: "srgb" }).drawImage(image, 0, 0);
    return canvas;
  }

  function originalSelectionCanvas() {
    const s = state.selection;
    const canvas = document.createElement("canvas");
    canvas.width = s.w; canvas.height = s.h;
    canvas.getContext("2d", { colorSpace: "srgb" }).drawImage(state.source, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    return canvas;
  }

  function base64ImageBlob(base64, type = "image/png") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片转换为 Base64 失败"));
      reader.readAsDataURL(blob);
    });
  }

  function closestAspectRatio(width, height) {
    const ratio = width / Math.max(1, height);
    const options = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9]];
    return options.reduce((best, item) => Math.abs(item[0] / item[1] - ratio) < Math.abs(best[0] / best[1] - ratio) ? item : best).join(":");
  }

  async function requestLocalProxy({ provider, endpoint, model, apiKey, prompt, targetBlob, referenceBlob, targetCanvas }) {
    if (!state.proxyReady) throw new Error("本地代理未连接，请点击代理状态重新连接");
    if (provider === "qwen" && endpoint.includes("{WorkspaceId}")) {
      throw new Error("请先把接口地址中的 {WorkspaceId} 替换为阿里云百炼工作空间 ID");
    }
    const targetUrl = els.targetPublicUrl.value.trim();
    const referenceUrl = els.referencePublicUrl.value.trim();
    if (provider === "minimax" && (!/^https:\/\//i.test(targetUrl) || !/^https:\/\//i.test(referenceUrl))) {
      throw new Error("MiniMax / 海螺需要填写两张图片的 HTTPS 公网 URL");
    }
    const needsEmbeddedImages = provider !== "minimax";
    const [targetImage, referenceImage] = needsEmbeddedImages ?
      await Promise.all([blobToDataUrl(targetBlob), blobToDataUrl(referenceBlob)]) : ["", ""];
    const response = await fetch(`${localProxyBase}/api/color-correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pixel-Patch": "1" },
      body: JSON.stringify({
        provider, endpoint, model, apiKey, prompt, targetImage, referenceImage,
        targetPublicUrl: targetUrl,
        referencePublicUrl: referenceUrl,
        aspectRatio: closestAspectRatio(targetCanvas.width, targetCanvas.height)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `本地代理请求失败（HTTP ${response.status}）`);
    if (!payload.imageBase64) throw new Error("本地代理响应中没有图片数据");
    return base64ImageBlob(payload.imageBase64, payload.mimeType || "image/png");
  }

  async function checkLocalProxy() {
    if (state.proxyChecking) return;
    state.proxyChecking = true;
    state.proxyReady = false;
    els.localProxyState.className = "proxy-state checking";
    els.localProxyState.textContent = "正在连接本地代理…";
    setCardState();
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          const response = await fetch(`${localProxyBase}/health`, { cache: "no-store" });
          const payload = await response.json();
          if (response.ok && payload.app === "pixel-patch") {
            state.proxyReady = true;
            els.localProxyState.className = "proxy-state";
            els.localProxyState.textContent = "本地代理已连接 · AI API 可以使用";
            if (!state.updateChecked) setTimeout(() => checkForUpdates(false), 450);
            return;
          }
        } catch { }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      els.localProxyState.className = "proxy-state error";
      els.localProxyState.textContent = "本地代理未连接 · 点击这里重试；普通编辑功能不受影响";
    } finally {
      state.proxyChecking = false;
      setCardState();
    }
  }

  function applyProviderPreset(provider, overwrite = true) {
    const preset = providerPresets[provider] || providerPresets.openai;
    if (overwrite) {
      els.apiEndpoint.value = preset.endpoint;
      els.apiModel.value = preset.model;
    }
    els.providerHint.textContent = preset.hint;
    els.providerUrlFields.classList.toggle("hidden", !preset.needsPublicUrls);
    els.apiEndpoint.placeholder = provider === "lovart" ? "从 Lovart 工作区复制接口地址" : "https://…";
    els.apiModel.placeholder = provider === "lovart" ? "从 Lovart 工作区复制模型名" : "模型名称";
    els.apiKey.placeholder = provider === "qwen" ? "sk-…（阿里云百炼）" : (provider === "minimax" ? "MiniMax API Key" : "sk-…");
  }

  function updateAiCompareUI() {
    const available = !!state.aiBefore;
    els.aiCompareToggle.disabled = !available;
    els.aiCompareToggle.checked = available && state.aiCompareBefore;
    els.aiCompareLabel.classList.toggle("disabled", !available);
  }

  async function runAiColorCorrection() {
    if (!state.replacement || !state.selection) return;
    const provider = els.apiProvider.value;
    const endpoint = els.apiEndpoint.value.trim();
    const model = els.apiModel.value.trim();
    const apiKey = els.apiKey.value.trim();
    if (!endpoint || !model || !apiKey) return toast("请填写接口地址、模型和 API Key");
    if (state.aiBusy) return;
    if (!state.proxyReady) return toast("本地代理未连接，请重新运行启动脚本");
    if (els.autoPromptCheck.checked || !els.aiColorPrompt.value.trim()) generateColorPrompt();
    const prompt = els.aiColorPrompt.value.trim();
    if (!prompt) return toast("无法生成提示词，请检查图片和选区");

    state.aiBusy = true;
    state.aiCompareBefore = false;
    updateAiCompareUI();
    setCardState();
    els.aiResultState.className = "ai-result-state";
    els.aiResultState.textContent = "正在准备原选区和 AI 图片…";
    setAiProgress(6, "准备两张参考图片…");
    try {
      const targetCanvas = canvasForImage(getColorAdjustedImage());
      const [targetBlob, referenceBlob] = await Promise.all([canvasToBlob(targetCanvas), canvasToBlob(originalSelectionCanvas())]);
      startAiProgress();
      const resultBlob = await requestLocalProxy({ provider, endpoint, model, apiKey, prompt, targetBlob, referenceBlob, targetCanvas });
      const corrected = await loadImage(resultBlob);
      pushHistory("AI 自动校色");
      state.aiBefore = targetCanvas;
      state.replacement = corrected;
      const resultType = resultBlob.type || "image/png";
      const resultExt = /jpe?g/i.test(resultType) ? "jpg" : "png";
      state.replacementFile = new File([resultBlob], `${basename(state.replacementFile?.name || "AI图片")}_AI校色.${resultExt}`, { type: resultType });
      els.replacementInfo.innerHTML = `<strong>${escapeHtml(state.replacementFile.name)}</strong><br>${corrected.width} × ${corrected.height} px · AI 校色完成`;
      state.aiCompareBefore = false;
      defaultColor();
      stopAiProgress();
      setAiProgress(100, "AI 校色完成");
      els.aiResultState.className = "ai-result-state success";
      const providerName = els.apiProvider.options[els.apiProvider.selectedIndex].textContent;
      els.aiResultState.textContent = `✓ ${providerName} 校色完成，可使用下方开关对比校色前后。`;
      updateAiCompareUI();
      updateForm();
      requestDraw();
      toast("AI 校色已完成");
    } catch (error) {
      stopAiProgress();
      setAiProgress(0, "校色失败");
      els.aiResultState.className = "ai-result-state error";
      const proxyHint = /fetch|network/i.test(error.message) ? " 无法连接本地代理，请关闭页面后重新运行启动脚本。" : "";
      els.aiResultState.textContent = `失败：${error.message}${proxyHint}`;
      toast("AI 校色失败，请查看状态说明");
    } finally {
      state.aiBusy = false;
      setCardState();
    }
  }

  function saveProject() {
    if (!state.source) return;
    const project = {
      app: "像素补丁",
      version: 1,
      savedAt: new Date().toISOString(),
      source: { name: state.sourceFile.name, width: state.source.width, height: state.source.height, size: state.sourceFile.size },
      replacement: state.replacement ? { name: state.replacementFile.name, width: state.replacement.width, height: state.replacement.height } : null,
      selection: state.selection,
      selectionRatio: els.selectionRatio.value,
      placement: state.placement,
      brush: state.brush,
      color: state.color,
      mask: state.mask ? state.mask.toDataURL("image/png") : null,
      note: "项目文件仅记录位置参数，不内嵌图片。重新打开时请载入对应图片。"
    };
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), `${basename(state.sourceFile.name)}_像素补丁项目.json`);
    toast("项目参数已保存");
  }

  async function loadProject(file) {
    try {
      const project = JSON.parse(await file.text());
      if (project.app !== "像素补丁" || !project.version) throw new Error("这不是有效的像素补丁项目文件");
      state.pendingProject = project;
      if (state.source) applyPendingProject();
      toast(`项目已读取，请载入原图${project.replacement ? "和 AI 图片" : ""}`);
    } catch (error) { toast(error.message); }
  }

  function resetAll() {
    state.source = null;
    state.sourcePreview = null;
    state.sourceFile = null;
    state.replacement = null;
    state.replacementFile = null;
    state.selection = null;
    state.mask = null;
    state.pendingProject = null;
    state.sourceKey = null;
    state.aiBefore = null;
    state.aiCompareBefore = false;
    clearHistory();
    defaultPlacement();
    defaultColor();
    els.emptyState.classList.remove("hidden");
    els.sourceInfo.classList.add("hidden");
    els.replacementInfo.classList.add("hidden");
    els.imageSizeLabel.textContent = "原图：—";
    els.cursorLabel.innerHTML = "x: — &nbsp; y: —";
    setTool("select");
    updateForm();
    updateAiCompareUI();
    els.aiResultState.className = "ai-result-state";
    els.aiResultState.textContent = "尚未进行 AI 校色";
    els.aiProgress.classList.add("hidden");
    requestDraw();
  }

  function addDropHandlers(element, callback) {
    ["dragenter", "dragover"].forEach((type) => element.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      element.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach((type) => element.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      element.classList.remove("dragover");
    }));
    element.addEventListener("drop", (event) => {
      const file = [...event.dataTransfer.files].find((f) => f.type.startsWith("image/"));
      if (file) callback(file);
    });
  }

  function switchPanel(panel) {
    state.activePanel = panel;
    els.panelTabs.querySelectorAll("button").forEach((button) => button.classList.toggle("selected", button.dataset.panel === panel));
    els.rightPanel.querySelectorAll("[data-panel-content]").forEach((content) => content.classList.toggle("selected", content.dataset.panelContent === panel));
    if (panel === "mask" && state.replacement) setTool("brush");
    if (panel !== "mask" && state.replacement) setTool("move");
    if (panel === "color" && state.replacement && !els.aiColorPrompt.value.trim()) generateColorPrompt();
    requestDraw();
  }

  els.sourceDrop.addEventListener("click", () => els.sourceInput.click());
  els.emptyOpenBtn.addEventListener("click", () => els.sourceInput.click());
  els.replacementDrop.addEventListener("click", () => els.replacementInput.click());
  els.sourceInput.addEventListener("change", () => { if (els.sourceInput.files[0]) openSource(els.sourceInput.files[0]); els.sourceInput.value = ""; });
  els.replacementInput.addEventListener("change", () => { if (els.replacementInput.files[0]) openReplacement(els.replacementInput.files[0]); els.replacementInput.value = ""; });
  addDropHandlers(els.sourceDrop, openSource);
  addDropHandlers(els.replacementDrop, openReplacement);

  document.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) { event.preventDefault(); openReplacement(file); }
  });

  els.selectToolBtn.addEventListener("click", () => setTool("select"));
  els.moveToolBtn.addEventListener("click", () => { setTool("move"); switchPanel("placement"); });
  els.panelTabs.addEventListener("click", (event) => { if (event.target.dataset.panel) switchPanel(event.target.dataset.panel); });
  els.undoBtn.addEventListener("click", undo);
  [els.selX, els.selY, els.selW, els.selH].forEach((el) => el.addEventListener("change", setSelectionFromForm));
  els.selectionRatio.addEventListener("change", applySelectionRatio);
  els.offsetX.addEventListener("change", () => setPlacementValue("offsetX", Number(els.offsetX.value) || 0));
  els.offsetY.addEventListener("change", () => setPlacementValue("offsetY", Number(els.offsetY.value) || 0));
  els.scaleRange.addEventListener("input", () => setPlacementValue("scale", Number(els.scaleRange.value) / 100));
  els.opacityRange.addEventListener("input", () => setPlacementValue("opacity", Number(els.opacityRange.value) / 100));
  els.rotationRange.addEventListener("input", () => setPlacementValue("rotation", Number(els.rotationRange.value)));
  els.featherRange.addEventListener("input", () => setPlacementValue("feather", Number(els.featherRange.value)));
  [
    [els.scaleOutput, els.scaleRange], [els.opacityOutput, els.opacityRange],
    [els.rotationOutput, els.rotationRange], [els.featherOutput, els.featherRange]
  ].forEach(([numberInput, rangeInput]) => {
    numberInput.addEventListener("focus", () => pushHistory("键入贴图参数"));
    numberInput.addEventListener("change", () => {
      const value = clamp(Number(numberInput.value) || 0, Number(numberInput.min), Number(numberInput.max));
      rangeInput.value = String(value);
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  const colorBindings = [
    [els.colorStrengthRange, els.colorStrengthOutput, "strength", .01],
    [els.colorLRange, els.colorLOutput, "l", 1],
    [els.colorARange, els.colorAOutput, "a", 1],
    [els.colorBRange, els.colorBOutput, "b", 1],
    [els.colorSaturationRange, els.colorSaturationOutput, "saturation", 1],
    [els.colorTemperatureRange, els.colorTemperatureOutput, "temperature", 1]
  ];
  colorBindings.forEach(([rangeInput, numberInput, key, multiplier]) => {
    rangeInput.addEventListener("pointerdown", () => pushHistory("手动校色"));
    rangeInput.addEventListener("input", () => {
      setColorValue(key, Number(rangeInput.value) * multiplier);
      els.localColorStatus.textContent = "正在预览手动 Lab 色彩调整。";
    });
    numberInput.addEventListener("focus", () => pushHistory("键入校色参数"));
    numberInput.addEventListener("change", () => {
      const value = clamp(Number(numberInput.value) || 0, Number(numberInput.min), Number(numberInput.max));
      rangeInput.value = String(value);
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  els.autoMatchColorBtn.addEventListener("click", autoMatchColor);
  els.resetColorBtn.addEventListener("click", resetColorAdjustments);
  els.generatePromptBtn.addEventListener("click", () => {
    if (generateColorPrompt()) toast("已根据当前色差生成校色提示词");
  });
  els.apiProvider.addEventListener("change", () => {
    applyProviderPreset(els.apiProvider.value, true);
    els.aiResultState.className = "ai-result-state";
    els.aiResultState.textContent = "已切换服务平台，请检查接口、模型和密钥。";
  });
  els.localProxyState.addEventListener("click", checkLocalProxy);
  els.aiColorBtn.addEventListener("click", runAiColorCorrection);
  els.aiCompareToggle.addEventListener("change", () => {
    if (!state.aiBefore) return;
    state.aiCompareBefore = els.aiCompareToggle.checked;
    invalidateColorCache();
    requestDraw();
    els.aiResultState.className = "ai-result-state success";
    els.aiResultState.textContent = state.aiCompareBefore ? "正在显示 AI 校色前" : "正在显示 AI 校色后";
  });
  [els.offsetX, els.offsetY].forEach((input) => input.addEventListener("focus", () => pushHistory("贴图位置")));
  [els.scaleRange, els.opacityRange, els.rotationRange, els.featherRange].forEach((input) => input.addEventListener("pointerdown", () => pushHistory("贴图参数")));
  els.fitModeGroup.addEventListener("click", (event) => {
    if (!event.target.dataset.fit || event.target.dataset.fit === state.placement.fit) return;
    pushHistory("对齐方式");
    setPlacementValue("fit", event.target.dataset.fit);
  });
  els.brushModeGroup.addEventListener("click", (event) => {
    if (!event.target.dataset.brushMode || event.target.dataset.brushMode === state.brush.mode) return;
    pushHistory("画笔模式");
    state.brush.mode = event.target.dataset.brushMode;
    updateForm();
  });
  els.brushEdgeGroup.addEventListener("click", (event) => {
    if (!event.target.dataset.brushEdge || event.target.dataset.brushEdge === state.brush.edge) return;
    pushHistory("画笔边缘");
    state.brush.edge = event.target.dataset.brushEdge;
    updateForm();
    updateBrushCursor();
    requestDraw();
  });
  [els.brushSizeRange, els.brushOpacityRange].forEach((input) => {
    input.addEventListener("pointerdown", () => { pushHistory("画笔参数"); state.brushPreviewActive = true; requestDraw(); });
    input.addEventListener("pointerup", () => { state.brushPreviewActive = false; requestDraw(); });
    input.addEventListener("pointercancel", () => { state.brushPreviewActive = false; requestDraw(); });
  });
  els.brushSizeRange.addEventListener("input", () => { state.brush.size = Number(els.brushSizeRange.value); updateForm(); updateBrushCursor(); requestDraw(); });
  els.brushOpacityRange.addEventListener("input", () => { state.brush.opacity = Number(els.brushOpacityRange.value) / 100; updateForm(); updateBrushCursor(); requestDraw(); });
  document.querySelectorAll(".nudge-pad button").forEach((button) => button.addEventListener("click", () => {
    const [dx, dy] = button.dataset.nudge.split(",").map(Number);
    nudge(dx, dy);
  }));
  els.resetPlacementBtn.addEventListener("click", () => { pushHistory("重置贴图"); defaultPlacement(); updateForm(); requestDraw(); toast("贴图调整已重置"); });
  els.resetMaskBtn.addEventListener("click", () => { pushHistory("重置蒙版"); createMask(true); requestDraw(); toast("蒙版已重置，AI 图片完整显示"); });
  els.showOutlineCheck.addEventListener("change", requestDraw);
  els.toggleOutlineBtn.addEventListener("click", () => {
    els.showOutlineCheck.checked = !els.showOutlineCheck.checked;
    updateForm();
    requestDraw();
  });

  function startOriginalPreview(event) {
    if (!state.replacement) return;
    event.preventDefault();
    state.previewOriginal = true;
    els.holdOriginalBtn.classList.add("holding");
    els.holdOriginalBtn.setPointerCapture?.(event.pointerId);
    requestDraw();
  }
  function endOriginalPreview() {
    if (!state.previewOriginal) return;
    state.previewOriginal = false;
    els.holdOriginalBtn.classList.remove("holding");
    requestDraw();
  }
  els.holdOriginalBtn.addEventListener("pointerdown", startOriginalPreview);
  els.holdOriginalBtn.addEventListener("pointerup", endOriginalPreview);
  els.holdOriginalBtn.addEventListener("pointercancel", endOriginalPreview);
  els.holdOriginalBtn.addEventListener("lostpointercapture", endOriginalPreview);
  els.exportCropBtn.addEventListener("click", () => exportCrop(false));
  els.copyCropBtn.addEventListener("click", () => exportCrop(true));
  els.exportFinalBtn.addEventListener("click", exportFinal);
  els.exportPsdBtn.addEventListener("click", exportPsd);
  els.saveProjectBtn.addEventListener("click", saveProject);
  els.loadProjectBtn.addEventListener("click", () => els.projectInput.click());
  els.projectInput.addEventListener("change", () => { if (els.projectInput.files[0]) loadProject(els.projectInput.files[0]); els.projectInput.value = ""; });
  els.newProjectBtn.addEventListener("click", resetAll);
  els.updateStatusBtn.addEventListener("click", () => checkForUpdates(true));
  els.updateNewBadge.addEventListener("click", () => state.availableUpdate ? openUpdateDialog() : checkForUpdates(true));
  els.checkUpdateBtn.addEventListener("click", () => checkForUpdates(true));
  els.installUpdateBtn.addEventListener("click", installAvailableUpdate);
  els.closeUpdateBtn.addEventListener("click", () => { if (!state.updateBusy) els.updateDialog.close(); });
  els.updateDialog.addEventListener("cancel", (event) => { if (state.updateBusy) event.preventDefault(); });
  els.zoomInBtn.addEventListener("click", () => zoomAt(1.2));
  els.zoomOutBtn.addEventListener("click", () => zoomAt(1 / 1.2));
  els.fitBtn.addEventListener("click", fitView);

  document.querySelectorAll(".scrub-label[data-scrub]").forEach((label) => {
    label.title = "按住鼠标左右拖动调整数值";
    label.addEventListener("pointerdown", (event) => {
      if (event.target.tagName === "INPUT") return;
      const input = $(label.dataset.scrub);
      if (!input || input.disabled || event.button !== 0) return;
      event.preventDefault();
      const historyTargets = ["offsetX", "offsetY", "scaleRange", "opacityRange", "rotationRange", "featherRange", "brushSizeRange", "brushOpacityRange",
        "colorStrengthRange", "colorLRange", "colorARange", "colorBRange", "colorSaturationRange", "colorTemperatureRange"];
      if (historyTargets.includes(input.id)) pushHistory(input.id.startsWith("brush") ? "画笔参数" : (input.id.startsWith("color") ? "手动校色" : "贴图参数"));
      const isBrushPreview = input.id === "brushSizeRange" || input.id === "brushOpacityRange";
      if (isBrushPreview) { state.brushPreviewActive = true; requestDraw(); }
      label.setPointerCapture(event.pointerId);
      label.classList.add("scrubbing");
      const startX = event.clientX;
      const startValue = Number(input.value) || 0;
      const step = Number(label.dataset.scrubStep) || Number(input.step) || 1;
      const onMove = (moveEvent) => {
        const min = input.min === "" ? -Infinity : Number(input.min);
        const max = input.max === "" ? Infinity : Number(input.max);
        const value = clamp(startValue + (moveEvent.clientX - startX) * step, min, max);
        input.value = String(round2(value));
        input.dispatchEvent(new Event(input.type === "range" ? "input" : "change", { bubbles: true }));
      };
      const onEnd = () => {
        if (isBrushPreview) { state.brushPreviewActive = false; requestDraw(); }
        label.classList.remove("scrubbing");
        label.removeEventListener("pointermove", onMove);
        label.removeEventListener("pointerup", onEnd);
        label.removeEventListener("pointercancel", onEnd);
      };
      label.addEventListener("pointermove", onMove);
      label.addEventListener("pointerup", onEnd);
      label.addEventListener("pointercancel", onEnd);
    });
  });

  els.editorCanvas.addEventListener("wheel", (event) => {
    if (!state.source) return;
    event.preventDefault();
    const r = els.editorCanvas.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - r.left, event.clientY - r.top);
  }, { passive: false });

  els.editorCanvas.addEventListener("pointerdown", (event) => {
    if (!state.source) return;
    els.canvasContainer.focus();
    els.editorCanvas.setPointerCapture(event.pointerId);
    const point = imagePoint(event.clientX, event.clientY);
    state.cursorPoint = point;
    updateBrushCursor();
    if (event.button === 1 || state.spaceDown) {
      state.interaction = { type: "pan", startClientX: event.clientX, startClientY: event.clientY, panX: state.view.panX, panY: state.view.panY };
      els.editorCanvas.style.cursor = "grabbing";
      return;
    }
    if (event.button !== 0) return;
    if (state.tool === "brush" && state.selection && state.replacement) {
      const s = state.selection;
      if (point.x >= s.x && point.x <= s.x + s.w && point.y >= s.y && point.y <= s.y + s.h) {
        ensureMask();
        pushHistory("蒙版笔触");
        paintMaskDab(point);
        state.interaction = { type: "brush", last: point };
        requestDraw();
      }
    } else if (state.tool === "move" && state.selection && state.replacement) {
      const s = state.selection;
      if (point.x >= s.x && point.x <= s.x + s.w && point.y >= s.y && point.y <= s.y + s.h) {
        pushHistory("贴图位置");
        state.interaction = { type: "move", start: point, offsetX: state.placement.offsetX, offsetY: state.placement.offsetY };
      }
    } else if (state.tool === "select") {
      const hit = selectionHit(point);
      if (["nw", "ne", "sw", "se"].includes(hit)) {
        const s = state.selection;
        const anchor = {
          x: hit.includes("w") ? s.x + s.w : s.x,
          y: hit.includes("n") ? s.y + s.h : s.y
        };
        state.interaction = { type: "resize-selection", corner: hit, anchor, oldSelection: { ...s } };
      } else if (hit === "move-selection") {
        state.interaction = { type: "move-selection", start: point, oldSelection: { ...state.selection } };
      } else {
        state.interaction = { type: "select", start: point, oldSelection: state.selection };
        state.selection = normalizeSelection(point, point);
        updateForm();
        requestDraw();
      }
    }
  });

  els.editorCanvas.addEventListener("pointermove", (event) => {
    if (!state.source) return;
    const point = imagePoint(event.clientX, event.clientY);
    state.cursorPoint = point;
    updateBrushCursor();
    const inside = point.x >= 0 && point.y >= 0 && point.x <= state.source.width && point.y <= state.source.height;
    els.cursorLabel.innerHTML = inside ? `x: ${Math.round(point.x)} &nbsp; y: ${Math.round(point.y)}` : "x: — &nbsp; y: —";
    const i = state.interaction;
    if (!i) {
      if (state.tool === "select") els.editorCanvas.style.cursor = selectionCursor(selectionHit(point));
      return;
    }
    if (i.type === "pan") {
      state.view.panX = i.panX + event.clientX - i.startClientX;
      state.view.panY = i.panY + event.clientY - i.startClientY;
    } else if (i.type === "select") {
      state.selection = normalizeSelection(i.start, point, selectedRatio() || (event.shiftKey ? 1 : null));
      updateForm();
    } else if (i.type === "move-selection") {
      const s = i.oldSelection;
      state.selection = {
        x: Math.round(clamp(s.x + point.x - i.start.x, 0, state.source.width - s.w)),
        y: Math.round(clamp(s.y + point.y - i.start.y, 0, state.source.height - s.h)),
        w: s.w,
        h: s.h
      };
      updateForm();
    } else if (i.type === "resize-selection") {
      const sx = i.corner.includes("e") ? 1 : -1;
      const sy = i.corner.includes("s") ? 1 : -1;
      const ratio = selectedRatio() || (event.shiftKey ? i.oldSelection.w / i.oldSelection.h : null);
      state.selection = constrainCorner(i.anchor, point, sx, sy, ratio);
      updateForm();
    } else if (i.type === "move") {
      state.placement.offsetX = round2(i.offsetX + point.x - i.start.x);
      state.placement.offsetY = round2(i.offsetY + point.y - i.start.y);
      updateForm();
    } else if (i.type === "brush") {
      paintMaskLine(i.last, point);
      i.last = point;
    }
    requestDraw();
  });

  function endPointer() {
    const i = state.interaction;
    if (!i) return;
    if (["select", "move-selection", "resize-selection"].includes(i.type)) {
      if (!validSelection(state.selection)) state.selection = i.oldSelection;
      else {
        const sizeChanged = !i.oldSelection || i.oldSelection.w !== state.selection.w || i.oldSelection.h !== state.selection.h;
        if (state.replacement && sizeChanged) createMask(true);
        rememberSelection();
        toast(`已记住 ${state.selection.w} × ${state.selection.h} px 选区`);
      }
      updateForm();
    }
    if (i.type === "brush") state.maskVersion += 1;
    state.interaction = null;
    els.editorCanvas.style.cursor = state.spaceDown ? "grab" : (state.tool === "select" ? "crosshair" : (state.tool === "move" ? "move" : "none"));
    requestDraw();
  }
  els.editorCanvas.addEventListener("pointerup", endPointer);
  els.editorCanvas.addEventListener("pointercancel", endPointer);
  els.editorCanvas.addEventListener("pointerenter", (event) => {
    if (!state.source) return;
    state.cursorPoint = imagePoint(event.clientX, event.clientY);
    updateBrushCursor();
    if (state.tool === "select" && !state.interaction) els.editorCanvas.style.cursor = selectionCursor(selectionHit(state.cursorPoint));
  });
  els.editorCanvas.addEventListener("pointerleave", () => {
    if (!state.interaction) {
      state.cursorPoint = null;
      updateBrushCursor();
      requestDraw();
    }
  });

  document.addEventListener("keydown", (event) => {
    const editing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && state.replacement) {
      event.preventDefault();
      undo();
      return;
    }
    if (event.code === "Space" && !editing) { state.spaceDown = true; event.preventDefault(); els.editorCanvas.style.cursor = "grab"; }
    if (editing) return;
    if (event.key.toLowerCase() === "s") setTool("select");
    if (event.key.toLowerCase() === "v") { setTool("move"); switchPanel("placement"); }
    if (event.key.toLowerCase() === "b") { setTool("brush"); switchPanel("mask"); }
    const directions = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (directions[event.key] && state.replacement) {
      event.preventDefault();
      const amount = event.altKey ? .1 : (event.shiftKey ? 10 : 1);
      nudge(...directions[event.key], amount);
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") { state.spaceDown = false; els.editorCanvas.style.cursor = state.tool === "select" ? "crosshair" : (state.tool === "move" ? "move" : "none"); }
  });
  window.addEventListener("blur", () => { state.spaceDown = false; });

  new ResizeObserver(resizeCanvas).observe(els.canvasContainer);
  els.updateStatusBtn.textContent = `v${APP_VERSION}`;
  els.currentVersionLabel.textContent = `v${APP_VERSION}`;
  applyProviderPreset(els.apiProvider.value, false);
  resetAll();
  checkLocalProxy();
})();
