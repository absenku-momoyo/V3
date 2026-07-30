# Dashboard Keuangan Momoyo & Mixue

Dashboard statis (tanpa build step) untuk ringkasan omzet, ranking harian,
dan tren per outlet dari 14 outlet Momoyo & Mixue.

- Login lewat Supabase Auth (owner-only).
- Data diambil langsung dari Supabase REST oleh browser; keamanan
  ditegakkan oleh Row Level Security (anon key di `js/config.js` memang
  publik dan aman — RLS mensyaratkan role `authenticated`).
- Deploy: GitHub Pages, branch `main`, root folder.

## Development lokal

```
npx --yes serve .
```

## Test pure logic

```
node --test tests/computations.test.mjs
```
