/*
  Renoising trick animation.

  Safe to paste into the same JS file as the original estimator animation:
  everything is scoped inside this IIFE and all names are renoise-prefixed.

  Required canvas:
    <canvas id="renoiseCanvas"></canvas>

  Expected manifest:
    ./imgs/anim-1/imglist.json

  Manifest example:
    {
      "imageDir": "./imgs/anim-1/",
      "noisy": "noisy.png",
      "deterministic": "s1.png",
      "samples": [
        { "file": "s1.png" },
        { "file": "s2.png" },
        { "file": "s3.png" }
      ]
    }

  Visualized:
      start at noisy x_t on the left
      denoise rightward to x_hat = f_t(x_t)
      fade the first arrow and original noise
      renoise leftward to x_tilde_t^(i) = a_t x_hat + b_t epsilon^(i)
      denoise rightward to x^(i) = f_t(x_tilde_t^(i))
*/

(() => {
  const renoiseCanvasEl = document.getElementById("renoiseCanvas");

  if (!renoiseCanvasEl) {
    console.warn("Renoise animation skipped: #renoiseCanvas was not found.");
    return;
  }

  const renoiseCtx = renoiseCanvasEl.getContext("2d");

  const RENOISE_MANIFEST_URL = "./imgs/anim-1/imglist.json";

  const RENOISE_FALLBACK_MANIFEST = {
    "imageDir": "./imgs/anim-1/",
    "noisy": "noisy.png",
    "deterministic": "s1.png",
    "samples": [
      { "file": "s1.png", "p": 0.95 },
      { "file": "s2.png", "p": 0.51 },
      { "file": "s3.png", "p": 0.37 }
    ],
    "samples2": [
      { "file": "s2.png"},
      { "file": "s3.png"},
      { "file": "s4.png"}
    ]
  };

  const RENOISE_BLUE = "36, 87, 255";
  const RENOISE_ORANGE = "245, 124, 0";
  const RENOISE_GREEN = "25, 135, 84";
  const RENOISE_DARK = "26, 29, 33";
  const RENOISE_MUTED = "95, 100, 104";
  const RENOISE_BG = "250, 251, 253";

  const RENOISE_HEADER_MIN = 132;
  const RENOISE_HEADER_MAX = 190;
  const RENOISE_HEADER_RATIO = 0.24;
  const RENOISE_MAX_BRANCHES = 5;

  let renoiseAssets = null;
  let renoiseStartTime = null;

  function renoiseClamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function renoiseEase(value) {
    const x = renoiseClamp01(value);
    return x * x * (3 - 2 * x);
  }

  function renoiseStage(time, start, end) {
    return renoiseEase((time - start) / (end - start));
  }

  function renoiseFadeWindow(time, fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd) {
    return (
      renoiseStage(time, fadeInStart, fadeInEnd) *
      (1 - renoiseStage(time, fadeOutStart, fadeOutEnd))
    );
  }

  function renoiseRgba(rgb, alpha) {
    return `rgba(${rgb}, ${alpha})`;
  }

  function renoiseResizeCanvas() {
    const rect = renoiseCanvasEl.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;

    renoiseCanvasEl.width = Math.floor(rect.width * scale);
    renoiseCanvasEl.height = Math.floor(rect.height * scale);

    renoiseCtx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  window.addEventListener("resize", renoiseResizeCanvas);
  renoiseResizeCanvas();

  function renoiseJoinAssetPath(imageDir, fileName) {
    if (!fileName) {
      return "";
    }

    if (/^(https?:)?\/\//i.test(fileName) || fileName.startsWith("/")) {
      return fileName;
    }

    const cleanDir = imageDir.endsWith("/") ? imageDir : `${imageDir}/`;
    return `${cleanDir}${fileName}`;
  }

  function renoiseNormalizeManifest(rawManifest) {
    const manifest = rawManifest || {};
    const imageDir = manifest.imageDir || manifest.basePath || "./imgs/anim-1/";
    const rawSamples = manifest.samples2 || manifest.candidates || manifest.cleanImages || [];

    const samples = rawSamples
      .map((entry, index) => {
        const file = typeof entry === "string" ? entry : entry.file || entry.src;

        return {
          src: renoiseJoinAssetPath(imageDir, file),
          file,
          originalIndex: index,
        };
      })
      .filter((sample) => sample.src)
      .slice(0, manifest.maxSamples || RENOISE_MAX_BRANCHES);

    const deterministicFile =
      manifest.deterministic ||
      manifest.firstSample ||
      manifest.clean ||
      (samples[0] && samples[0].file) ||
      "s1.png";

    return {
      imageDir,
      noisy: {
        src: renoiseJoinAssetPath(imageDir, manifest.noisy || manifest.noisyImage || "noisy.png"),
      },
      deterministic: {
        src: renoiseJoinAssetPath(imageDir, deterministicFile),
      },
      samples:
        samples.length > 0
          ? samples
          : [
              {
                src: renoiseJoinAssetPath(imageDir, "s1.png"),
                file: "s1.png",
                originalIndex: 0,
              },
              {
                src: renoiseJoinAssetPath(imageDir, "s2.png"),
                file: "s2.png",
                originalIndex: 1,
              },
              {
                src: renoiseJoinAssetPath(imageDir, "s3.png"),
                file: "s3.png",
                originalIndex: 2,
              },
            ],
    };
  }

  async function renoiseFetchManifest() {
    try {
      const response = await fetch(RENOISE_MANIFEST_URL, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Could not load ${RENOISE_MANIFEST_URL}`);
      }

      return renoiseNormalizeManifest(await response.json());
    } catch (error) {
      console.warn(
        "Using fallback renoise animation assets. Create ./imgs/anim-1/imglist.json to override.",
        error
      );

      return renoiseNormalizeManifest(RENOISE_FALLBACK_MANIFEST);
    }
  }

  function renoiseLoadImage(src) {
    return new Promise((resolve) => {
      const image = new Image();

      image.onload = () => resolve({ image, src, ok: true });
      image.onerror = () => resolve({ image: null, src, ok: false });

      image.src = src;
    });
  }

  async function renoiseLoadAssets() {
    const manifest = await renoiseFetchManifest();

    const [noisyAsset, deterministicAsset, ...sampleAssets] = await Promise.all([
      renoiseLoadImage(manifest.noisy.src),
      renoiseLoadImage(manifest.deterministic.src),
      ...manifest.samples.map((sample) => renoiseLoadImage(sample.src)),
    ]);

    return {
      noisy: noisyAsset,
      deterministic: deterministicAsset,
      samples: manifest.samples.map((sample, index) => ({
        ...sample,
        ...sampleAssets[index],
      })),
    };
  }

  function renoiseRoundedRectPath(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);

    renoiseCtx.beginPath();
    renoiseCtx.moveTo(x + r, y);
    renoiseCtx.lineTo(x + width - r, y);
    renoiseCtx.quadraticCurveTo(x + width, y, x + width, y + r);
    renoiseCtx.lineTo(x + width, y + height - r);
    renoiseCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    renoiseCtx.lineTo(x + r, y + height);
    renoiseCtx.quadraticCurveTo(x, y + height, x, y + height - r);
    renoiseCtx.lineTo(x, y + r);
    renoiseCtx.quadraticCurveTo(x, y, x + r, y);
    renoiseCtx.closePath();
  }

  function renoiseStrokeAnimatedBox(x, y, width, height, radius, rgb, alpha, progress) {
    if (alpha <= 0 || progress <= 0) {
      return;
    }

    const perimeter = 2 * (width + height);

    renoiseCtx.save();
    renoiseRoundedRectPath(x, y, width, height, radius);
    renoiseCtx.strokeStyle = renoiseRgba(rgb, alpha);
    renoiseCtx.lineWidth = 3;
    renoiseCtx.setLineDash([perimeter * renoiseClamp01(progress), perimeter]);
    renoiseCtx.lineDashOffset = 0;
    renoiseCtx.stroke();
    renoiseCtx.restore();
  }

  function renoiseDrawImageCover(image, x, y, size) {
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const sourceAspect = sourceWidth / sourceHeight;

    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceAspect > 1) {
      sw = sourceHeight;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth;
      sy = (sourceHeight - sh) / 2;
    }

    renoiseCtx.drawImage(image, sx, sy, sw, sh, x, y, size, size);
  }

  function renoiseDrawMissingImageCard(x, y, size, label) {
    renoiseCtx.fillStyle = "rgba(245, 247, 250, 1)";
    renoiseCtx.fillRect(x, y, size, size);

    renoiseCtx.fillStyle = "rgba(95, 100, 104, 0.78)";
    renoiseCtx.font = "600 12px system-ui, sans-serif";
    renoiseCtx.textAlign = "center";
    renoiseCtx.textBaseline = "middle";

    const labelText = String(label || "missing image");
    const shortLabel = labelText.length > 22 ? `${labelText.slice(0, 19)}...` : labelText;
    renoiseCtx.fillText(shortLabel, x + size / 2, y + size / 2);
  }

  function renoiseDrawCaption(text, centerX, y, alpha) {
    if (alpha <= 0 || !text) {
      return;
    }

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;
    renoiseCtx.font = "700 13px system-ui, sans-serif";
    renoiseCtx.fillStyle = renoiseRgba(RENOISE_DARK, 0.78);
    renoiseCtx.textAlign = "center";
    renoiseCtx.textBaseline = "top";
    renoiseCtx.fillText(text, centerX, y);
    renoiseCtx.restore();
  }

  function renoiseDrawImageCard(
    asset,
    centerX,
    centerY,
    size,
    alpha,
    caption,
    accentProgress,
    accentRgb
  ) {
    if (alpha <= 0) {
      return null;
    }

    const x = centerX - size / 2;
    const y = centerY - size / 2;
    const radius = Math.min(16, size * 0.18);

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;

    renoiseCtx.shadowColor = "rgba(20, 20, 20, 0.18)";
    renoiseCtx.shadowBlur = 18;
    renoiseCtx.shadowOffsetY = 8;

    renoiseRoundedRectPath(x, y, size, size, radius);
    renoiseCtx.fillStyle = "rgba(255, 255, 255, 1)";
    renoiseCtx.fill();

    renoiseCtx.shadowColor = "transparent";
    renoiseCtx.clip();

    if (asset && asset.ok && asset.image) {
      renoiseDrawImageCover(asset.image, x, y, size);
    } else {
      renoiseDrawMissingImageCard(x, y, size, asset ? asset.src : "missing image");
    }

    renoiseCtx.restore();

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;
    renoiseRoundedRectPath(x, y, size, size, radius);
    renoiseCtx.strokeStyle = "rgba(255, 255, 255, 0.96)";
    renoiseCtx.lineWidth = 4;
    renoiseCtx.stroke();

    if (caption) {
      renoiseDrawCaption(caption, centerX, y + size + 10, alpha);
    }

    renoiseCtx.restore();

    renoiseStrokeAnimatedBox(
      x - 5,
      y - 5,
      size + 10,
      size + 10,
      radius + 5,
      accentRgb || RENOISE_BLUE,
      alpha * 0.95,
      accentProgress || 0
    );

    return { x, y, size, centerX, centerY };
  }

  function renoiseDrawArrow(startX, startY, endX, endY, progress, options = {}) {
    const alpha = options.alpha ?? 1;
    const rgb = options.rgb || RENOISE_DARK;
    const lineWidth = options.lineWidth || 3;
    const headLength = options.headLength || 12;

    if (alpha <= 0 || progress <= 0) {
      return;
    }

    const p = renoiseClamp01(progress);
    const currentX = startX + (endX - startX) * p;
    const currentY = startY + (endY - startY) * p;
    const angle = Math.atan2(endY - startY, endX - startX);

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;

    renoiseCtx.beginPath();
    renoiseCtx.moveTo(startX, startY);
    renoiseCtx.lineTo(currentX, currentY);
    renoiseCtx.strokeStyle = renoiseRgba(rgb, 0.88);
    renoiseCtx.lineWidth = lineWidth;
    renoiseCtx.lineCap = "round";
    renoiseCtx.stroke();

    if (p > 0.08) {
      renoiseCtx.beginPath();
      renoiseCtx.moveTo(currentX, currentY);
      renoiseCtx.lineTo(
        currentX - headLength * Math.cos(angle - Math.PI / 6),
        currentY - headLength * Math.sin(angle - Math.PI / 6)
      );
      renoiseCtx.lineTo(
        currentX - headLength * Math.cos(angle + Math.PI / 6),
        currentY - headLength * Math.sin(angle + Math.PI / 6)
      );
      renoiseCtx.closePath();
      renoiseCtx.fillStyle = renoiseRgba(rgb, 0.88);
      renoiseCtx.fill();
    }

    if (options.label && p > 0.55) {
      const labelAlpha = alpha * renoiseClamp01((p - 0.55) / 0.45);
      const labelX = startX + (endX - startX) * (options.labelT ?? 0.5);
      const labelY =
        startY + (endY - startY) * (options.labelT ?? 0.5) + (options.labelDy ?? -14);

      renoiseCtx.globalAlpha = labelAlpha;
      renoiseCtx.font = "700 12px system-ui, sans-serif";
      renoiseCtx.textAlign = "center";
      renoiseCtx.textBaseline = "middle";

      const textWidth = renoiseCtx.measureText(options.label).width;
      renoiseRoundedRectPath(labelX - textWidth / 2 - 8, labelY - 12, textWidth + 16, 24, 12);
      renoiseCtx.fillStyle = "rgba(255, 255, 255, 0.92)";
      renoiseCtx.fill();

      renoiseCtx.fillStyle = renoiseRgba(rgb, 0.94);
      renoiseCtx.fillText(options.label, labelX, labelY);
    }

    renoiseCtx.restore();
  }

  function renoiseMathTokenWidth(token, baseFont, romanFont, scriptFont) {
    renoiseCtx.font = token.kind === "sub" || token.kind === "sup"
      ? scriptFont
      : token.italic === false
        ? romanFont
        : baseFont;

    return renoiseCtx.measureText(token.text).width;
  }

  function renoiseDrawMathTokens(tokens, centerX, baselineY, alpha, options = {}) {
    if (alpha <= 0) {
      return;
    }

    const baseSize = options.baseSize || 20;
    const scriptSize = options.scriptSize || Math.round(baseSize * 0.62);
    const color = options.color || RENOISE_DARK;

    const baseFont = `italic ${baseSize}px Georgia, "Times New Roman", serif`;
    const romanFont = `${baseSize}px Georgia, "Times New Roman", serif`;
    const scriptFont = `${scriptSize}px Georgia, "Times New Roman", serif`;

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;

    const totalWidth = tokens.reduce((sum, token) => {
      return sum + renoiseMathTokenWidth(token, baseFont, romanFont, scriptFont);
    }, 0);

    let x = centerX - totalWidth / 2;

    tokens.forEach((token) => {
      const isScript = token.kind === "sub" || token.kind === "sup";
      const font = isScript ? scriptFont : token.italic === false ? romanFont : baseFont;
      const y =
        token.kind === "sub"
          ? baselineY + baseSize * 0.32
          : token.kind === "sup"
            ? baselineY - baseSize * 0.48
            : baselineY;

      renoiseCtx.font = font;
      renoiseCtx.fillStyle = renoiseRgba(color, token.alpha ?? 0.95);
      renoiseCtx.textAlign = "left";
      renoiseCtx.textBaseline = "alphabetic";
      renoiseCtx.fillText(token.text, x, y);

      x += renoiseCtx.measureText(token.text).width;
    });

    renoiseCtx.restore();
  }

  function renoiseMathHatExpression() {
    return [
      { text: "x̂" },
      { text: " = ", italic: false },
      { text: "f" },
      { text: "t", kind: "sub" },
      { text: "(", italic: false },
      { text: "x" },
      { text: "t", kind: "sub" },
      { text: ")", italic: false },
    ];
  }

  function renoiseMathRenoiseExpression() {
    return [
      { text: "x̃" },
      { text: "t", kind: "sub" },
      { text: "(i)", kind: "sup" },
      { text: " = ", italic: false },
      { text: "a" },
      { text: "t", kind: "sub" },
      { text: "x̂" },
      { text: " + ", italic: false },
      { text: "b" },
      { text: "t", kind: "sub" },
      { text: "ε" },
      { text: "(i)", kind: "sup" },
    ];
  }

  function renoiseMathFinalExpression() {
    return [
      { text: "x" },
      { text: "(i)", kind: "sup" },
      { text: " = ", italic: false },
      { text: "f" },
      { text: "t", kind: "sub" },
      { text: "(", italic: false },
      { text: "x̃" },
      { text: "t", kind: "sub" },
      { text: "(i)", kind: "sup" },
      { text: ")", italic: false },
    ];
  }

  function renoiseDrawMathCard(width, headerHeight, alpha) {
    if (alpha <= 0) {
      return;
    }

    const cardWidth = Math.min(width * 0.86, 760);
    const cardHeight = 82;
    const cardX = width / 2 - cardWidth / 2;
    const cardY = Math.max(48, Math.min(headerHeight - cardHeight - 10, 62));

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;

    renoiseCtx.shadowColor = "rgba(20, 20, 20, 0.12)";
    renoiseCtx.shadowBlur = 18;
    renoiseCtx.shadowOffsetY = 8;

    renoiseRoundedRectPath(cardX, cardY, cardWidth, cardHeight, 18);
    renoiseCtx.fillStyle = "rgba(255, 255, 255, 0.95)";
    renoiseCtx.fill();

    renoiseCtx.shadowColor = "transparent";

    const third = cardWidth / 3;
    const y = cardY + 39;

    renoiseDrawMathTokens(renoiseMathHatExpression(), cardX + third * 0.5, y, alpha, {
      baseSize: width < 640 ? 15 : 18,
      color: RENOISE_DARK,
    });

    renoiseDrawMathTokens(renoiseMathRenoiseExpression(), cardX + third * 1.5, y, alpha, {
      baseSize: width < 640 ? 15 : 18,
      color: RENOISE_DARK,
    });

    renoiseDrawMathTokens(renoiseMathFinalExpression(), cardX + third * 2.5, y, alpha, {
      baseSize: width < 640 ? 15 : 18,
      color: RENOISE_DARK,
    });

    renoiseCtx.font = "800 18px Georgia, serif";
    renoiseCtx.textAlign = "center";
    renoiseCtx.textBaseline = "middle";
    renoiseCtx.fillStyle = renoiseRgba(RENOISE_MUTED, 0.72);
    renoiseCtx.fillText("→", cardX + third, y - 2);
    renoiseCtx.fillText("→", cardX + third * 2, y - 2);

    renoiseCtx.font = "700 12px system-ui, sans-serif";
    renoiseCtx.fillStyle = renoiseRgba(RENOISE_MUTED, 0.78);
    renoiseCtx.fillText("denoise, renoise, denoise", width / 2, cardY + 64);

    renoiseCtx.restore();
  }

  function renoiseDrawHeader(width, headerHeight, alpha) {
    renoiseCtx.save();
    renoiseCtx.fillStyle = renoiseRgba(RENOISE_BG, 1);
    renoiseCtx.fillRect(0, 0, width, headerHeight);

    renoiseCtx.font = "800 15px system-ui, sans-serif";
    renoiseCtx.fillStyle = renoiseRgba(RENOISE_MUTED, 0.9);
    renoiseCtx.textAlign = "left";
    renoiseCtx.textBaseline = "top";
    renoiseCtx.fillText("Fast Sampling with Renoising", 26, 24);

    renoiseCtx.beginPath();
    renoiseCtx.moveTo(24, headerHeight - 1);
    renoiseCtx.lineTo(width - 24, headerHeight - 1);
    renoiseCtx.strokeStyle = "rgba(26, 29, 33, 0.08)";
    renoiseCtx.lineWidth = 1;
    renoiseCtx.stroke();

    renoiseCtx.restore();

    renoiseDrawMathCard(width, headerHeight, alpha);
  }

  function renoiseHeaderHeight(height) {
    return Math.min(
      RENOISE_HEADER_MAX,
      Math.max(RENOISE_HEADER_MIN, height * RENOISE_HEADER_RATIO)
    );
  }

  function renoiseComputeLayout(width, height, samples) {
    const headerHeight = renoiseHeaderHeight(height);
    const axisY = headerHeight + 38;
    const contentTop = headerHeight + 72;
    const contentBottom = height - 58;
    const contentHeight = Math.max(160, contentBottom - contentTop);
    const centerY = (contentTop + contentBottom) / 2;

    const branchCount = Math.max(1, Math.min(RENOISE_MAX_BRANCHES, samples.length));
    const branchGap = Math.max(24, Math.min(46, height * 0.055));

    let branchSize = Math.min(82, Math.max(48, width * 0.102));

    if (branchCount > 1) {
      const maxBranchSize = (contentHeight - (branchCount - 1) * branchGap - 18) / branchCount;
      branchSize = Math.min(branchSize, Math.max(42, maxBranchSize));
    }

    const mainSize = Math.min(124, Math.max(76, width * 0.15, branchSize * 1.25));
    const deterministicSize = Math.min(130, Math.max(82, width * 0.155, branchSize * 1.28));

    const noiseX = width * 0.15;
    const renoiseX = width * 0.34;
    const deterministicX = width * 0.70;
    const finalX = width * 0.88;

    const branchYs = Array.from({ length: branchCount }, (_, index) => {
      if (branchCount === 1) {
        return centerY;
      }

      const groupHeight = branchCount * branchSize + (branchCount - 1) * branchGap;
      return centerY - groupHeight / 2 + branchSize / 2 + index * (branchSize + branchGap);
    });

    return {
      headerHeight,
      axisY,
      contentTop,
      contentBottom,
      centerY,
      branchCount,
      branchSize,
      mainSize,
      deterministicSize,
      noiseColumnX: noiseX,
      renoiseColumnX: renoiseX,
      deterministicColumnX: deterministicX,
      finalColumnX: finalX,
      initial: { x: noiseX, y: centerY },
      deterministic: { x: deterministicX, y: centerY },
      branches: branchYs.map((y, index) => ({
        noiseX: renoiseX,
        finalX,
        y,
        sample: samples[index % samples.length],
        index,
      })),
    };
  }

  function renoiseDrawTimeAxis(layout, width, alpha) {
    if (alpha <= 0) {
      return;
    }

    const left = Math.max(32, layout.noiseColumnX - 56);
    const right = Math.min(width - 32, layout.finalColumnX + 54);
    const y = layout.axisY;

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;

    renoiseCtx.beginPath();
    renoiseCtx.moveTo(left, y);
    renoiseCtx.lineTo(right, y);
    renoiseCtx.strokeStyle = renoiseRgba(RENOISE_DARK, 0.16);
    renoiseCtx.lineWidth = 2;
    renoiseCtx.lineCap = "round";
    renoiseCtx.stroke();

    renoiseCtx.beginPath();
    renoiseCtx.moveTo(right, y);
    renoiseCtx.lineTo(right - 12, y - 6);
    renoiseCtx.lineTo(right - 12, y + 6);
    renoiseCtx.closePath();
    renoiseCtx.fillStyle = renoiseRgba(RENOISE_DARK, 0.18);
    renoiseCtx.fill();

    const guideXs = [
      layout.noiseColumnX,
      layout.renoiseColumnX,
      layout.deterministicColumnX,
      layout.finalColumnX,
    ];

    guideXs.forEach((x) => {
      renoiseCtx.beginPath();
      renoiseCtx.moveTo(x, y + 10);
      renoiseCtx.lineTo(x, layout.contentBottom + 16);
      renoiseCtx.strokeStyle = renoiseRgba(RENOISE_DARK, 0.07);
      renoiseCtx.lineWidth = 1;
      renoiseCtx.setLineDash([5, 7]);
      renoiseCtx.stroke();
      renoiseCtx.setLineDash([]);
    });

    renoiseCtx.font = "800 12px system-ui, sans-serif";
    renoiseCtx.textAlign = "center";
    renoiseCtx.textBaseline = "middle";

    renoiseCtx.fillStyle = renoiseRgba(RENOISE_BLUE, 0.88);
    renoiseCtx.fillText("pure noise", layout.noiseColumnX, y - 18);

    renoiseCtx.fillStyle = renoiseRgba(RENOISE_ORANGE, 0.88);
    renoiseCtx.fillText("more noise", layout.renoiseColumnX, y - 18);

    renoiseCtx.fillStyle = renoiseRgba(RENOISE_GREEN, 0.88);
    renoiseCtx.fillText("data", layout.finalColumnX, y - 18);

    renoiseCtx.fillStyle = renoiseRgba(RENOISE_MUTED, 0.8);
    renoiseCtx.font = "700 11px system-ui, sans-serif";
    renoiseCtx.fillText("denoising direction", (left + right) / 2, y + 20);

    renoiseCtx.restore();
  }

  function renoiseDrawSmallMathLabel(tokens, centerX, centerY, alpha, rgb) {
    if (alpha <= 0) {
      return;
    }

    renoiseCtx.save();
    renoiseCtx.globalAlpha = alpha;

    const boxWidth = 154;
    const boxHeight = 30;

    renoiseRoundedRectPath(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, 15);
    renoiseCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
    renoiseCtx.fill();

    renoiseCtx.restore();

    renoiseDrawMathTokens(tokens, centerX, centerY + 6, alpha, {
      baseSize: 15,
      color: rgb || RENOISE_DARK,
    });
  }

  function renoiseDrawScene(time) {
    const rect = renoiseCanvasEl.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    renoiseCtx.clearRect(0, 0, width, height);
    renoiseCtx.fillStyle = renoiseRgba(RENOISE_BG, 1);
    renoiseCtx.fillRect(0, 0, width, height);

    const headerAlpha = renoiseStage(time, 0.0, 1.2);
    const axisAlpha = renoiseStage(time, 0.0, 1.2);

    const originalNoiseAlpha = renoiseFadeWindow(time, 0.4, 1.8, 5.8, 7.2);

    const firstArrowProgress = renoiseStage(time, 2.0, 4.0);
    const firstArrowAlpha = firstArrowProgress * (1 - renoiseStage(time, 5.8, 7.2));

    const deterministicAlpha = renoiseStage(time, 2.6, 4.2);
    const deterministicDim = 1 - 0.45 * renoiseStage(time, 13.6, 15.8);
    const deterministicVisibleAlpha = deterministicAlpha * deterministicDim;

    const deterministicBoxProgress = renoiseStage(time, 3.0, 4.6);

    const renoiseArrowProgress = renoiseStage(time, 7.5, 9.6);
    const renoiseArrowAlpha =
      renoiseArrowProgress * (1 - 0.72 * renoiseStage(time, 11.6, 13.0));

    const branchNoiseAlpha = renoiseStage(time, 8.0, 10.0);
    const branchNoiseBoxProgress = renoiseStage(time, 8.6, 10.2);

    const finalArrowProgress = renoiseStage(time, 13.6, 15.8);
    const finalSampleAlpha = renoiseStage(time, 14.0, 16.0);
    const finalBoxProgress = renoiseStage(time, 15.6, 17.0);

    const branchLabelAlpha =
      renoiseStage(time, 9.8, 11.2) * (1 - 0.35 * renoiseStage(time, 13.6, 15.0));

    const finalLabelAlpha = renoiseStage(time, 16.0, 17.2);

    const samples =
      renoiseAssets.samples.length > 0 ? renoiseAssets.samples : [renoiseAssets.deterministic];

    const layout = renoiseComputeLayout(width, height, samples);

    renoiseDrawHeader(width, layout.headerHeight, headerAlpha);
    renoiseDrawTimeAxis(layout, width, axisAlpha);

    const initialNoiseRect = renoiseDrawImageCard(
      renoiseAssets.noisy,
      layout.initial.x,
      layout.initial.y,
      layout.mainSize,
      originalNoiseAlpha,
      "Initial noise",
      0,
      RENOISE_BLUE
    );

    const deterministicRect = renoiseDrawImageCard(
      renoiseAssets.deterministic,
      layout.deterministic.x,
      layout.deterministic.y,
      layout.deterministicSize,
      deterministicVisibleAlpha,
      "Deterministic sample",
      deterministicBoxProgress,
      RENOISE_GREEN
    );

    if (initialNoiseRect && deterministicRect) {
      renoiseDrawArrow(
        initialNoiseRect.x + initialNoiseRect.size + 12,
        initialNoiseRect.centerY,
        deterministicRect.x - 18,
        deterministicRect.centerY,
        firstArrowProgress,
        {
          alpha: firstArrowAlpha,
          rgb: RENOISE_GREEN,
          lineWidth: 4,
          headLength: 13,
          label: "denoise",
          labelDy: -26,
          labelT: 0.5,
        }
      );
    }

    if (deterministicRect) {
      renoiseDrawSmallMathLabel(
        renoiseMathHatExpression(),
        deterministicRect.centerX,
        deterministicRect.y - 24,
        renoiseStage(time, 4.0, 5.0) * deterministicDim,
        RENOISE_GREEN
      );
    }

    const branchNoiseRects = [];
    const finalRects = [];
    const middleBranchIndex = Math.floor(layout.branches.length / 2);

    layout.branches.forEach((branch) => {
      const isMiddleBranch = branch.index === middleBranchIndex;

      if (deterministicRect) {
        renoiseDrawArrow(
          deterministicRect.x - 16,
          deterministicRect.centerY,
          branch.noiseX + layout.branchSize / 2 + 14,
          branch.y,
          renoiseArrowProgress,
          {
            alpha: 0.62 * renoiseArrowAlpha * deterministicAlpha,
            rgb: RENOISE_ORANGE,
            lineWidth: 2.7,
            headLength: 10,
            label: isMiddleBranch ? "add noise" : "",
            labelDy: isMiddleBranch ? -22 : -14,
            labelT: 0.52,
          }
        );
      }

      const branchNoiseRect = renoiseDrawImageCard(
        renoiseAssets.noisy,
        branch.noiseX,
        branch.y,
        layout.branchSize,
        branchNoiseAlpha,
        isMiddleBranch ? "Renoised states" : "",
        branchNoiseBoxProgress,
        RENOISE_ORANGE
      );

      if (branchNoiseRect) {
        branchNoiseRects.push(branchNoiseRect);
      }

      const finalRect = renoiseDrawImageCard(
        branch.sample,
        branch.finalX,
        branch.y,
        layout.branchSize,
        finalSampleAlpha,
        isMiddleBranch ? "Final samples" : "",
        finalBoxProgress,
        RENOISE_GREEN
      );

      if (finalRect) {
        finalRects.push(finalRect);
      }

      if (branchNoiseRect) {
        renoiseDrawArrow(
          branchNoiseRect.x + branchNoiseRect.size + 12,
          branchNoiseRect.centerY,
          branch.finalX - layout.branchSize / 2 - 16,
          branch.y,
          finalArrowProgress,
          {
            alpha: 0.78 * finalArrowProgress,
            rgb: RENOISE_GREEN,
            lineWidth: 2.9,
            headLength: 10,
            label: isMiddleBranch ? "denoise" : "",
            labelDy: 24,
            labelT: 0.5,
          }
        );
      }
    });

    if (branchNoiseRects.length > 0) {
      const middleNoiseRect = branchNoiseRects[Math.floor(branchNoiseRects.length / 2)];
      renoiseDrawSmallMathLabel(
        renoiseMathRenoiseExpression(),
        middleNoiseRect.centerX,
        middleNoiseRect.y - 24,
        branchLabelAlpha,
        RENOISE_ORANGE
      );
    }

    if (finalRects.length > 0) {
      const middleFinalRect = finalRects[Math.floor(finalRects.length / 2)];
      renoiseDrawSmallMathLabel(
        renoiseMathFinalExpression(),
        middleFinalRect.centerX,
        middleFinalRect.y - 24,
        finalLabelAlpha,
        RENOISE_GREEN
      );
    }
  }

  function renoiseAnimationLoop(timestamp) {
    if (!renoiseStartTime) {
      renoiseStartTime = timestamp;
    }

    const seconds = ((timestamp - renoiseStartTime) / 1000) % 21.5;

    renoiseDrawScene(seconds);
    requestAnimationFrame(renoiseAnimationLoop);
  }

  (async function startRenoiseAnimation() {
    renoiseAssets = await renoiseLoadAssets();
    requestAnimationFrame(renoiseAnimationLoop);
  })();
})();