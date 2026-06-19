const fadeElements = document.querySelectorAll(".fade-in");

const fadeObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
      }
    });
  },
  {
    threshold: 0.15,
  }
);

fadeElements.forEach((element) => {
  fadeObserver.observe(element);
});

const copyButton = document.getElementById("copyBibtex");
const bibtexCode = document.getElementById("bibtexCode");

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(bibtexCode.innerText);
    copyButton.innerText = "Copied";

    setTimeout(() => {
      copyButton.innerText = "Copy";
    }, 1600);
  } catch (error) {
    copyButton.innerText = "Failed";

    setTimeout(() => {
      copyButton.innerText = "Copy";
    }, 1600);
  }
});

/*
  Gradient-free CBG estimator animation.

  Expected files with the manifest below:
    ./imgs/anim-1/imglist.json
    ./imgs/anim-1/noisy.png
    ./imgs/anim-1/s1.png, s2.png, ...
    ./imgs/anim-1/equation.png
    ./imgs/anim-1/equation_boxes.json

  Manifest example:
    {
      "imageDir": "./imgs/anim-1/",
      "noisy": "noisy.png",
      "equation": "equation.png",
      "equationBoxes": "equation_boxes.json",
      "samples": [
        { "file": "s1.png", "p": 0.95 },
        { "file": "s2.png", "p": 0.51 },
        { "file": "s3.png", "p": 0.37 }
      ]
    }

  The equation/equationBoxes fields are optional. If omitted, this file looks for
  equation.png and equation_boxes.json inside imageDir.
*/

const canvas = document.getElementById("estimatorCanvas");
const ctx = canvas.getContext("2d");

const CBG_MANIFEST_URL = "./imgs/anim-1/imglist.json";

const CBG_FALLBACK_ASSETS = {};

const BLUE = "36, 87, 255";
const ORANGE = "245, 124, 0";
const DARK = "26, 29, 33";
const MUTED = "95, 100, 104";
const AVERAGE = "35, 38, 42";

const HEADER_MIN_HEIGHT = 150;
const HEADER_MAX_HEIGHT = 205;
const HEADER_RATIO = 0.27;
const MIN_CANDIDATE_GAP = 48;
const MAX_CANDIDATE_GAP = 66;
const MAX_CANDIDATE_SCALE = 1.28;

let animationAssets = null;
let animationStartTime = null;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function ease(value) {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

function stage(time, start, end) {
  return ease((time - start) / (end - start));
}

function rgba(rgb, alpha) {
  return `rgba(${rgb}, ${alpha})`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * scale);
  canvas.height = Math.floor(rect.height * scale);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function parseProbabilityFromFilename(fileName) {
  const match = String(fileName).match(/(?:^|[-_])p(?:rob)?([01](?:\.\d+)?)(?=[-_.]|$)/i);
  return match ? Number.parseFloat(match[1]) : null;
}

function joinAssetPath(imageDir, fileName) {
  if (!fileName) {
    return "";
  }

  if (/^(https?:)?\/\//i.test(fileName) || fileName.startsWith("/")) {
    return fileName;
  }

  const cleanDir = imageDir.endsWith("/") ? imageDir : `${imageDir}/`;
  return `${cleanDir}${fileName}`;
}

function normalizeManifest(rawManifest) {
  const manifest = rawManifest || {};
  const imageDir = manifest.imageDir || manifest.basePath || "./imgs/anim-1/";

  const rawSamples = manifest.samples || manifest.candidates || manifest.cleanImages || [];

  const samples = rawSamples
    .map((entry, index) => {
      const file = typeof entry === "string" ? entry : entry.file || entry.src;
      const parsedP = parseProbabilityFromFilename(file);

      const p =
        typeof entry === "object" && entry.p !== undefined
          ? Number(entry.p)
          : typeof entry === "object" && entry.probability !== undefined
            ? Number(entry.probability)
            : parsedP;

      return {
        src: joinAssetPath(imageDir, file),
        file,
        p: Number.isFinite(p) ? p : 0.5,
        originalIndex: index,
      };
    })
    .sort((a, b) => b.p - a.p)
    .slice(0, manifest.maxSamples || 6);

  const equationFile = manifest.equation || manifest.equationImage || "equation.png";
  const equationBoxesFile = manifest.equationBoxes || manifest.equationBoxFile || "equation_boxes.json";

  return {
    imageDir,
    noisy: {
      src: joinAssetPath(imageDir, manifest.noisy || manifest.noisyImage),
    },
    equation: {
      src: joinAssetPath(imageDir, equationFile),
    },
    equationBoxes: {
      src: joinAssetPath(imageDir, equationBoxesFile),
    },
    samples,
  };
}

async function fetchManifest() {
  try {
    const response = await fetch(CBG_MANIFEST_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Could not load ${CBG_MANIFEST_URL}`);
    }

    return normalizeManifest(await response.json());
  } catch (error) {
    console.warn(
      "Using fallback CBG animation assets. Create ./imgs/anim-1/imglist.json to override.",
      error
    );

    return normalizeManifest(CBG_FALLBACK_ASSETS);
  }
}

async function fetchJsonOptional(src, fallback) {
  if (!src) {
    return fallback;
  }

  try {
    const response = await fetch(src, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Could not load ${src}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`Optional JSON asset not loaded: ${src}`, error);
    return fallback;
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => resolve({ image, src, ok: true });
    image.onerror = () => resolve({ image: null, src, ok: false });

    image.src = src;
  });
}

async function loadAssets() {
  const manifest = await fetchManifest();

  const [noisy, equation, equationBoxes, ...samples] = await Promise.all([
    loadImage(manifest.noisy.src),
    loadImage(manifest.equation.src),
    fetchJsonOptional(manifest.equationBoxes.src, { boxes: [] }),
    ...manifest.samples.map((sample) => loadImage(sample.src)),
  ]);

  return {
    noisy,
    equation,
    equationBoxes: normalizeEquationBoxes(equationBoxes),
    samples: manifest.samples.map((sample, index) => ({
      ...sample,
      ...samples[index],
    })),
  };
}

function normalizeEquationBoxes(rawBoxes) {
  const boxes = Array.isArray(rawBoxes) ? rawBoxes : rawBoxes && Array.isArray(rawBoxes.boxes) ? rawBoxes.boxes : [];

  return boxes
    .map((box) => ({
      label: String(box.label || box.name || ""),
      color: String(box.color || box.kind || "blue").toLowerCase(),
      x: Number(box.x),
      y: Number(box.y),
      w: Number(box.w !== undefined ? box.w : box.width),
      h: Number(box.h !== undefined ? box.h : box.height),
      pad: Number(box.pad !== undefined ? box.pad : 4),
    }))
    .filter((box) => Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.w) && Number.isFinite(box.h) && box.w > 0 && box.h > 0);
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function strokeAnimatedBox(x, y, width, height, radius, rgb, alpha, progress) {
  if (alpha <= 0 || progress <= 0) {
    return;
  }

  const perimeter = 2 * (width + height);

  ctx.save();
  roundedRectPath(x, y, width, height, radius);
  ctx.strokeStyle = rgba(rgb, alpha);
  ctx.lineWidth = 3;
  ctx.setLineDash([perimeter * clamp01(progress), perimeter]);
  ctx.lineDashOffset = 0;
  ctx.stroke();
  ctx.restore();
}

function drawImageCover(image, x, y, size) {
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

  ctx.drawImage(image, sx, sy, sw, sh, x, y, size, size);
}

function drawMissingImageCard(x, y, size, label) {
  ctx.fillStyle = "rgba(245, 247, 250, 1)";
  ctx.fillRect(x, y, size, size);

  ctx.fillStyle = "rgba(95, 100, 104, 0.78)";
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const shortLabel = label.length > 22 ? `${label.slice(0, 19)}...` : label;
  ctx.fillText(shortLabel, x + size / 2, y + size / 2);
}

function drawImageCard(asset, centerX, centerY, size, alpha, caption, orangeProgress) {
  if (alpha <= 0) {
    return null;
  }

  const x = centerX - size / 2;
  const y = centerY - size / 2;
  const radius = 16;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.shadowColor = "rgba(20, 20, 20, 0.18)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;

  roundedRectPath(x, y, size, size, radius);
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.clip();

  if (asset && asset.ok && asset.image) {
    drawImageCover(asset.image, x, y, size);
  } else {
    drawMissingImageCard(x, y, size, asset ? asset.src : "missing image");
  }

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  roundedRectPath(x, y, size, size, radius);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.lineWidth = 4;
  ctx.stroke();

  if (caption) {
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.fillStyle = rgba(DARK, 0.78);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(caption, centerX, y + size + 10);
  }

  ctx.restore();

  strokeAnimatedBox(
    x - 5,
    y - 5,
    size + 10,
    size + 10,
    radius + 5,
    ORANGE,
    alpha * 0.95,
    orangeProgress
  );

  return { x, y, size, centerX, centerY };
}

function drawArrow(startX, startY, endX, endY, progress, options = {}) {
  const alpha = options.alpha ?? 1;
  const rgb = options.rgb || DARK;
  const lineWidth = options.lineWidth || 3;
  const headLength = options.headLength || 12;

  if (alpha <= 0 || progress <= 0) {
    return;
  }

  const p = clamp01(progress);
  const currentX = startX + (endX - startX) * p;
  const currentY = startY + (endY - startY) * p;
  const angle = Math.atan2(endY - startY, endX - startX);

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(currentX, currentY);
  ctx.strokeStyle = rgba(rgb, 0.88);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  if (p > 0.08) {
    ctx.beginPath();
    ctx.moveTo(currentX, currentY);
    ctx.lineTo(
      currentX - headLength * Math.cos(angle - Math.PI / 6),
      currentY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      currentX - headLength * Math.cos(angle + Math.PI / 6),
      currentY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = rgba(rgb, 0.88);
    ctx.fill();
  }

  if (options.label && p > 0.55) {
    const labelAlpha = alpha * clamp01((p - 0.55) / 0.45);
    const labelX = startX + (endX - startX) * (options.labelT ?? 0.5);
    const labelY = startY + (endY - startY) * (options.labelT ?? 0.5) + (options.labelDy ?? -14);

    ctx.globalAlpha = labelAlpha;
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const textWidth = ctx.measureText(options.label).width;
    roundedRectPath(labelX - textWidth / 2 - 8, labelY - 12, textWidth + 16, 24, 12);
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fill();

    ctx.fillStyle = rgba(rgb, 0.94);
    ctx.fillText(options.label, labelX, labelY);
  }

  ctx.restore();
}

function formatProbability(p) {
  return Number(p)
    .toFixed(2)
    .replace(/0$/, "")
    .replace(/\.0$/, "");
}

function computeHeaderHeight(height) {
  return Math.min(HEADER_MAX_HEIGHT, Math.max(HEADER_MIN_HEIGHT, height * HEADER_RATIO));
}

function computeLayout(width, height, samples) {
  const headerHeight = computeHeaderHeight(height);
  const contentTop = headerHeight + 24;
  const contentBottom = height - 58;
  const contentHeight = Math.max(160, contentBottom - contentTop);

  const n = Math.max(1, samples.length);
  const candidateGap = Math.max(MIN_CANDIDATE_GAP, Math.min(MAX_CANDIDATE_GAP, height * 0.075));

  let candidateBaseSize = Math.min(108, Math.max(70, width * 0.16));

  if (n > 1) {
    const labelClearance = 38;
    const maxBaseThatFits = (contentHeight - labelClearance - (n - 1) * candidateGap) / (n * MAX_CANDIDATE_SCALE);
    candidateBaseSize = Math.min(candidateBaseSize, Math.max(48, maxBaseThatFits));
  }

  candidateBaseSize = Math.max(48, candidateBaseSize);

  const maxCandidateSize = candidateBaseSize * MAX_CANDIDATE_SCALE;
  const noisyDesired = Math.min(145, Math.max(96, width * 0.21, candidateBaseSize * 1.2));
  const noisyCardSize = Math.min(noisyDesired, Math.max(80, contentHeight * 0.72));

  const noisyX = Math.max(42 + noisyCardSize / 2, width * 0.24);
  const candidateX = Math.min(
    width - 42 - maxCandidateSize / 2,
    Math.max(width * 0.72, noisyX + noisyCardSize / 2 + maxCandidateSize / 2 + 115)
  );

  const contentCenterY = (contentTop + contentBottom) / 2;
  const noisyY = contentCenterY;

  const candidateYs = samples.map((_, index) => {
    if (n === 1) {
      return contentCenterY;
    }

    const step = maxCandidateSize + candidateGap;
    const groupHeight = maxCandidateSize + (n - 1) * step + 38;
    let firstY = contentCenterY - groupHeight / 2 + maxCandidateSize / 2;
    firstY = Math.max(firstY, contentTop + maxCandidateSize / 2);
    return firstY + index * step;
  });

  return {
    headerHeight,
    contentTop,
    contentBottom,
    candidateGap,
    maxCandidateSize,
    noisyCardSize,
    candidateBaseSize,
    noisy: { x: noisyX, y: noisyY },
    candidates: samples.map((sample, index) => ({
      x: candidateX,
      y: candidateYs[index],
      sample,
    })),
  };
}

function drawProbabilityLabel(text, centerX, y, alpha, blueProgress) {
  if (alpha <= 0) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const width = ctx.measureText(text).width;
  const boxX = centerX - width / 2 - 8;
  const boxY = y - 17;
  const boxW = width + 16;
  const boxH = 24;

  roundedRectPath(boxX, boxY, boxW, boxH, 12);
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.fill();

  ctx.fillStyle = rgba(DARK, 0.85);
  ctx.fillText(text, centerX, y);

  ctx.restore();

  strokeAnimatedBox(boxX, boxY, boxW, boxH, 12, BLUE, alpha * 0.98, blueProgress);
}

function drawHeader(width, height, formulaAlpha, blueProgress, orangeProgress, headerHeight) {
  ctx.save();
  ctx.fillStyle = "rgba(250, 251, 253, 1)";
  ctx.fillRect(0, 0, width, headerHeight);

  ctx.font = "800 15px system-ui, sans-serif";
  ctx.fillStyle = rgba(MUTED, 0.9);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Gradient-free CBG estimator", 26, 24);

  ctx.beginPath();
  ctx.moveTo(24, headerHeight - 1);
  ctx.lineTo(width - 24, headerHeight - 1);
  ctx.strokeStyle = "rgba(26, 29, 33, 0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  drawEquationImageFormula(width, headerHeight, formulaAlpha, blueProgress, orangeProgress);
}

function drawEquationImageFormula(width, headerHeight, alpha, blueProgress, orangeProgress) {
  if (alpha <= 0) {
    return;
  }

  const equation = animationAssets && animationAssets.equation;
  const image = equation && equation.ok ? equation.image : null;

  const naturalWidth = image ? image.naturalWidth : 318;
  const naturalHeight = image ? image.naturalHeight : 82;

  const maxImageWidth = Math.min(width * 0.78, 620);
  const maxImageHeight = Math.max(48, headerHeight - 78);
  const imageScale = Math.min(maxImageWidth / naturalWidth, maxImageHeight / naturalHeight, 1.7);
  const imageWidth = naturalWidth * imageScale;
  const imageHeight = naturalHeight * imageScale;

  const cardWidth = imageWidth + 36;
  const cardHeight = imageHeight + 28;
  const cardX = width / 2 - cardWidth / 2;
  const cardY = Math.max(48, Math.min(headerHeight - cardHeight - 10, 58));
  const imageX = cardX + 18;
  const imageY = cardY + 14;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(20, 20, 20, 0.12)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;

  roundedRectPath(cardX, cardY, cardWidth, cardHeight, 18);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();

  ctx.shadowColor = "transparent";

  if (image) {
    ctx.drawImage(image, imageX, imageY, imageWidth, imageHeight);
  } else {
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.fillStyle = rgba(MUTED, 0.8);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("equation.png", imageX + imageWidth / 2, imageY + imageHeight / 2);
  }

  ctx.restore();

  const boxes = (animationAssets && animationAssets.equationBoxes) || [];
  boxes.forEach((box) => {
    const color = box.color === "orange" ? ORANGE : box.color === "gray" ? MUTED : BLUE;
    const progress = box.color === "orange" ? orangeProgress : blueProgress;
    const pad = Number.isFinite(box.pad) ? box.pad : 4;

    strokeAnimatedBox(
      imageX + box.x * imageScale - pad,
      imageY + box.y * imageScale - pad,
      box.w * imageScale + pad * 2,
      box.h * imageScale + pad * 2,
      8,
      color,
      alpha * 0.98,
      progress
    );
  });
}

function computeWeightedAveragePoint(candidateRects) {
  if (candidateRects.length === 0) {
    return null;
  }

  const weights = candidateRects.map((candidate) => Math.max(0, candidate.sample.p));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);

  const normalizedWeights =
    weightSum > 0
      ? weights.map((value) => value / weightSum)
      : weights.map(() => 1 / weights.length);

  const avgX = candidateRects.reduce(
    (sum, candidate, index) => sum + candidate.centerX * normalizedWeights[index],
    0
  );

  const avgY = candidateRects.reduce(
    (sum, candidate, index) => sum + candidate.centerY * normalizedWeights[index],
    0
  );

  return { x: avgX, y: avgY };
}

function drawWeightedAveragePoint(candidateRects, alpha) {
  if (alpha <= 0) {
    return null;
  }

  const point = computeWeightedAveragePoint(candidateRects);

  if (!point) {
    return null;
  }

  const label = "Likelihood-weighted average";

  ctx.save();
  ctx.globalAlpha = alpha;

  // Draw the weighted-average marker.
  ctx.beginPath();
  ctx.arc(point.x, point.y, 15, 0, Math.PI * 2);
  ctx.fillStyle = rgba(AVERAGE, 0.12);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = rgba(AVERAGE, 0.96);
  ctx.fill();

  // Draw the label above the marker instead of overlapping it.
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const labelWidth = ctx.measureText(label).width;
  const labelX = point.x;
  const labelY = point.y - 34;

  roundedRectPath(
    labelX - labelWidth / 2 - 8,
    labelY - 14,
    labelWidth + 16,
    28,
    14
  );

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fill();

  ctx.fillStyle = rgba(AVERAGE, 0.95);
  ctx.fillText(label, labelX, labelY);

  ctx.restore();

  return point;
}

function drawShortFinalArrows(noisyRect, weightedAverage, progress, width) {
  if (!noisyRect || !weightedAverage) {
    return;
  }

  const startX = noisyRect.x + noisyRect.size + 14;
  const startY = noisyRect.centerY;

  const arrowLength = Math.min(96, width * 0.16);

  const unguidedEndX = startX + arrowLength;
  const unguidedEndY = startY;

  const dx = weightedAverage.x - startX;
  const dy = weightedAverage.y - startY;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));

  const cbgEndX = startX + (dx / distance) * arrowLength;
  const cbgEndY = startY + (dy / distance) * arrowLength;

  drawArrow(startX, startY, unguidedEndX, unguidedEndY, progress, {
    alpha: 0.9,
    rgb: MUTED,
    lineWidth: 4,
    headLength: 12,
    label: "unguided diffusion step",
    labelDy: 22,
    labelT: 0.56,
  });

  drawArrow(startX, startY, cbgEndX, cbgEndY, progress, {
    alpha: 0.95,
    rgb: AVERAGE,
    lineWidth: 4,
    headLength: 12,
    label: "CBG diffusion step",
    labelDy: -30,
    labelT: 0.58,
  });
}

function drawScene(time) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(250, 251, 253, 1)";
  ctx.fillRect(0, 0, width, height);

  /*
    Slower timeline with pauses:
      0-2     noisy image fades in
      2-4     pause
      4-6     sample arrows/images appear
      6-8     pause
      8-10    likelihood text appears
      10-12   pause
      12-14   samples rescale by likelihood
      14-16   pause
      16-18   estimator equation fades in
      18-20   pause
      20-22   blue boxes
      22-24   pause
      24-26   orange boxes
      26-28   pause
      28-30   weighted average appears
      30-32   pause
      32-34   final arrows appear
  */

  const noisyAlpha = stage(time, 0.0, 2.0);
  const sampleArrowProgress = stage(time, 4.0, 6.0);
  const sampleAlpha = stage(time, 4.4, 6.0);
  const probabilityAlpha = stage(time, 8.0, 10.0);
  const scaleProgress = stage(time, 12.0, 14.0);
  const formulaAlpha = stage(time, 16.0, 18.0);
  const blueProgress = stage(time, 20.0, 22.0);
  const orangeProgress = stage(time, 24.0, 26.0);

  // Fade samples down to 50% right before the likelihood-weighted average appears.
  // This reaches 0.5 opacity by t=28 and stays there afterward.
  const sampleDimProgress = stage(time, 26.0, 28.0);
  const sampleOpacityMultiplier = 1 - 0.5 * sampleDimProgress;

  const averageAlpha = stage(time, 28.0, 30.0);
  const finalArrowProgress = stage(time, 32.0, 34.0);

  const samples = animationAssets.samples;
  const layout = computeLayout(width, height, samples);

  const pValues = samples.map((sample) => sample.p);
  const minP = pValues.length ? Math.min(...pValues) : 0;
  const maxP = pValues.length ? Math.max(...pValues) : 1;
  const pRange = Math.max(1e-8, maxP - minP);

  drawHeader(width, height, formulaAlpha, blueProgress, orangeProgress, layout.headerHeight);

  const noisyRect = drawImageCard(
    animationAssets.noisy,
    layout.noisy.x,
    layout.noisy.y,
    layout.noisyCardSize,
    noisyAlpha,
    "Noisy state",
    0
  );

  const candidateRects = [];

  layout.candidates.forEach((candidate) => {
    const normalizedP = (candidate.sample.p - minP) / pRange;
    const targetScale = 0.78 + 0.5 * normalizedP;
    const currentScale = 1 + (targetScale - 1) * scaleProgress;
    const size = layout.candidateBaseSize * currentScale;

    if (noisyRect) {
      drawArrow(
        noisyRect.x + noisyRect.size + 8,
        noisyRect.centerY,
        candidate.x - size / 2 - 16,
        candidate.y,
        sampleArrowProgress,
        {
          alpha: 0.28 * noisyAlpha,
          rgb: MUTED,
          lineWidth: 2,
          headLength: 9,
        }
      );
    }

    const candidateRect = drawImageCard(
      candidate.sample,
      candidate.x,
      candidate.y,
      size,
      sampleAlpha * sampleOpacityMultiplier,
      "",
      orangeProgress
    );

    if (candidateRect) {
      candidateRects.push({
        ...candidateRect,
        sample: candidate.sample,
      });

      const probabilityText = `p(y|x)=${formatProbability(candidate.sample.p)}`;
      drawProbabilityLabel(
        probabilityText,
        candidate.x,
        candidate.y + size / 2 + 27,
        probabilityAlpha * sampleOpacityMultiplier,
        blueProgress
      );
    }
  });

  const weightedAverage = drawWeightedAveragePoint(candidateRects, averageAlpha);

  drawShortFinalArrows(noisyRect, weightedAverage, finalArrowProgress, width);
}

function drawEstimatorAnimation(timestamp) {
  if (!animationStartTime) {
    animationStartTime = timestamp;
  }

  const seconds = ((timestamp - animationStartTime) / 1000) % 37.5;

  drawScene(seconds);
  requestAnimationFrame(drawEstimatorAnimation);
}

(async function startCBGEstimatorAnimation() {
  animationAssets = await loadAssets();
  requestAnimationFrame(drawEstimatorAnimation);
})();