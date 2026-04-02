(function initFaceAi(global) {
  'use strict';

  const DEFAULT_THRESHOLD = 0.56;
  const DETECTOR_OPTIONS = { inputSize: 224, scoreThreshold: 0.45 };

  function ensureFaceApi() {
    if (!global.faceapi) {
      throw new Error('face-api.js is not loaded.');
    }
    return global.faceapi;
  }

  function normalizeBox(box, width, height) {
    return {
      top: round(box.y / height),
      left: round(box.x / width),
      width: round(box.width / width),
      height: round(box.height / height),
    };
  }

  function round(value) {
    return Number(Number(value || 0).toFixed(4));
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

  async function detectDescriptor(input) {
    const faceapi = ensureFaceApi();
    const options = new faceapi.TinyFaceDetectorOptions(DETECTOR_OPTIONS);
    const detection = await faceapi
      .detectSingleFace(input, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return null;

    const descriptor = normalizeDescriptor(Array.from(detection.descriptor || []));
    if (!descriptor) return null;

    const width = input.videoWidth || input.naturalWidth || input.width || 1;
    const height = input.videoHeight || input.naturalHeight || input.height || 1;

    return {
      descriptor,
      score: Number((detection.detection.score || 0).toFixed(3)),
      faceBox: normalizeBox(detection.detection.box, width, height),
    };
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
