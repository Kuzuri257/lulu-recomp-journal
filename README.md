# Lulu's Recomp Journal

Static GitHub Pages-ready app with Supabase email OTP login and per-user synced supplement tracking.

## What is included

- `index.html` - the app UI, adapted from the committed supplement design.
- `app.js` - Supabase auth, supplement seed data, daily logs, goals, and badge calculation.
- `styles.css` - Lulu journal styling.
- `supabase/config.example.js` - copy to `supabase/config.js` with your Supabase project URL and anon key.
- `supabase/migrations/20260619000100_lulu_recomp_journal.sql` - database schema and Row Level Security.

## Supabase setup

1. Create a Supabase project.
2. In SQL Editor, run `supabase/migrations/20260619000100_lulu_recomp_journal.sql`.
3. In Authentication > Providers > Email, enable email OTP.
4. In Authentication > Email Templates, make sure the template includes `{{ .Token }}` so the email sends a 6-digit code.
5. Copy `supabase/config.example.js` to `supabase/config.js` and fill:

```js
window.LULU_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_PUBLIC_ANON_KEY"
};
```

The anon key is safe to publish in a browser app when Row Level Security policies are enabled.

## Local preview

From the repository root:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/lulu-recomp-journal/
```

## GitHub Pages

This app can be served from the `lulu-recomp-journal/` folder as static files. If using GitHub Pages, set the publish source to the repository branch/folder or use the included Pages workflow after GitHub Pages is enabled.
