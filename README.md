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

The `.env` file is ignored by Git. Never add real keys to source code, screenshots, commits, or a public repository.

## What works in the demo

- Clerk sign-up/sign-in and account profile controls.
- Movement goals, affected joints, injury history, surgery timing, and current discomfort saved to the signed-in user's Clerk **private metadata**.
- A consent checkbox before that profile and the current request are sent to Gemini.
- Gemini chooses only from a server-side list of gentle demo movements. Joint regions mentioned as affected are filtered out before the model sees the allowed catalog. Severe pain, recent surgery, or insufficient options trigger a clinician review response.
- MediaPipe Pose Landmarker runs in the browser. Video is not sent to the backend; current live arm raise cues use simple 2D angle thresholds.

## Demo limitations

This is not a medical device or a substitute for assessment or supervision by a licensed physiotherapist. The suggestions and camera cues are experimental and have not been clinically validated. Use fictional profiles for a class demo. Do not use this project with real patient information until you have reviewed the privacy, security, data retention, and consent requirements for every provider you use. Gemini requests include the profile details the user approved; review Google's current API terms and data handling before use.

The pose model currently supports simple visibility and arm raise feedback. Shoulder rotation and neck motion are not reliably assessed by this 2D camera flow, and the presentation's LSTM temporal model has not yet been trained or connected.
