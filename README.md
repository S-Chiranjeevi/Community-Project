# RehabRise

A student prototype for accessible home exercise guidance. It combines a user-controlled movement profile, Gemini suggestions from a small allow-listed exercise catalog, and browser-side pose landmarks for simple live camera cues.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and add your own keys:
   - `GEMINI_API_KEY` from Google AI Studio
   - `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` from a Clerk development instance
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev` and open the Vite URL shown in the terminal.
5. In Clerk, add that local URL to the development instance's allowed origins.

## Deploy to Vercel

The repository builds the Vite frontend as static files and routes `/api/config`, `/api/profile`, and `/api/recommend` through Vercel Functions backed by the Express handlers. Add these environment variables in the Vercel project for the environments you deploy:

- `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the same Clerk instance.
- `GEMINI_API_KEY` if you want exercise recommendations to work.

Use the keys for the Clerk instance intended for that deployment, add the deployed domain to that instance's allowed origins, and redeploy after changing environment variables.

The `.env` file is ignored by Git. Never add real keys to source code, screenshots, commits, or a public repository.

## What works in the demo

- Clerk sign-up/sign-in and account profile controls.
- Movement goals, affected joints, injury history, surgery timing, and current discomfort saved to the signed-in user's Clerk **private metadata**.
- A consent checkbox before that profile and the current request are sent to Gemini.
- Gemini chooses only from a server-side list of gentle demo movements. Joint regions mentioned as affected are filtered out before the model sees the allowed catalog. Severe pain, recent surgery, or insufficient options trigger a clinician review response.
- MediaPipe Pose Landmarker runs in the browser. Video is not sent to the backend; live cues estimate shoulder and elbow angles from 3D pose landmarks, plus head turn/tilt from visible facial/ear landmarks.

## Demo limitations

This is not a medical device or a substitute for assessment or supervision by a licensed physiotherapist. The suggestions and camera cues are experimental and have not been clinically validated. Use fictional profiles for a class demo. Do not use this project with real patient information until you have reviewed the privacy, security, data retention, and consent requirements for every provider you use. Gemini requests include the profile details the user approved; review Google's current API terms and data handling before use.

The camera estimates are experimental and depend on framing, lighting, clothing, and camera angle. They do not measure internal/external shoulder rotation or replace a clinician's assessment; head turn and tilt are approximate. The presentation's LSTM temporal model has not yet been trained or connected.
