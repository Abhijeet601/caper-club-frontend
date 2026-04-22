(function initFaceAi(global) {
  'use strict';

  const DEFAULT_THRESHOLD = 0.56;
  const FULL_FRAME_PASSES = Object.freeze([
    Object.freeze({ inputSize: 416, scoreThreshold: 0.32, label: 'full-frame' }),
    Object.freeze({ inputSize: 320, scoreThreshold: 0.4, label: 'balanced' }),
  ]);
  const CENTER_CROP_PASSES = Object.freeze([
    Object.freeze({ inputSize: 416, scoreThreshold: 0.3, zoom: 1.35, offsetX: 0, offsetY: -0.04, label: 'center-1.35x' }),
    Object.freeze({ inputSize: 512, scoreThreshold: 0.26, zoom: 1.85, offsetX: 0, offsetY: -0.06, label: 'center-1.85x' }),
  ]);
  const FOCUS_PASS = Object.freeze({
    inputSize: 512,
    scoreThreshold: 0.24,
    label: 'focus-zoom',
  });
  const SMALL_FACE_RATIO = 0.18;
  const LONG_RANGE_FACE_RATIO = 0.14;
  const TARGET_FACE_RATIO = 0.24;
  const MAX_RECOMMENDED_ZOOM = 2.6;

  function ensureFaceApi() {
    if (!global.faceapi) {
      throw new Error('face-api.js is not loaded.');
    }
    return global.faceapi;
  }

  function round(value) {
    return Number(Number(value || 0).toFixed(4));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value || 0)));
  }

  function normalizeBox(box, width, height) {
    return {
      top: round(box.y / height),
      left: round(box.x / width),
      width: round(box.width / width),
      height: round(box.height / height),
    };
  }

  function mapBoxToSource(box, sourceWidth, sourceHeight, region, surfaceWidth, surfaceHeight) {
    if (!region) {
      return normalizeBox(box, sourceWidth, sourceHeight);
    }

    const scaleX = region.width / surfaceWidth;
    const scaleY = region.height / surfaceHeight;
    return normalizeBox({
      x: region.x + (box.x * scaleX),
      y: region.y + (box.y * scaleY),
      width: box.width * scaleX,
      height: box.height * scaleY,
    }, sourceWidth, sourceHeight);
  }

  function normalizeDescriptor(values) {
    if (!Array.isArray(values) || values.length !== 128) return null;
    return values.map(value => Number(Number(value || 0).toFixed(6)));
  }

  function euclideanDistance(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return Number.POSITIVE_INFINITY;
    }

    let total = 0;
    for (let index = 0; index < left.length; index += 1) {
      const delta = Number(left[index] || 0) - Number(right[index] || 0);
      total += delta * delta;
    }

    return Math.sqrt(total);
  }

  function distanceToConfidence(distance) {
    const scaled = Math.max(0, Math.min(1, 1 - (distance / 0.65)));
    return Number(scaled.toFixed(2));
  }

  function getInputDimensions(input) {
    return {
      width: Number(input?.videoWidth || input?.naturalWidth || input?.width || 1),
      height: Number(input?.videoHeight || input?.naturalHeight || input?.height || 1),
    };
  }

  function faceRatioFromBox(faceBox) {
    return Math.max(Number(faceBox?.width || 0), Number(faceBox?.height || 0));
  }

  function classifyDistanceHint(faceRatio) {
    if (faceRatio < LONG_RANGE_FACE_RATIO) return 'long-range';
    if (faceRatio < SMALL_FACE_RATIO) return 'mid-range';
    return 'near';
  }

  function recommendZoom(faceRatio) {
    if (!faceRatio) return 1;
    if (faceRatio >= TARGET_FACE_RATIO) return 1;
    return round(clamp(TARGET_FACE_RATIO / faceRatio, 1, MAX_RECOMMENDED_ZOOM));
  }

  function createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  function buildCenterCrop(width, height, pass) {
    const cropWidth = width / Number(pass.zoom || 1);
    const cropHeight = height / Number(pass.zoom || 1);
    const x = clamp(((width - cropWidth) / 2) + (Number(pass.offsetX || 0) * width), 0, width - cropWidth);
    const y = clamp(((height - cropHeight) / 2) + (Number(pass.offsetY || 0) * height), 0, height - cropHeight);
    return { x, y, width: cropWidth, height: cropHeight };
  }

  function buildFocusCrop(faceBox, sourceWidth, sourceHeight) {
    const pixelBox = {
      x: Number(faceBox.left || 0) * sourceWidth,
      y: Number(faceBox.top || 0) * sourceHeight,
      width: Number(faceBox.width || 0) * sourceWidth,
      height: Number(faceBox.height || 0) * sourceHeight,
    };
    const centerX = pixelBox.x + (pixelBox.width / 2);
    const centerY = pixelBox.y + (pixelBox.height / 2);
    const cropWidth = clamp(pixelBox.width * 3.4, sourceWidth * 0.18, sourceWidth);
    const cropHeight = clamp(pixelBox.height * 3.8, sourceHeight * 0.22, sourceHeight);
    const x = clamp(centerX - (cropWidth / 2), 0, sourceWidth - cropWidth);
    const y = clamp(centerY - (cropHeight * 0.42), 0, sourceHeight - cropHeight);
    return { x, y, width: cropWidth, height: cropHeight };
  }

  function drawCropSurface(input, region, targetLongEdge) {
    const longestEdge = Math.max(region.width, region.height);
    const desiredEdge = Number(targetLongEdge || longestEdge);
    const scale = clamp(desiredEdge / longestEdge, 0.45, 2.5);
    const canvas = createCanvas(region.width * scale, region.height * scale);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      input,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }

  function detectionRank(detection, width, height) {
    const box = detection?.detection?.box;
    if (!box || !width || !height) return -1;
    const centerX = (box.x + (box.width / 2)) / width;
    const centerY = (box.y + (box.height / 2)) / height;
    const centerBias = 1 - clamp(Math.hypot(centerX - 0.5, centerY - 0.44) / 0.65, 0, 1);
    const sizeBias = clamp(Math.max(box.width / width, box.height / height) / 0.28, 0, 1);
    const score = clamp(detection?.detection?.score || 0, 0, 1);
    return (score * 0.68) + (centerBias * 0.22) + (sizeBias * 0.1);
  }

  function pickBestDetection(detections, width, height) {
    let best = null;

    for (const detection of detections || []) {
      const rank = detectionRank(detection, width, height);
      if (!best || rank > best.rank) {
        best = { detection, rank };
      }
    }

    return best;
  }

  function qualityScore(payload) {
    if (!payload) return Number.NEGATIVE_INFINITY;
    const scoreWeight = clamp(Number(payload.score || 0), 0, 1) * 0.72;
    const sizeWeight = clamp(Number(payload.faceRatio || 0) / TARGET_FACE_RATIO, 0, 1) * 0.28;
    const captureBonus = payload.captureMode === 'focus-zoom' ? 0.03 : 0;
    return scoreWeight + sizeWeight + captureBonus;
  }

  function shouldPrefer(next, current) {
    return qualityScore(next) > (qualityScore(current) + 0.015);
  }

  async function loadModels(modelPath) {
    const faceapi = ensureFaceApi();
    const base = String(modelPath || 'models').replace(/\/+$/, '');

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(base),
      faceapi.nets.faceLandmark68Net.loadFromUri(base),
      faceapi.nets.faceRecognitionNet.loadFromUri(base),
    ]);

    return true;
  }

  async function imageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to load image.'));
      image.src = dataUrl;
    });
  }

  async function detectWithPass(input, pass) {
    const faceapi = ensureFaceApi();
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: Number(pass.inputSize || 320),
      scoreThreshold: Number(pass.scoreThreshold || 0.4),
    });
    return faceapi
      .detectAllFaces(input, options)
      .withFaceLandmarks()
      .withFaceDescriptors();
  }

  function buildDetectionPayload(bestDetection, sourceWidth, sourceHeight, meta) {
    const descriptor = normalizeDescriptor(Array.from(bestDetection?.descriptor || []));
    if (!descriptor) return null;

    const surfaceWidth = Number(meta?.surfaceWidth || sourceWidth || 1);
    const surfaceHeight = Number(meta?.surfaceHeight || sourceHeight || 1);
    const faceBox = mapBoxToSource(
      bestDetection.detection.box,
      sourceWidth,
      sourceHeight,
      meta?.region || null,
      surfaceWidth,
      surfaceHeight,
    );
    const faceRatio = faceRatioFromBox(faceBox);

    return {
      descriptor,
      score: Number((bestDetection.detection.score || 0).toFixed(3)),
      faceBox,
      faceRatio: round(faceRatio),
      distanceHint: classifyDistanceHint(faceRatio),
      recommendedZoom: recommendZoom(faceRatio),
      captureMode: String(meta?.captureMode || meta?.label || 'full-frame'),
      detectorPass: String(meta?.label || 'full-frame'),
    };
  }

  async function detectOnSurface(input, sourceWidth, sourceHeight, passes, meta = {}) {
    const surfaceDimensions = getInputDimensions(input);
    let best = null;

    for (const pass of passes || []) {
      const detections = await detectWithPass(input, pass);
      const candidate = pickBestDetection(detections, surfaceDimensions.width, surfaceDimensions.height);
      if (!candidate?.detection) continue;

      const payload = buildDetectionPayload(candidate.detection, sourceWidth, sourceHeight, {
        ...meta,
        surfaceWidth: surfaceDimensions.width,
        surfaceHeight: surfaceDimensions.height,
        label: pass.label,
      });
      if (!payload) continue;

      if (!best || shouldPrefer(payload, best)) {
        best = payload;
      }

      if (payload.score >= 0.95 && payload.faceRatio >= SMALL_FACE_RATIO) {
        break;
      }
    }

    return best;
  }

  async function detectLongRangeCandidate(input, sourceWidth, sourceHeight) {
    let best = null;

    for (const pass of CENTER_CROP_PASSES) {
      const region = buildCenterCrop(sourceWidth, sourceHeight, pass);
      const targetLongEdge = Math.max(720, Number(pass.inputSize || 416) * 2);
      const surface = drawCropSurface(input, region, targetLongEdge);
      const payload = await detectOnSurface(surface, sourceWidth, sourceHeight, [pass], {
        region,
        captureMode: 'center-zoom',
      });
      if (!payload) continue;

      payload.recommendedZoom = round(Math.max(Number(payload.recommendedZoom || 1), Number(pass.zoom || 1)));
      if (!best || shouldPrefer(payload, best)) {
        best = payload;
      }
    }

    return best;
  }

  async function refineSmallFace(input, sourceWidth, sourceHeight, currentDetection) {
    if (!currentDetection?.faceBox) return null;
    const region = buildFocusCrop(currentDetection.faceBox, sourceWidth, sourceHeight);
    const targetLongEdge = Math.max(800, Number(FOCUS_PASS.inputSize || 512) * 2);
    const surface = drawCropSurface(input, region, targetLongEdge);
    const refined = await detectOnSurface(surface, sourceWidth, sourceHeight, [FOCUS_PASS], {
      region,
      captureMode: 'focus-zoom',
    });
    if (!refined) return null;

    refined.recommendedZoom = round(Math.max(Number(refined.recommendedZoom || 1), Number(currentDetection.recommendedZoom || 1)));
    return refined;
  }

  async function detectDescriptor(input) {
    const dimensions = getInputDimensions(input);
    if (!dimensions.width || !dimensions.height) return null;

    let detection = await detectOnSurface(input, dimensions.width, dimensions.height, FULL_FRAME_PASSES, {
      captureMode: 'full-frame',
    });

    if (!detection) {
      detection = await detectLongRangeCandidate(input, dimensions.width, dimensions.height);
    }

    if (detection && (detection.faceRatio < SMALL_FACE_RATIO || detection.captureMode !== 'full-frame')) {
      const refined = await refineSmallFace(input, dimensions.width, dimensions.height, detection);
      if (refined && shouldPrefer(refined, detection)) {
        detection = refined;
      }
    }

    return detection || null;
  }

  async function detectFromVideo(video) {
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    return detectDescriptor(video);
  }

  async function detectFromDataUrl(dataUrl) {
    const image = await imageFromDataUrl(dataUrl);
    return detectDescriptor(image);
  }

  async function descriptorsFromImages(images) {
    const descriptors = [];

    for (const image of images || []) {
      const result = await detectFromDataUrl(image);
      if (result?.descriptor) descriptors.push(result.descriptor);
    }

    return descriptors;
  }

  function averageDescriptor(descriptors) {
    if (!Array.isArray(descriptors) || !descriptors.length) return null;
    const sums = new Array(128).fill(0);

    descriptors.forEach(descriptor => {
      descriptor.forEach((value, index) => {
        sums[index] += Number(value || 0);
      });
    });

    const averaged = sums.map(value => value / descriptors.length);
    const magnitude = Math.sqrt(averaged.reduce((total, value) => total + (value * value), 0));

    if (magnitude > 0) {
      for (let index = 0; index < averaged.length; index += 1) {
        averaged[index] = averaged[index] / magnitude;
      }
    }

    return normalizeDescriptor(averaged);
  }

  function bestMatch(descriptor, users, threshold = DEFAULT_THRESHOLD) {
    if (!Array.isArray(descriptor) || !Array.isArray(users) || !users.length) {
      return null;
    }

    let match = null;

    users.forEach(user => {
      if (!Array.isArray(user?.descriptor)) return;
      const distance = euclideanDistance(descriptor, user.descriptor);

      if (!match || distance < match.distance) {
        match = {
          user,
          distance: Number(distance.toFixed(4)),
          confidence: distanceToConfidence(distance),
          matched: distance <= threshold,
        };
      }
    });

    return match;
  }

  global.FaceAi = {
    DEFAULT_THRESHOLD,
    averageDescriptor,
    bestMatch,
    descriptorsFromImages,
    detectFromDataUrl,
    detectFromVideo,
    distanceToConfidence,
    euclideanDistance,
    loadModels,
  };
})(window);
