import express from 'express';
import { clerkMiddleware, clerkClient, getAuth } from '@clerk/express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 3000);
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const recommendationRequests = new Map();

app.use(express.json({ limit: '32kb' }));
app.use(clerkMiddleware({ publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY }));
app.use(express.static('dist'));
app.get('/api/config', (_req, res) => res.json({ clerkPublishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY || '' }));

function signedIn(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in to continue.' });
  req.userId = userId;
  next();
}

const allowedExercises = [
  { id: 'shoulder-rolls', name: 'Gentle shoulder rolls', region: 'shoulder', level: 'gentle', description: 'Small, slow shoulder circles while seated.' },
  { id: 'seated-arm-raise', name: 'Seated arm raise', region: 'shoulder', level: 'gentle', description: 'Raise one arm in front only through a comfortable range.' },
  { id: 'neck-range', name: 'Gentle neck range of motion', region: 'neck', level: 'gentle', description: 'Small, pain-free turns while seated; no pulling or forcing.' },
  { id: 'ankle-pumps', name: 'Seated ankle pumps', region: 'ankles', level: 'gentle', description: 'Slowly point and flex the feet while seated.' },
  { id: 'seated-march', name: 'Seated marching', region: 'knee', level: 'gentle', description: 'Alternate small knee lifts while seated.' },
  { id: 'breathing', name: 'Comfortable paced breathing', region: 'whole-body', level: 'rest', description: 'A relaxed breathing pause; do not hold your breath.' }
];
const regionAliases = {
  knee: /knee|acl|anterior cruciate|meniscus|mcl|pcl|patella/i,
  shoulder: /shoulder|rotator cuff|labrum/i,
  hip: /hip|groin/i,
  ankle: /ankle|achilles|foot/i,
  neck: /neck|cervical/i,
  back: /back|spine|lumbar/i,
  elbow: /elbow/i,
  wrist: /wrist|hand/i
};
function affectedRegions(profile) {
  const source = `${profile?.injuries || ''} ${profile?.medicalHistory || ''}`.toLowerCase();
  const regions = new Set();
  for (const [region, pattern] of Object.entries(regionAliases)) if (pattern.test(source)) regions.add(region);
  for (const region of profile?.affectedJoints || []) if (['knee','shoulder','hip','ankle','neck','back','elbow','wrist'].includes(region)) regions.add(region);
  return regions;
}
function usableExercises(profile) {
  const affected = affectedRegions(profile);
  return allowedExercises.filter((exercise) => exercise.region === 'whole-body' || !affected.has(exercise.region));
}

app.get('/api/profile', signedIn, async (req, res) => {
  try {
    const user = await clerkClient.users.getUser(req.userId);
    res.json({ profile: user.privateMetadata?.rehabProfile || null });
  } catch (error) {
    console.error('Profile read failed:', error.message);
    res.status(502).json({ error: 'Could not load your profile from Clerk.' });
  }
});
app.put('/api/profile', signedIn, async (req, res) => {
  const { goals, affectedJoints, injuries, medicalHistory, surgeryStatus, painLevel } = req.body || {};
  if (typeof goals !== 'string' || goals.length > 500 || typeof injuries !== 'string' || injuries.length > 500 || typeof medicalHistory !== 'string' || medicalHistory.length > 1000) return res.status(400).json({ error: 'Please keep profile details within the field limits.' });
  if (!Array.isArray(affectedJoints) || affectedJoints.some((joint) => !['knee','shoulder','hip','ankle','neck','back','elbow','wrist'].includes(joint))) return res.status(400).json({ error: 'Choose valid affected joint areas.' });
  if (!['none','previous','recent','unsure'].includes(surgeryStatus) || !['none','mild','moderate','severe','unsure'].includes(painLevel)) return res.status(400).json({ error: 'Choose valid recovery details.' });
  const profile = { goals: goals.trim(), affectedJoints, injuries: injuries.trim(), medicalHistory: medicalHistory.trim(), surgeryStatus, painLevel, updatedAt: new Date().toISOString() };
  try {
    await clerkClient.users.updateUserMetadata(req.userId, { privateMetadata: { rehabProfile: profile } });
    res.json({ profile });
  } catch (error) {
    console.error('Profile save failed:', error.message);
    res.status(502).json({ error: 'Could not save your profile to Clerk.' });
  }
});
app.post('/api/recommend', signedIn, async (req, res) => {
  const now = Date.now();
  const recent = (recommendationRequests.get(req.userId) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 8) return res.status(429).json({ error: 'Please wait a minute before requesting more suggestions.' });
  recent.push(now); recommendationRequests.set(req.userId, recent);
  if (!ai) return res.status(503).json({ error: 'Gemini is not configured. Add GEMINI_API_KEY to your local .env file.' });
  const { requirements, consentToGemini } = req.body || {};
  if (consentToGemini !== true) return res.status(400).json({ error: 'Please confirm before sharing your health profile with Gemini.' });
  if (typeof requirements !== 'string' || requirements.trim().length < 4 || requirements.length > 500) return res.status(400).json({ error: 'Describe what you want help with (4–500 characters).' });
  try {
    const user = await clerkClient.users.getUser(req.userId);
    const profile = user.privateMetadata?.rehabProfile;
    if (!profile) return res.status(400).json({ error: 'Save your movement profile first.' });
    const historyText = `${profile.injuries || ''} ${profile.medicalHistory || ''}`;
    const hasUnspecifiedLigamentInjury = /ligament (tear|injury)|torn ligament/i.test(historyText) && affectedRegions(profile).size === 0;
    if (['moderate', 'severe'].includes(profile.painLevel) || profile.surgeryStatus === 'recent' || hasUnspecifiedLigamentInjury) {
      return res.json({ needsClinicianReview: true, summary: 'Based on the symptoms or history in your profile, a physiotherapist should review your needs before this demo suggests exercises.', exercises: [], cautions: ['This demo cannot assess post-surgical recovery or moderate to severe discomfort.'] });
    }
    const catalog = usableExercises(profile);
    if (!catalog.some((exercise) => exercise.region !== 'whole-body')) return res.status(422).json({ error: 'Your current profile needs review by a physiotherapist before this demo can suggest movement exercises.' });
    const prompt = `You are a cautious exercise-planning assistant for a student rehabilitation demo. This is NOT medical advice. Choose up to 3 options only from the allowed catalog below. Never invent exercises, sets, repetitions, or treatment claims. If symptoms are severe, recent surgery is reported, the user's request conflicts with their history, or there is not enough information, return needsClinicianReview=true and no exercises. Do not diagnose. Keep intensity gentle and explain limitations. User goal: ${requirements.trim()}\nUser profile: ${JSON.stringify(profile)}\nAllowed catalog: ${JSON.stringify(catalog)}\nReturn ONLY JSON: {"needsClinicianReview": boolean, "summary": string, "exercises": [{"id": string, "reason": string, "durationMinutes": number, "cue": string}], "cautions": [string]}. Every exercise id must exist in the catalog. durationMinutes must be 1-5. Keep cues simple; never tell users to push through pain.`;
    const response = await ai.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-3.8-flash', contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.2 } });
    const raw = response.text?.trim();
    const result = JSON.parse(raw?.replace(/^```(?:json)?\s*|\s*```$/g, '') || '{}');
    const allowed = new Map(catalog.map((exercise) => [exercise.id, exercise]));
    const exercises = Array.isArray(result.exercises) ? result.exercises.slice(0, 3).flatMap((exercise) => {
      const source = allowed.get(exercise.id);
      if (!source) return [];
      return [{ ...source, reason: String(exercise.reason || '').slice(0, 240), durationMinutes: Math.max(1, Math.min(5, Number(exercise.durationMinutes) || 2)), cue: String(exercise.cue || source.description).slice(0, 220) }];
    }) : [];
    res.json({ needsClinicianReview: Boolean(result.needsClinicianReview), summary: String(result.summary || '').slice(0, 500), exercises: result.needsClinicianReview ? [] : exercises, cautions: Array.isArray(result.cautions) ? result.cautions.slice(0, 4).map((text) => String(text).slice(0, 200)) : [] });
  } catch (error) {
    console.error('Recommendation request failed:', error.message);
    res.status(502).json({ error: 'Gemini could not prepare suggestions right now. Please try again later.' });
  }
});

app.listen(port, () => console.log(`RehabRise running at http://localhost:${port}`));

