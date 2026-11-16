/* ─────────────────────────────────────────────────────────────────────────
   PAM Word Challenge — runtime configuration
   1) Create a free project at https://supabase.com
   2) Run supabase/schema.sql in the SQL Editor
   3) Paste your Project URL + anon public key below (Project Settings → API)

   Leave the placeholders untouched to run in local DEMO mode
   (everything is stored in this browser only — perfect for a quick preview).
   The anon key is designed to be public; all security is enforced in SQL.
   ───────────────────────────────────────────────────────────────────────── */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://viubuthxwbenmhnrgbjy.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_cJBAYPWdofWOq8a-wYyUXw_XUqvZleg',   // publishable key — safe to be public
  // NEVER put a secret key (sb_secret_… / service_role) in this file.

  DEFAULT_LANG: 'ar',                 // 'ar' | 'en' — language of the attract screen
  LOGO_URL: 'assets/logo.png',        // Public Authority of Manpower logo (transparent PNG)
  KIOSK_FULLSCREEN: true              // request fullscreen on the first touch
};
