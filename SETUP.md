# Team Dashboard - Setup Guide

Everything is free. Total setup time: ~10 minutes.

---

## Step 1: Create a Supabase project (5 min)

1. Go to [supabase.com](https://supabase.com) and sign up (GitHub login works)
2. Click **New Project**
3. Pick any name and a strong database password (save it somewhere)
4. Region: pick the closest one to your team
5. Wait for it to finish creating (~1 min)

### Run the database setup

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Open the file `supabase-setup.sql` from this project
4. Copy-paste the entire contents into the editor
5. Click **Run**
6. You should see "Success. No rows returned" - that's correct

### Disable email confirmation (important)

1. Go to **Authentication** > **Providers** > **Email**
2. Turn OFF "Confirm email"
3. Click **Save**

This lets users log in immediately when an admin creates their account.

### Get your API keys

1. Go to **Settings** > **API** (left sidebar)
2. Copy these three values (you'll need them in Step 3):
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (the long one under "Project API keys")
   - **service_role** key (click "Reveal" - keep this secret)

---

## Step 2: Push code to GitHub (2 min)

1. Go to [github.com](https://github.com) and sign in
2. Click the **+** icon > **New repository**
3. Name it `team-dashboard`, keep it private, click **Create repository**
4. On your computer, open a terminal in this project folder and run:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/team-dashboard.git
git push -u origin main
```

---

## Step 3: Deploy to Vercel (3 min)

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub
2. Click **Add New** > **Project**
3. Import your `team-dashboard` repo
4. Before clicking Deploy, expand **Environment Variables** and add:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role key |

5. Click **Deploy**
6. Wait ~1 minute. You'll get a URL like `team-dashboard.vercel.app`

---

## Step 4: First login

1. Open your Vercel URL
2. Since no users exist yet, you'll see "Create the first admin account"
3. Enter your email + password
4. You're in as admin

### Add your team

1. Open the **Admin panel** at the top
2. Type their email, a password, and pick "Viewer" or "Admin"
3. Click **Add**
4. Share their email + password with them
5. They go to the same URL and sign in

### Upload data

1. In the Admin panel, drop your `TEAM_PRODUCTIVITY_.xlsx` on the left
2. Click **Record productivity data**
3. Drop your `ATT_July.xlsx` on the right
4. Click **Record attendance data**
5. Everyone can now see the dashboard

---

## Making changes later

Edit files locally, then:

```bash
git add .
git commit -m "description of change"
git push
```

Vercel auto-deploys in ~30 seconds. Or just come back to Claude and ask for the change.

---

## Custom domain (optional)

In Vercel > your project > **Settings** > **Domains**, add your own domain.
Follow the DNS instructions they show. Also free.
