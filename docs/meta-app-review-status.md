# Meta App Review Status — Content Hub

This is a **template the admin must fill in**. This build was implemented
without access to the real Meta Business Manager / Meta App Dashboard, so the
fields below are scaffolded but blank. Fill them in before relying on the
Facebook OAuth connect flow in any environment beyond local development
against your own test Page.

## Decision rule: is Dev Mode sufficient, or is App Review required?

A Meta App in **Development Mode** can only be used by people with a role on
the app (Admin/Developer/Tester) in Meta's dashboard, connecting **their
own** Pages. Once the app needs to connect a Page belonging to someone who is
not an app-role holder, or needs permissions beyond the default
"basic"/self-only scopes, **App Review is required** before Meta will allow
the OAuth flow to succeed for that Page/permission combination in
production.

Apply this IF/ELSE rule:

```
IF the only Facebook Page(s) this app will ever connect to
   are owned by / already have an Admin/Developer/Tester role
   held by the same people who administer this Meta App
THEN
   Dev Mode is sufficient. No App Review submission needed yet.
ELSE
   App Review is required for the requested scopes
   (pages_show_list, pages_read_engagement, pages_manage_posts)
   before the connect flow will work for that Page.
```

## Fields to complete

- [x] **Business Manager that owns the target Page(s)**:
  _(admin's own Business Manager — fill in the exact name/ID from the Meta
  dashboard when setting up the real App)_
- [ ] **Meta App ID** (matches `FACEBOOK_APP_ID` in `.env`):
  _(pending — fill in when the real Meta App is created)_
- [x] **Meta App current mode**: ☑ Development ☐ Live
- [x] **Does the IF/ELSE rule above put this app in the "Dev Mode is
      sufficient" branch, or the "App Review required" branch?**
  ☑ Dev Mode sufficient ☐ App Review required
  _(Confirmed by admin 2026-07-16: only the admin's own Facebook Page(s)
  will be connected — the admin holds the app role and owns the Page, so
  Dev Mode covers the OAuth flow. Revisit this decision if a Page owned by
  anyone else ever needs connecting.)_
- [x] **If App Review required — submission status**:
  ☑ Not started (not required under the Dev Mode branch above)
  ☐ In progress ☐ Submitted, pending ☐ Approved ☐ Rejected
- [x] **Scopes requested and their review status**:
  | Scope | Requested? | Review status |
  |---|---|---|
  | `pages_show_list` | Yes (Dev Mode — self-use) | Not needed under Dev Mode |
  | `pages_read_engagement` | Yes (Dev Mode — self-use) | Not needed under Dev Mode |
  | `pages_manage_posts` | Yes (Dev Mode — self-use) | Not needed under Dev Mode |
- [ ] **Redirect URI(s) registered in the Meta App dashboard** (must exactly
      match `FACEBOOK_REDIRECT_URI` in every environment's `.env`):
  _______________________________________________
- [ ] **Data Use Checkup completion status** (Meta periodically requires
      re-attestation of data use — track renewal date here):
  _______________________________________________
- [ ] **Contact/owner for this Meta App** (who to page if OAuth breaks in
      production):
  _______________________________________________

## Notes

- Review this doc whenever a new Facebook Page (outside the current
  Business Manager) needs to be connected, or when adding new scopes.
- Revisit before any Phase 2+ work that adds YouTube/TikTok/LINE — each
  platform has its own equivalent app-review process; this template's
  structure (mode decision rule + scope table + submission status) should be
  copied per platform rather than overloaded onto this one file.
