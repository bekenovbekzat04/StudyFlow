# StudyFlow

StudyFlow is a static student planner built with vanilla JavaScript ES modules. It uses Supabase Auth and PostgreSQL for application data. It has no application build step or package dependencies.

## Run locally

Serve the repository over HTTP. For example, open the folder in Visual Studio Code, start Live Server, and open its local URL. Do not open `index.html` directly with a `file://` URL; browser ES modules require an HTTP origin.

## Deploy to GitHub Pages

The included workflow publishes the static application to GitHub Pages when changes are pushed to `main`. It copies only `index.html`, `css/`, and `js/` into the deployment artifact. Supabase migrations, Edge Function source, and project documentation are not included in the published site.

1. Create or choose a GitHub repository for this project. Push the project files to its `main` branch. The workflow is `.github/workflows/deploy-pages.yml`.
2. In the repository, open **Settings > Pages** and choose **GitHub Actions** as the build and deployment source.
3. Confirm that Actions are enabled for the repository. No GitHub Actions secrets are needed for the static deployment.
4. Push a change to `main`, or manually run **Deploy to GitHub Pages** from the repository's **Actions** tab.
5. Wait for the workflow to complete successfully. The deployment URL appears in the `github-pages` environment and the workflow run summary.

The workflow is configured for a project site hosted below a repository subpath. Site asset references are relative, and the workflow artifact has `index.html` at its root. Do not add a leading slash to local CSS, script, or module paths; that would resolve from the domain root instead of the repository subpath.

## Supabase configuration

The frontend client is initialized in `js/config/supabase.js`. It currently contains an HTTPS Supabase project URL and a Supabase publishable key (`sb_publishable_...`). Verify that they identify the Supabase project you intend to use before publishing. If they do not, replace them with that project's **Project URL** and **Publishable key** (or its legacy `anon` key).

These two values are public client configuration for a static website. The publishable/anon key is expected to be visible in browser code; access must be protected by the existing RLS policies. Never put a Supabase secret key or `service_role` key in this file, the repository, or a GitHub Pages workflow. GitHub Pages cannot keep a key secret from website visitors.

No Supabase values need to be added as GitHub Actions secrets for this workflow. If the URL or publishable/anon key is missing or incorrect, provide the correct values from the Supabase project dashboard and update `js/config/supabase.js` before deploying. Do not use values from a different project.

The Pages workflow only deploys frontend files. It does not apply SQL migrations, change RLS, or deploy Supabase Edge Functions. Confirm that the target Supabase project already has the database objects, policies, and any required functions/secrets configured using the existing files under `supabase/`. Keep server-only function secrets in Supabase, never in the frontend or Pages workflow.

## Supabase Auth URLs

The sign-up code does not pass an `emailRedirectTo` override. Supabase Auth therefore uses the project's configured Site URL for email confirmation redirects.

After creating the repository and enabling Pages, obtain the actual Pages URL. In the Supabase dashboard, open **Authentication > URL Configuration** and:

1. Set **Site URL** to the exact deployed application root, including the repository path and trailing slash when the Pages site is a project site. The general project-site shape is `https://<github-account>.github.io/<repository-name>/`. Replace both placeholders with the real values; do not enter this example literally.
2. Add that exact deployed application URL to **Redirect URLs**. Add the actual local development URL there too if you use email confirmation locally.
3. Save the settings and test a new sign-up confirmation link. The link should return to the deployed app root, where Supabase JS can restore the session from the URL.

Do not configure the placeholders above until the repository name and GitHub account are known. No authentication code or Supabase Auth settings can be finalized from this checkout alone because the future Pages URL is not known.

## Updating the deployed site

Commit and push changes to `main`. GitHub Actions will package and deploy the static site automatically. To redeploy without a code change, run **Deploy to GitHub Pages** manually from the **Actions** tab.

## Project structure

- `index.html` - application shell and external CDN scripts.
- `css/styles.css` - application styles.
- `js/app.js` - application startup and feature wiring.
- `js/config/supabase.js` - public Supabase URL/key and client initialization.
- `js/services/` - Supabase Auth, task, and subject data operations.
- `js/modules/` - application feature modules.
- `js/utils/` - shared utilities and translations.
- `supabase/` - database migrations, Edge Function source, and setup documentation; not copied into the Pages artifact.
