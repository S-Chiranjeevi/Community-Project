import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const $ = (selector) => document.querySelector(selector);
const toast = $('#toast');
let toastTimeout;
let clerk;
let mountedAuthMode = null;
let lastAuthenticatedUserId = null;
let cameraStream;
let poseLandmarker;
let animationFrame;
let lastVideoTime = -1;
let repCount = 0;
let raised = false;
let lastCueAt = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3800);
}
function setStatus(message, kind = 'info') {
  const box = $('#liveFeedback');
  box.classList.toggle('warning', kind === 'warning');
  box.classList.toggle('success', kind === 'success');
  box.querySelector('span:last-child').textContent = message;
}
function authToken() { return clerk?.session?.getToken(); }
async function api(path, options = {}) {
  const token = await authToken();
  if (!token) throw new Error('Please sign in first.');
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function initializeClerk() {
  const { clerkPublishableKey } = await fetch('/api/config').then((response) => response.json());
  if (!clerkPublishableKey) {
    document.body.classList.remove('auth-required');
    $('#authButton').textContent = 'Add Clerk keys';
    $('#signInNotice').textContent = 'Add your Clerk keys to the local .env file, restart the app, then sign in. Use fictional details for this student demo.';
    return;
  }
  const frontendApi = atob(clerkPublishableKey.split('_')[2]).replace(/\$$/, '');
  await loadScript(`https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadClerkScript(`https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, clerkPublishableKey);
  clerk = window.Clerk;
  await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  clerk.addListener(() => updateAuthUI(clerk));
  updateAuthUI(clerk);
}
function loadClerkScript(src, publishableKey) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = publishableKey;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load ClerkJS.'));
    document.head.append(script);
  });
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the Clerk sign-in interface.'));
    document.head.append(script);
  });
}
function updateAuthUI(state) {
  const signedIn = Boolean(state.isSignedIn);
  $('#authButton').textContent = signedIn ? 'Account' : 'Sign in / Sign up';
  $('#signInNotice').hidden = signedIn;
  $('#profileForm').hidden = !signedIn;
  const user = state.user;
  if (signedIn && user) {
    document.body.classList.remove('auth-required');
    document.body.classList.add('profile-required');
    $('#closeAuth').hidden = false;
    $('#authDialog').close();
    const slot = $('#userButton');
    slot.replaceChildren();
    slot.className = 'profile-button';
    slot.innerHTML = '<span id="clerkUserButton"></span><span><strong></strong><small>Signed in with Clerk</small></span>';
    slot.querySelector('strong').textContent = user.fullName || user.primaryEmailAddress?.emailAddress || 'Your account';
    try { state.mountUserButton(slot.querySelector('#clerkUserButton')); } catch { /* The sign-in button remains available. */ }
    if (lastAuthenticatedUserId !== user.id) {
      lastAuthenticatedUserId = user.id;
      loadProfile().catch((error) => showToast(error.message));
    }
  } else {
    lastAuthenticatedUserId = null;
    document.body.classList.add('auth-required');
    document.body.classList.remove('profile-required');
    $('#closeAuth').hidden = true;
    $('#userButton').innerHTML = '<span class="avatar">?</span><span><strong>Guest</strong><small>Sign in to save your profile</small></span>';
    $('#recommendationResult').innerHTML = '<div class="empty-recommendation">Sign in and save your profile to get started.</div>';
    mountAuthScreen('sign-in');
    if (!$('#authDialog').open) $('#authDialog').showModal();
  }
}
$('#authButton').addEventListener('click', () => {
  if (!clerk) { showToast('Clerk is still loading. Please try again in a moment.'); return; }
  if (clerk.isSignedIn) {
    mountAuthScreen('profile');
  } else {
    mountAuthScreen('sign-in');
  }
  if (!$('#authDialog').open) $('#authDialog').showModal();
});
function mountAuthScreen(mode) {
  if (!clerk) return;
  const mount = $('#authMount');
  const tabs = $('#authModes');
  tabs.hidden = mode === 'profile';
  for (const button of tabs.querySelectorAll('[data-auth-mode]')) {
    const selected = button.dataset.authMode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  if (mountedAuthMode === 'sign-in') clerk.unmountSignIn(mount);
  if (mountedAuthMode === 'sign-up') clerk.unmountSignUp(mount);
  if (mountedAuthMode === 'profile') clerk.unmountUserProfile(mount);
  mount.replaceChildren();
  if (mode === 'profile') clerk.mountUserProfile(mount);
  else if (mode === 'sign-up') clerk.mountSignUp(mount);
  else clerk.mountSignIn(mount);
  mountedAuthMode = mode;
}
$('#authModes').addEventListener('click', (event) => {
  const button = event.target.closest('[data-auth-mode]');
  if (button) mountAuthScreen(button.dataset.authMode);
});
$('#closeAuth').addEventListener('click', () => $('#authDialog').close());
$('#authDialog').addEventListener('cancel', (event) => {
  if (document.body.classList.contains('auth-required')) event.preventDefault();
});

async function loadProfile() {
  const { profile } = await api('/api/profile');
  const form = $('#profileForm');
  if (!profile) {
    form.reset();
    $('#profileStatus').textContent = 'Complete your movement profile to continue.';
    $('#breadcrumb').innerHTML = 'Getting started <span>/</span> Your profile';
    document.body.classList.add('profile-required');
    return;
  }
  form.elements.goals.value = profile.goals || '';
  form.elements.injuries.value = profile.injuries || '';
  form.elements.medicalHistory.value = profile.medicalHistory || '';
  form.elements.surgeryStatus.value = profile.surgeryStatus || 'unsure';
  form.elements.painLevel.value = profile.painLevel || 'unsure';
  [...form.querySelectorAll('[name="affectedJoints"]')].forEach((input) => { input.checked = profile.affectedJoints?.includes(input.value) || false; });
  $('#profileStatus').textContent = 'Profile loaded from your private Clerk metadata.';
  $('#breadcrumb').innerHTML = 'Your space <span>/</span> Overview';
  $('#recommendationResult').innerHTML = '<div class="empty-recommendation">Your profile is ready. Add a goal and consent to request suggestions.</div>';
  document.body.classList.remove('profile-required');
}
$('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const profile = {
    goals: form.elements.goals.value.trim(),
    affectedJoints: [...form.querySelectorAll('[name="affectedJoints"]:checked')].map((input) => input.value),
    injuries: form.elements.injuries.value.trim(),
    medicalHistory: form.elements.medicalHistory.value.trim(),
    surgeryStatus: form.elements.surgeryStatus.value,
    painLevel: form.elements.painLevel.value
  };
  $('#profileStatus').textContent = 'Saving…';
  try {
    await api('/api/profile', { method: 'PUT', body: JSON.stringify(profile) });
    $('#profileStatus').textContent = 'Saved privately to your Clerk account.';
    document.body.classList.remove('profile-required');
    $('#breadcrumb').innerHTML = 'Your space <span>/</span> Overview';
    showToast('Your movement profile was saved.');
  } catch (error) { $('#profileStatus').textContent = error.message; }
});

$('#recommendForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.elements.consent.checked) return;
  const button = $('#recommendButton');
  button.disabled = true;
  button.textContent = 'Preparing suggestions…';
  $('#recommendationResult').innerHTML = '<div class="empty-recommendation">Reviewing your saved movement profile…</div>';
  try {
    const data = await api('/api/recommend', { method: 'POST', body: JSON.stringify({ requirements: form.elements.requirements.value.trim(), consentToGemini: true }) });
    renderRecommendations(data);
  } catch (error) {
    $('#recommendationResult').innerHTML = `<div class="empty-recommendation error-message"></div>`;
    $('#recommendationResult .error-message').textContent = error.message;
  } finally { button.disabled = false; button.innerHTML = 'Suggest exercises <span>→</span>'; }
});
function renderRecommendations(data) {
  const root = $('#recommendationResult');
  root.replaceChildren();
  const summary = document.createElement('p');
  summary.className = data.needsClinicianReview ? 'review-banner' : 'recommend-summary';
  summary.textContent = data.summary || (data.needsClinicianReview ? 'Please check in with a physiotherapist before trying new movements.' : 'Suggestions based on your profile:');
  root.append(summary);
  if (data.needsClinicianReview) {
    const review = document.createElement('div'); review.className = 'review-banner'; review.textContent = 'A clinician should review your current symptoms or recovery needs before exercise suggestions are used.'; root.append(review);
  }
  for (const exercise of data.exercises || []) {
    const card = document.createElement('article'); card.className = 'suggestion-item';
    const title = document.createElement('strong'); title.textContent = exercise.name;
    const reason = document.createElement('p'); reason.textContent = exercise.reason;
    const cue = document.createElement('small'); cue.textContent = `${exercise.durationMinutes} min · ${exercise.cue}`;
    card.append(title, reason, cue); root.append(card);
  }
  for (const cautionText of data.cautions || []) { const caution = document.createElement('p'); caution.className = 'caution-note'; caution.textContent = `• ${cautionText}`; root.append(caution); }
  if (!data.exercises?.length && !data.needsClinicianReview) { const none = document.createElement('p'); none.className = 'caution-note'; none.textContent = 'No suitable movements were returned. Try a physiotherapist reviewed plan.'; root.append(none); }
}

const feedbackMessages = {
  'shoulder-rolls': 'Keep the circles small and relaxed. This camera view cannot reliably measure shoulder rotation yet.',
  'neck-range': 'Move slowly and stay comfortable. This camera view does not assess neck range accurately yet.'
};
$('#liveExercise').addEventListener('change', () => { repCount = 0; raised = false; $('#repMetric').textContent = '0'; setStatus(feedbackMessages[$('#liveExercise').value] || 'Sit comfortably. Raise slowly only within your comfortable range.'); });
$('#cameraButton').addEventListener('click', async () => {
  if (cameraStream) { stopCamera(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { showToast('Camera access needs HTTPS or localhost.'); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const video = $('#cameraVideo'); video.srcObject = cameraStream; video.hidden = false; await video.play();
    $('#cameraPlaceholder').hidden = true; $('#cameraStatus').textContent = 'Camera preview on · local processing';
    $('#cameraButton').classList.add('camera-on'); $('#cameraButton').innerHTML = '<span>◉</span> Stop camera';
    $('#poseBadge').classList.add('live'); $('#poseBadge').querySelector('span:last-child').textContent = 'Starting pose model…';
    setStatus('Loading the pose model for on device movement cues…');
    await startPoseModel();
  } catch (error) {
    stopCamera();
    setStatus(error.name === 'NotAllowedError' ? 'Camera permission was declined. Enable it in browser settings, then try again.' : `Could not start pose tracking: ${error.message}`, 'warning');
  }
});
async function startPoseModel() {
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm');
  const options = {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
    runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.55, minPosePresenceConfidence: 0.55, minTrackingConfidence: 0.5
  };
  try { poseLandmarker = await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } }); }
  catch { poseLandmarker = await PoseLandmarker.createFromOptions(vision, options); }
  $('#poseBadge').querySelector('span:last-child').textContent = 'On device pose tracking';
  setStatus('Step back until your upper body is visible. Feedback is experimental; stop if anything hurts.');
  predictFrame();
}
function predictFrame() {
  const video = $('#cameraVideo');
  if (!poseLandmarker || video.readyState < 2) { animationFrame = requestAnimationFrame(predictFrame); return; }
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());
    drawPose(result.landmarks?.[0] || []);
    processPose(result.landmarks?.[0] || []);
  }
  animationFrame = requestAnimationFrame(predictFrame);
}
function drawPose(landmarks) {
  const canvas = $('#poseCanvas'); const video = $('#cameraVideo');
  const width = video.clientWidth; const height = video.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== width * devicePixelRatio || canvas.height !== height * devicePixelRatio) { canvas.width = width * devicePixelRatio; canvas.height = height * devicePixelRatio; }
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d'); ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, width, height); ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1);
  if (!landmarks.length) { ctx.restore(); return; }
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#b5e388'; ctx.fillStyle = '#f5fff0';
  for (const [a, b] of PoseLandmarker.POSE_CONNECTIONS) {
    if ((landmarks[a]?.visibility ?? 0) < 0.45 || (landmarks[b]?.visibility ?? 0) < 0.45) continue;
    ctx.beginPath(); ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height); ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height); ctx.stroke();
  }
  for (const point of landmarks) { if ((point.visibility ?? 0) < 0.45) continue; ctx.beginPath(); ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function processPose(points) {
  if (!points.length) { setStatus('I can’t see a full pose yet. Adjust the camera or your position.'); $('#visibilityMetric').textContent = 'No pose'; return; }
  const required = [11, 12, 13, 14, 23, 24];
  const visible = required.filter((i) => (points[i]?.visibility ?? 0) > 0.55).length / required.length;
  $('#visibilityMetric').textContent = `${Math.round(visible * 100)}%`;
  if (visible < 0.65) { setStatus('Move into a brighter, wider view so your shoulders and hips are visible.'); return; }
  if ($('#liveExercise').value !== 'seated-arm-raise') { setStatus(feedbackMessages[$('#liveExercise').value], 'info'); return; }
  const arms = [];
  if ([11, 13, 23].every((i) => (points[i]?.visibility ?? 0) > 0.55)) arms.push(180 - jointAngle(points[23], points[11], points[13]));
  if ([12, 14, 24].every((i) => (points[i]?.visibility ?? 0) > 0.55)) arms.push(180 - jointAngle(points[24], points[12], points[14]));
  if (!arms.length) { setStatus('Bring one shoulder, elbow, and hip into view.'); return; }
  const angle = Math.max(...arms);
  $('#angleMetric').textContent = `${Math.round(angle)}°`;
  if (angle > 28 && !raised) { raised = true; }
  if (angle < 13 && raised) { repCount += 1; raised = false; $('#repMetric').textContent = String(repCount); }
  if (performance.now() - lastCueAt < 900) return;
  lastCueAt = performance.now();
  if (angle > 28 && angle < 120) setStatus('Nice, controlled lift. Lower slowly and stay within a comfortable range.', 'success');
  else if (angle >= 120) setStatus('You’re lifting high. Keep the range easy and stop before discomfort.', 'warning');
  else setStatus('When ready, raise slowly only as far as feels comfortable.', 'info');
}
function jointAngle(a, b, c) {
  const vector = (p) => [p.x - b.x, p.y - b.y];
  const v1 = vector(a), v2 = vector(c);
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const den = Math.hypot(...v1) * Math.hypot(...v2) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / den))) * (180 / Math.PI);
}
function stopCamera() {
  cancelAnimationFrame(animationFrame);
  poseLandmarker?.close(); poseLandmarker = null;
  cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null;
  $('#cameraVideo').srcObject = null; $('#cameraVideo').hidden = true; $('#cameraPlaceholder').hidden = false;
  const canvas = $('#poseCanvas'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  $('#cameraButton').classList.remove('camera-on'); $('#cameraButton').innerHTML = '<span>⌾</span> Start camera';
  $('#cameraStatus').textContent = 'Camera is off'; $('#poseBadge').classList.remove('live'); $('#poseBadge').querySelector('span:last-child').textContent = 'Camera off';
  $('#visibilityMetric').textContent = '—'; $('#angleMetric').textContent = '—';
}

const moodAdvice = { Tight: 'Take it extra gently or rest. Don’t exercise through pain.', Okay: 'Go slowly, stay comfortable, and pause if anything feels unusual.', Good: 'Keep your movement steady and within a comfortable range.', Great: 'Build gradually. You can always take a break.' };
document.querySelectorAll('.mood-option').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.mood-option').forEach((option) => option.classList.remove('active'));
  button.classList.add('active'); $('#checkinResult').textContent = moodAdvice[button.dataset.mood];
  if (button.dataset.mood === 'Tight') setStatus('You reported feeling tight. Consider resting; don’t push through discomfort.', 'warning');
}));
$('.today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
window.addEventListener('beforeunload', stopCamera);
initializeClerk().catch((error) => {
  console.error(error);
  document.body.classList.remove('auth-required');
  $('#signInNotice').hidden = false;
  $('#signInNotice').textContent = `Clerk setup issue: ${error.message}. Check your local .env keys and restart the app.`;
  showToast(`Clerk setup issue: ${error.message}`);
});



